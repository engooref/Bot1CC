// src/managers/EventManager.js
import fs from 'fs/promises';
import path from 'path';
import { URL } from 'url';
import sharp from 'sharp';
import { EmbedBuilder, AttachmentBuilder, ChannelType, GuildMember, } from 'discord.js';
import TempFile from 'tmp-promise';
import { file as tmpFile } from 'tmp-promise';
import xml2js from 'xml2js';
import { Event } from '../entities/Event.js';
import { Response } from '../entities/Response.js';
import { randomUUID } from 'crypto';
import { InviteView } from '../view/InviteView.js';
import { EventView } from '../view/EventView.js';
export default class EventManager {
    constructor(bot) {
        this.bot = bot;
        this.urlSite = process.env.URL_SITE;
    }
    /** Crée ou met à jour le message d’un événement */
    async setEvent(event) {
        try {
            const channel = this.getChannel(event);
            // 1) URL Google Calendar
            const startISO = event.start.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
            const calUrl = new URL('https://calendar.google.com/calendar/render');
            calUrl.searchParams.set('action', 'TEMPLATE');
            calUrl.searchParams.set('text', event.name);
            calUrl.searchParams.set('dates', `${startISO}/${startISO}`);
            // 2) Embed principal
            const embed = new EmbedBuilder()
                .setTitle(`${event.name} ${event.start.toDateString()}`)
                .addFields({ name: 'Regroupement', value: `\`\`\`${this.formatDateTime(event.start)}\`\`\``, inline: false }, { name: 'Lancement', value: `\`\`\`${this.formatTime(event.lancServ)}\`\`\``, inline: false }, { name: 'Spawn', value: event.spawn || '—', inline: false }, { name: 'Type event', value: (event.type?.name ?? 'Aucun'), inline: false }, { name: 'Description', value: event.description || '—', inline: false }, { name: 'Lien', value: `[Ajouter au calendrier Google](${calUrl})`, inline: false }, { name: `Accepted (0)`, value: 'Aucun', inline: true }, { name: `Declined (0)`, value: 'Aucun', inline: true }, { name: `Tentative (0)`, value: 'Aucun', inline: true });
            if (event.type?.color) {
                embed.setColor(event.type?.color);
            }
            // 3) Image d’event
            if (event.picture) {
                const picUrl = new URL(`/files/get`, this.urlSite);
                picUrl.searchParams.set('typeFile', '3');
                picUrl.searchParams.set('nameFile', event.picture);
                embed.setImage(picUrl.toString());
            }
            const view = new InviteView(this.bot, event.id, event.roleDispo != '[]');
            let msg = null;
            if (event.discordId) {
                try {
                    msg = await channel.messages.fetch(event.discordId);
                }
                catch {
                    msg = null;
                }
            }
            const sent = await view.sendOrEdit(channel, msg, { embeds: [embed] });
            event.discordId = sent.id;
            // 5) Briefing (fichier + forum)
            if (event.briefingTemplateName) {
                await this._handleBriefing(event);
            }
            // 6) Sauvegarde en base
            await this.bot.dbMgr.update(event);
            await this.updateEvent(event);
        }
        catch (err) {
            console.error('setEvent error', err);
        }
    }
    /** Met à jour le décompte Accepted/Declined/Tentative */
    async updateEvent(event) {
        try {
            const channel = this.getChannel(event);
            const message = await channel.messages.fetch(event.discordId);
            const embed = EmbedBuilder.from(message.embeds[0]);
            const lists = {
                accepted: [],
                declined: [],
                tentative: [],
            };
            for (const resp of event.responses) {
                if (!resp.users)
                    continue;
                const member = await this.bot.guild.members.fetch(resp.users.discordId).catch(() => null);
                if (!member)
                    continue;
                if (resp.typeRep === 'accepted')
                    lists.accepted.push(member.displayName);
                if (resp.typeRep === 'declined')
                    lists.declined.push(member.displayName);
                if (resp.typeRep === 'tentative')
                    lists.tentative.push(member.displayName);
            }
            // 2) Mettre à jour les champs dans l’embed
            embed.data.fields = embed.data.fields.map(f => {
                if (f.name.startsWith('Accepted'))
                    return { name: `Accepted (${lists.accepted.length})`, value: lists.accepted.join('\n') || 'Aucun', inline: f.inline };
                if (f.name.startsWith('Declined'))
                    return { name: `Declined (${lists.declined.length})`, value: lists.declined.join('\n') || 'Aucun', inline: f.inline };
                if (f.name.startsWith('Tentative'))
                    return { name: `Tentative (${lists.tentative.length})`, value: lists.tentative.join('\n') || 'Aucun', inline: f.inline };
                return f;
            });
            await message.edit({ embeds: [embed] });
        }
        catch (err) {
            console.error('updateEvent error', err);
        }
        finally {
            if (!event.appelMsgDiscord) {
                this.bot.schedMgr.event.updateEvent(event);
            }
        }
    }
    /** Supprime le message Discord de l’événement */
    async suppEvent(event) {
        try {
            const channel = this.getChannel(event);
            if (!event.discordId)
                return;
            const message = await channel.messages.fetch(event.discordId).catch(() => null);
            if (!message)
                return;
            // Supprimer les replies du bot
            for await (const msg of channel.messages.cache.values()) {
                if (msg.reference?.messageId === message.id && msg.author.id === (await this.bot.guild.members.fetchMe()).id) {
                    await msg.delete().catch(() => null);
                    break;
                }
            }
            await message.delete();
        }
        catch (err) {
            console.error('suppEvent error', err);
        }
    }
    async createSvgTable(data, cellHeight = 30, padding = 10, title = '') {
        const headerHeight = 60;
        // 1) Prépare l'en-tête
        data = JSON.parse(JSON.stringify(data)); // clone pour ne pas muter l'original
        data.unshift(['Joueur', 'Équipe', 'Rôle', 'Vaisseau', 'Rôle Vaisseau', 'Commentaire']);
        // 2) Helpers
        const getTextWidth = (text, fontSize = 14) => {
            const clean = text.replace(/#[0-9A-Fa-f]{6}/g, '');
            return clean.length * (fontSize * 0.6);
        };
        const getTextColor = (bg) => {
            const [r, g, b] = [1, 3, 5].map(i => parseInt(bg.substr(i, 2), 16));
            const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            return lum > 0.5 ? '#000000' : '#FFFFFF';
        };
        const adjustBrightness = (color, factor = 0.8) => {
            let [r, g, b] = [1, 3, 5].map(i => parseInt(color.substr(i, 2), 16));
            r = Math.min(255, Math.floor(r * factor));
            g = Math.min(255, Math.floor(g * factor));
            b = Math.min(255, Math.floor(b * factor));
            return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        };
        // 3) Tri secondaire (par équipe, puis nom sans crochets)
        data = [data[0], ...data.slice(1).sort((a, b) => {
                if (a[1] !== b[1])
                    return a[1].localeCompare(b[1]);
                const cleanA = a[0].replace(/\s*\[[^\]]*\]\s*/g, '');
                const cleanB = b[0].replace(/\s*\[[^\]]*\]\s*/g, '');
                return cleanA.localeCompare(cleanB);
            })];
        // 4) Dimensions
        const columns = data[0].length;
        const colWidths = Array.from({ length: columns }, (_, col) => Math.max(...data.map(row => getTextWidth(String(row[col])))) + 2 * padding);
        const rows = data.length;
        const tableWidth = colWidths.reduce((a, b) => a + b, 0);
        const tableHeight = rows * cellHeight;
        const svgHeight = headerHeight + tableHeight + 50;
        const svgWidth = tableWidth + 50;
        // 5) Construit le SVG
        let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        svg += `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">\n`;
        // 5a) Dégradé pour l'en-tête
        svg += `  <defs>\n`;
        svg += `    <linearGradient id="headerGradient" x1="0%" y1="0%" x2="0%" y2="100%">\n`;
        svg += `      <stop offset="0%" stop-color="#333333"/>\n`;
        svg += `      <stop offset="100%" stop-color="#000000"/>\n`;
        svg += `    </linearGradient>\n`;
        svg += `  </defs>\n`;
        // 5b) Rectangle d'en-tête et texte
        svg += `  <rect x="0" y="0" width="${tableWidth}" height="${headerHeight}" fill="url(#headerGradient)" rx="10" ry="10"/>\n`;
        svg += `  <text x="${tableWidth / 2}" y="40" text-anchor="middle" fill="white" font-family="Arial" font-size="26">Affectation des Joueurs - ${title}</text>\n`;
        // 5c) Bordure générale
        svg += `  <rect x="0" y="${headerHeight}" width="${tableWidth}" height="${tableHeight}" fill="none" stroke="black" rx="10" ry="10"/>\n`;
        // 5d) Cellules et texte
        let y = headerHeight;
        for (let row = 0; row < rows; row++) {
            let x = 0;
            for (let col = 0; col < columns; col++) {
                const cellWidth = colWidths[col];
                // couleur de fond alternée
                let fill = row === 0 ? '#a4c2f4' : (row % 2 === 0 ? '#f2f2f2' : '#ffffff');
                svg += `  <rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" fill="${fill}" stroke="black" rx="5" ry="5"/>\n`;
                const cellData = String(data[row][col]);
                if (col === 2 && row > 0 && cellData) {
                    // rôle avec dégradés
                    const roles = cellData.split(', ').map(r => r.split('|'));
                    let rx = x + 5;
                    for (const [name, color] of roles) {
                        const roleW = getTextWidth(name, 12) + 20;
                        const textColor = getTextColor(color);
                        const gradId = randomUUID();
                        const endColor = adjustBrightness(color, 0.8);
                        // gradient
                        svg += `  <defs>\n`;
                        svg += `    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">\n`;
                        svg += `      <stop offset="0%" stop-color="${color}"/>\n`;
                        svg += `      <stop offset="100%" stop-color="${endColor}"/>\n`;
                        svg += `    </linearGradient>\n`;
                        svg += `  </defs>\n`;
                        // rect role
                        svg += `  <rect x="${rx}" y="${y + 5}" width="${roleW}" height="${cellHeight - 10}" fill="url(#${gradId})" stroke="black" rx="5" ry="5"/>\n`;
                        // text role
                        svg += `  <text x="${rx + roleW / 2}" y="${y + cellHeight / 2}" text-anchor="middle" alignment-baseline="middle" font-family="Arial" font-size="12" fill="${textColor}">${name}</text>\n`;
                        rx += roleW + 10;
                    }
                }
                else {
                    // texte standard centré
                    svg += `  <text x="${x + cellWidth / 2}" y="${y + cellHeight / 2}" text-anchor="middle" alignment-baseline="middle" font-family="Arial" font-size="14">${cellData}</text>\n`;
                }
                x += cellWidth;
            }
            y += cellHeight;
        }
        svg += `</svg>`;
        // 6) Écrit et convertit
        const { path: svgPath } = await tmpFile({ postfix: '.svg' });
        await fs.writeFile(svgPath, svg, 'utf8');
        const { path: pngPath } = await tmpFile({ postfix: '.png' });
        await sharp(svgPath)
            .png({ quality: 100 })
            .toFile(pngPath);
        return pngPath;
    }
    async attributionEvent(event) {
        try {
            // 1) Récupère le forum
            const forum = /** @type {ForumChannel} */ (this.bot.guild.channels.cache.get(this.bot.getParameter('CHANNEL_BRIEFING')));
            if (!forum || forum.type !== ChannelType.GuildForum) {
                throw new Error('CHANNEL_BRIEFING n’est pas un ForumChannel valide');
            }
            const responses = await this.bot.dbMgr.getEm().getRepository(Response).find({
                event: event,
                typeRep: { $in: ['accepted', 'added'] }
            }, {
                populate: ['users', 'team', 'roles'],
            });
            // 3) Prépare les données pour le SVG
            const data = responses.map(r => [
                r.users.username,
                r.team?.name || 'Aucune équipe',
                r.roles?.map(rr => `${rr.name}|${rr.color}`).join(', ') || '',
                r.vaisseau || '',
                r.roleVaisseau || '',
                r.commentaire || '',
            ]);
            // 4) Génère le PNG
            const pngPath = await this.createSvgTable(data, 30, 10, event.name);
            const attachment = new AttachmentBuilder(pngPath);
            // 5) Poste ou remplace dans un thread forum
            if (event.attributionDiscordId) {
                // on cherche le message existant dans tous les threads
                for (const thread of forum.threads.cache.values()) {
                    let msg;
                    try {
                        msg = await thread.messages.fetch(event.attributionDiscordId);
                    }
                    catch {
                        continue;
                    }
                    await msg.delete().catch(() => { });
                    const newMsg = await thread.send({ files: [attachment] });
                    event.attributionDiscordId = newMsg.id;
                    break;
                }
            }
            if (!event.attributionDiscordId) {
                // crée un nouveau thread
                const tagId = forum.availableTags.find(t => t.name === process.env.EVENT_TAG)?.id;
                const thread = await forum.threads.create({
                    name: event.name,
                    appliedTags: tagId ? [tagId] : [],
                    message: { files: [attachment] },
                });
                const starter = await thread.fetchStarterMessage();
                event.attributionDiscordId = starter.id;
            }
            await this.bot.dbMgr.update(event);
            // 6) nettoie le fichier temporaire
            await fs.unlink(pngPath).catch(() => { });
        }
        catch (err) {
            console.error('attributionEvent error', err);
        }
    }
    async userResponseHandle(interaction, data) {
        // récupère ou crée l’utilisateur en BDD
        const userEntity = await this.bot.dbMgr.insertAndGetUser((interaction.member instanceof GuildMember) ? interaction.member : interaction.member.user);
        if (!userEntity)
            return;
        // met à jour l’affichage de l’événement
        const event = await this.bot.dbMgr.getEm().findOneOrFail(Event, { id: data.eventId });
        // cherche la réponse existante
        let response = await this.bot.dbMgr.getEm().findOne(Response, { users: userEntity, event: event });
        if (data.responseType !== 'role') {
            if (response) {
                response.typeRep = data.responseType;
            }
            else {
                response = this.bot.dbMgr.getEm().create(Response, {
                    users: userEntity,
                    event: event,
                    typeRep: data.responseType,
                    roleDemand: ''
                });
            }
            await this.bot.dbMgr.update(response);
        }
        const roleDispoList = JSON.parse(event.roleDispo);
        const roleDemandList = response?.roleDemand ?? [];
        if (roleDispoList.length > 0 &&
            ((data.responseType === 'role' && response?.typeRep === 'accepted') ||
                data.responseType === 'accepted') &&
            response) {
            const messageContent = `Afin de mieux répartir les équipes, merci de sélectionner le ou les rôles ` +
                `que vous souhaitez obtenir lors de l'événement ${event.name}.\n` +
                `**Attention** : ces rôles ne seront pas définitifs.`;
            const allRoles = [
                {
                    value: 'Pas de préférence',
                    select: roleDemandList.includes('Pas de préférence'),
                },
                ...roleDispoList.map(role => ({
                    value: role,
                    select: roleDemandList.includes(role),
                })),
            ];
            const view = new EventView(this.bot, allRoles, response.id);
            // envoie la suite d’interaction avec les rows de la view
            await interaction.followUp({
                content: messageContent,
                ephemeral: true,
                components: view.rows.map(r => r.toJSON()),
            });
        }
        await this.updateEvent(event);
    }
    /** Crée le briefing à partir d’un template SVG */
    async _handleBriefing(event) {
        // 1) Lire le template SVG
        const tplDir = path.join('Data', this.bot.getParameter('DIRECTORY_TEMPLATES'), event.briefingTemplateName);
        const tplPath = path.join(tplDir, 'template.svg');
        const svg = await fs.readFile(tplPath, 'utf-8');
        // 2) Parser et remplir dynamiquement
        const parser = new xml2js.Parser();
        const builder = new xml2js.Builder();
        const obj = await parser.parseStringPromise(svg);
        // … parcourir obj.svg.text pour remplacer par event[field] via formatValue …
        const updatedSvg = builder.buildObject(obj);
        // 3) Conversion en PNG avec sharp
        const tmp = await TempFile.file({ postfix: '.svg' });
        await fs.writeFile(tmp.path, updatedSvg);
        const out = tmp.path.replace(/\.svg$/, '.png');
        await sharp(tmp.path).png().toFile(out);
        await fs.unlink(tmp.path);
        // 4) Envoi dans un forum Discord
        const channelBrief = this.bot.guild.channels.cache.get(this.bot.getParameter('CHANNEL_BRIEFING'));
        const file = new AttachmentBuilder(out);
        if (event.briefingDiscordId) {
            // Supprime l’ancien message, poste le nouveau dans le thread existant…
        }
        else {
            const thread = await channelBrief.threads.create({
                name: event.name,
                appliedTags: [channelBrief.availableTags.find(t => t.name === process.env.EVENT_TAG).id],
                message: {
                    files: [file]
                }
            });
            event.briefingDiscordId = (await thread.fetchStarterMessage()).id;
        }
        await fs.unlink(out);
    }
    /** Recherche d’un utilisateur par début de nom */
    searchUserAttribution(searchUser) {
        const members = Array.from(this.bot.guild.members.cache.values());
        const re = new RegExp(`^${searchUser.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
        return members
            .filter(m => re.test(m.displayName.replace(/\[.*?\]/g, '').trim()))
            .map(m => ({ avatar: m.displayAvatarURL(), name: m.displayName, id: m.id }));
    }
    /** Sélectionne le bon canal TextChannel en fonction du type d’event */
    getChannel(event) {
        const type = event.type?.name.toUpperCase() ?? "";
        let param = type.includes('ENTRAINEMENT') ? 'CHANNEL_TRAINING'
            : type.includes('GROS EVENT') ? 'CHANNEL_GROS_EVENT'
                : 'CHANNEL_' + event.start.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
        const id = this.bot.getParameter(param);
        const ch = this.bot.guild.channels.cache.get(id);
        if (!ch)
            throw new Error(`Channel non trouvé pour ${param}`);
        return ch;
    }
    /** Essaie de convertir une Date ou une string ISO en Date. */
    parseDate(dt) {
        if (dt instanceof Date) {
            return dt;
        }
        const d = new Date(dt);
        return isNaN(d.getTime()) ? null : d;
    }
    formatDateTime(dt) {
        const date = this.parseDate(dt);
        if (!date) {
            // si ce n'est pas un ISO valide, on renvoie la string d’origine
            return String(dt);
        }
        return date.toLocaleString('fr-FR', {
            weekday: 'long',
            day: '2-digit',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }
    formatDate(dt) {
        const date = this.parseDate(dt);
        if (!date) {
            return String(dt);
        }
        return date.toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
        });
    }
    formatTime(dt) {
        const date = this.parseDate(dt);
        if (!date) {
            return String(dt);
        }
        return date.toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit',
        });
    }
    formatValue(val) {
        // on reconnaît aussi les ISO‐strings
        if (typeof val === 'string') {
            const date = this.parseDate(val);
            if (date) {
                return this.formatTime(date);
            }
        }
        if (val instanceof Date) {
            return this.formatTime(val);
        }
        if (typeof val === 'boolean') {
            return val ? 'Oui' : 'Non';
        }
        if (typeof val === 'object' && val !== null) {
            return JSON.stringify(val, null, 2);
        }
        return String(val ?? '');
    }
}
//# sourceMappingURL=EventManager.js.map