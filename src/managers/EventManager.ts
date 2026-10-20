import { SettingKeys, EventChannelSettings, type SettingKey } from '../constants/SettingKeys.js';
import { settingsService } from '../services/SettingsService.js';
// src/managers/EventManager.js
import fs from 'fs';
import { promises as fsp } from 'fs';

import path from 'path';
import { URL } from 'url';
import { 
  EmbedBuilder, 
  AttachmentBuilder, 
  ForumChannel,
  TextChannel,
  ColorResolvable,
  ChannelType,
  Message,
  GuildMember,
  ButtonInteraction,
  ThreadChannel,
  ChatInputCommandInteraction,
  VoiceChannel,
} from 'discord.js';

import { BotManager } from '../BotManager.js';
import {Event, EventStatus} from '../entities/event/Event.js';
import { Response } from '../entities/event/Response.js';
import { InviteView } from '../view/InviteView.js';
import { EventView } from '../view/EventView.js';
import { EntityManager } from '@mikro-orm/core';
import { SafeMethod } from '../exception/Safe.js';
import { getManagerLogger } from '../logger.js';
import { nanoid } from 'nanoid';
import { SVGManager } from '../utils/SVGManager.js';
import { CommandHandler } from '../utils/SlashCommandManager.js';


export class EventManager {
  private bot: BotManager;
  private urlSite : string;
  public fem!: EntityManager ;
  private logger = getManagerLogger('EventManager');

  constructor(bot: BotManager) {
    this.bot     = bot;
    this.urlSite = process.env.URL_SITE!;

  }

  get em(): EntityManager {
    if (!this.fem)
      this.fem = this.bot.db.getEm();
    
    return this.fem;
  }

  /** Crée ou met à jour le message d’un événement */
  @SafeMethod
  async setEvent(event: Event) {
    try {
      const channel = await this.getChannel(event);
      // 1) URL Google Calendar
      const startISO = event.start.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      const calUrl = new URL('https://calendar.google.com/calendar/render');
      calUrl.searchParams.set('action', 'TEMPLATE');
      calUrl.searchParams.set('text', event.name);
      calUrl.searchParams.set('dates', `${startISO}/${startISO}`);

      const lancServDate = this.combineDateAndTime(event.start, event.launchServer);
      const lancServTimestamp = lancServDate ? `<t:${Math.floor(lancServDate.getTime() / 1000)}:R>` : '';

      const certification = event.certifications.map(c => c.name + ' (' + c.categorie.name + ')').join(', ');
      // 2) Embed principal
      const embed = new EmbedBuilder()
        .setTitle(event.name)
        .addFields(
          { name: 'Regroupement', value: `\`\`\`${this.formatDateTime(event.start)}\`\`\``, inline: false },
          { 
            name: 'Lancement',    
            value: `\`\`\`${this.formatTime(event.launchServer)}\`\`\`\n${lancServTimestamp}`, 
            inline: false 
          },
          { name: 'Spawn',        value: event.spawn || '', inline: false },
          { name: 'Type event',   value: (event.type?.name ?? 'Aucun'), inline: false }
        );

        if (event.type?.name?.toLowerCase() === 'certification') embed.addFields({name: 'Certifications', value: certification, inline: false });

        embed.addFields(
          { name: 'Responsable'   , value: event.responsable || event.userOrig?.username || 'Inconnu', inline: false },
          { name: 'Description',  value: event.description || '', inline: false },
          { name: 'Lien',         value: `[Ajouter au calendrier Google](${calUrl})`, inline: false },
          { name: `Accepted (0)`,  value: 'Aucun', inline: true },
          { name: `Declined (0)`,  value: 'Aucun', inline: true },
          { name: `Tentative (0)`, value: 'Aucun', inline: true },
        );

      if (event.type?.color) {
        embed.setColor(event.type?.color as ColorResolvable);
      }
      // 3) Image d’event
      if (event.picture) {
        const picUrl = new URL(`/files/get`, this.urlSite);
        picUrl.searchParams.set('typeFile', '3');
        picUrl.searchParams.set('nameFile', event.picture);
        embed.setImage(picUrl.toString());
      }

      const view = new InviteView(this.bot, event.id, event.availableRoles.length > 0);
      let msg: Message | null = null;
      if (event.discord.messageId) {
        try {
          msg = await channel.messages.fetch(event.discord.messageId);
        } catch {
          const channelIds = await Promise.all(([
            'gros_event', 'training', 'lundi', 'mardi', 'mercredi',
            'jeudi', 'vendredi', 'samedi', 'dimanche',
          ] as const).map(name => settingsService.getString(EventChannelSettings[name])));

          let found = false;
          for (const chId of channelIds) {
            const ch = this.bot.guild.channels.cache.get(chId) as TextChannel | undefined;
            if (!ch) continue;
            try {
              const candidateMsg = await ch.messages.fetch(event.discord.messageId);
              // Supprimer le thread associé si présent
              if (candidateMsg.hasThread) {
                const thread = candidateMsg.thread;
                if (thread) await thread.delete().catch(() => null);
              }
              await candidateMsg.delete().catch(() => null);
              if (channel?.name.endsWith('📅'))
                await channel?.setName(channel?.name.slice(0, -1))
              found = true;
              break;
            } catch {
              continue;
            }
          }
          msg = null;
        }
      }

      const sent = await view.sendOrEdit(channel, msg, { embeds: [embed] });
      
      event.publishedAt = new Date();
      event.discord.messageId = sent.id;

      if(!sent.hasThread) {
        const thread = await sent.startThread(
          {
            name: event.name
            
          }
        );

        await thread.send({
          content: "DISCUSSION EVENT"
        })
      }

     
      if (!channel.name.endsWith('📅')) {
        this.logger.info({ msg: 'Marquage du channel avec un emoji calendrier', channelId: channel.id, channelName: channel.name });
        try {
          await channel.setName(channel.name + '📅');
        } catch (err) {
          await this.logger.error({ msg: 'Erreur lors du renommage du channel', channelId: channel.id, err });
        }
      }
      // 5) Briefing (fichier + forum)
      if (event.briefingTemplateName) {
        await this._handleBriefing(event);
      }

      // 6) Sauvegarde en base
      event.status = EventStatus.PUBLISHED;
      await this.em.persist(event).flush();
      await this.updateEvent(event);
    } catch (err: Error | any) {
      await this.logger.error({ op: 'setEvent', eventId: event.id, err });
      throw err;
    }
  }

  /** Met à jour le décompte Accepted/Declined/Tentative */
  @SafeMethod
  async updateEvent(event: Event) {
    try {
      const channel = await this.getChannel(event);
      const message = await channel.messages.fetch(event.discord.messageId!);
      const embed   = EmbedBuilder.from(message.embeds[0]);

      const lists: { accepted: string[]; declined: string[]; tentative: string[] } = {
        accepted: [],
        declined: [],
        tentative: [],
      };

      for (const resp of event.responses) {
        if (!resp.users) continue;
        const member = await this.bot.guild.members.fetch(resp.users.discordId).catch(() => null);
        if (!member) continue;

        if (resp.typeRep === 'accepted')   lists.accepted.push(member.displayName);
        if (resp.typeRep === 'declined')   lists.declined.push(member.displayName);
        if (resp.typeRep === 'tentative')  lists.tentative.push(member.displayName);
      }

      // 2) Mettre à jour les champs dans l’embed
      embed.data.fields = embed.data.fields!.map(f => {
        if (f.name.startsWith('Accepted'))   return { name: `Accepted (${lists.accepted.length})`,   value: lists.accepted.sort((a, b) => a.localeCompare(b, 'fr')).join('\n')||'Aucun', inline: f.inline };
        if (f.name.startsWith('Declined'))   return { name: `Declined (${lists.declined.length})`,   value: lists.declined.sort((a, b) => a.localeCompare(b, 'fr')).join('\n')||'Aucun', inline: f.inline };
        if (f.name.startsWith('Tentative'))  return { name: `Tentative (${lists.tentative.length})`, value: lists.tentative.sort((a, b) => a.localeCompare(b, 'fr')).join('\n')||'Aucun', inline: f.inline };
        return f;
      });

      await message.edit({ embeds: [embed] });
    } catch (err) {
  await this.logger.error({ msg: 'updateEvent error', err });
    } finally {
      if (!event.appelMsgDiscord) {
        this.bot.schedulerManager.event.updateEvent(event);
      }
    }
  }

  /** Supprime le message Discord de l’événement */
  @SafeMethod
  async suppEvent(event: Event) {
    try {
      const channel = await this.getChannel(event);
      if (!event.discord.messageId) return;
      const message = await channel.messages.fetch(event.discord.messageId).catch(() => null);
      if (!message) return;
      // Supprimer les replies du bot
      for await (const msg of channel.messages.cache.values()) {
        if (msg.reference?.messageId === message.id && msg.author.id === (await this.bot.guild.members.fetchMe()).id) {
          await msg.delete().catch(() => null);
          break;
        }
      }
      await message.delete();
      
      if (channel?.name.endsWith('📅'))
        await channel?.setName(channel?.name.slice(0, -1))
      
      if (event.discord.briefingMessageId) {
        // Supprimer le briefing s’il existe
        const forum = /** @type {ForumChannel} */ (
          this.bot.guild.channels.cache.get(await settingsService.getString(SettingKeys.bot.channels.briefing))
        );
        if (forum && forum.type === ChannelType.GuildForum) {
          for (const thread of forum.threads.cache.values()) {
            try {
              const msg = await thread.messages.fetch(event.discord.briefingMessageId);
              await msg.delete();
              break;
            } catch {
              continue;
            }
          }
        }
      }

      if (event.discord.attributionMessageId) {
        // Supprimer l’attribution s’il existe
        const forum = /** @type {ForumChannel} */ (
          this.bot.guild.channels.cache.get(await settingsService.getString(SettingKeys.bot.channels.briefing))
        );
        if (forum && forum.type === ChannelType.GuildForum) {
          for (const thread of forum.threads.cache.values()) {
            try {
              const msg = await thread.messages.fetch(event.discord.attributionMessageId);
              await msg.delete();
              break;
            } catch {
              continue;
            }
          }
        }
      }

      if (event.discord.vocalParentId) {
        const category = channel.guild.channels.cache.get(event.discord.vocalParentId);
        if (category && category.type === ChannelType.GuildCategory) {
          // Delete all children channels in the category
          for (const child of category.children.cache.values()) {
            await child.delete().catch(() => null);
          }
          // Delete the category itself
          await category.delete().catch(() => null);
        }
      }

    } catch (err) {
  await this.logger.error({ msg: 'suppEvent error', err });
    }
  }

  @SafeMethod
  async attributionEvent(event: Event, files: Express.Multer.File[]) {
    try {
      // 1) Récupère le forum
      const forum = /** @type {ForumChannel} */ (
        this.bot.guild.channels.cache.get(await settingsService.getString(SettingKeys.bot.channels.briefing))
      );
      if (!forum || forum.type !== ChannelType.GuildForum) {
        throw new Error(`${SettingKeys.bot.channels.briefing} n’est pas un ForumChannel valide`);
      }

      // 1) Si on a un briefing, on cherche d’abord le thread associé
      let targetThread: ThreadChannel | null = null;
      if (event.discord.briefingMessageId) {
        for (const thread of forum.threads.cache.values()) {
          try {
            const message = await thread.messages.fetch(event.discord.briefingMessageId);
            targetThread = thread;
            break;
          } catch {
            continue;
          }
        }
      }

      if (event.discord.attributionMessageId) {
        // si on n’a pas trouvé le thread briefing, on peut quand même tenter de supprimer
        // l’ancienne attribution depuis tous les threads
        for (const thread of forum.threads.cache.values()) {
          try {
            const oldMsg = await thread.messages.fetch(event.discord.attributionMessageId);
            await oldMsg.delete();
            if (!targetThread) targetThread = thread
            break;
          } catch {
            continue;
          }
        }
      }

      const payloads = files.map(file => ({
        attachment: file.buffer,
        name: file.originalname + '.png',
      }));

      
      // 3) Si on a trouvé le thread du briefing, on poste dedans…
      let msg = undefined;
      if (targetThread) {
        msg = await targetThread.send({
          files: payloads,
          content: `Attribution rôles pour l’événement **${event.name}**`,
        });
        
      } else {

        // 4) …sinon on crée un tout nouveau thread
        const tagId = await settingsService.getString(SettingKeys.bot.events.briefingTag);
        const tag = forum.availableTags.find(t => t.id === tagId);
        const thread = await forum.threads.create({
          name:        event.name,
          appliedTags: tag ? [tag.id] : [],
          message:     {
            content: `Attribution rôles pour l’événement **${event.name}**`,
            files: payloads,
          },
        });
        msg = await thread.fetchStarterMessage();
      }

        event.discord.attributionMessageId = msg!.id;

      await this.em.persist(event).flush();
      
    } catch (err) {
  await this.logger.error({ msg: 'attributionEvent error', err });
    }
  }

  @SafeMethod
  async userResponseHandle(interaction: ButtonInteraction, data: Record<string, any>) {

    // récupère ou crée l’utilisateur en BDD
    const userEntity = await this.bot.db.insertAndGetUser((interaction.member! instanceof GuildMember) ? interaction.member! as GuildMember : interaction.member!.user)
    if (!userEntity) return;

    // met à jour l’affichage de l’événement
    const event = await this.em.findOneOrFail(
      Event,
      { id: data.eventId },
      {
        populate: ['type', 'responses.*'],
      }
    );

    // cherche la réponse existante
    let response = await this.em.findOne(
      Response,
      { users: userEntity, event: event },
    );

    if (data.responseType !== 'role') {
      if (response) {
        response.typeRep = data.responseType;
      } else {
        response = this.em.create(Response, {
          users: userEntity,
          event: event,
          typeRep: data.responseType,
          roleDemand: []
        });
      }
      await this.em.persist(response).flush();
    }

    const roleDemandList: string[] = response?.roleDemand ?? [];

    await this.updateEvent(event);

    if (
      event.availableRoles.length > 0 &&
      (
        (data.responseType === 'role' && response?.typeRep === 'accepted') ||
        data.responseType === 'accepted'
      ) &&
      response
    ) {
      const messageContent = 
        `Afin de mieux répartir les équipes, merci de sélectionner le ou les rôles ` +
        `que vous souhaitez obtenir lors de l'événement ${event.name}.\n` +
        `**Attention** : ces rôles ne seront pas définitifs.`;

      const allRoles = [
        {
          value: 'Pas de préférence',
          select: roleDemandList.includes('Pas de préférence'),
        },
        ...event.availableRoles.map(role => ({
          value: role,
          select: roleDemandList.includes(role),
        })),
      ];

    
      const view = new EventView(this.bot, allRoles, response.id);


      // envoie la suite d’interaction avec les rows de la view
      const msg = await interaction.followUp({
        content: messageContent,
        ephemeral: true,
        components: view.rows.map(r => r.toJSON()),    // ← ici, on passe directement les builders
      });

      view.collectInteractions(msg);
    }

  } 

  /** Crée le briefing à partir d’un template SVG */
  @SafeMethod
  async _handleBriefing(event: Event) {
   
    const templatesDir = await settingsService.getString(SettingKeys.site.directories.briefingTemplates);
    const outputDir    = await settingsService.getString(SettingKeys.site.directories.eventTemplates);
    const outDir = path.join('Data', outputDir);
    fs.mkdirSync(outDir, { recursive: true });
    const fileName = `${nanoid()}.png`;

    const outputPath = path.join(outDir, fileName);

    // Exemple d'utilisation
    const baseDir = path.join('Data', templatesDir, event.briefingTemplateName!.replace(/ /g, '_'))
    const config = {
      svgTemplatePath: path.join(baseDir, 'template.svg'),
      xsltPath: path.join(baseDir,  'template.xslt'),
      outputSvgPath: path.join(outDir, 'event_filled.svg'),
      outputPngPath: path.join(outputPath),
      baseDir: baseDir
    };
    
     const data = {
      id: event.id,
      name: event.name,
      start_date: event.startDate,            // format JJ/MM/AAAA
      start_time: event.startTime,            // HH:MM
      lanc_serv: event.launchServer,              // HH:MM:SS
      lanc_scen: event.launchScenario,              // HH:MM:SS
      end: event.end,
      type: event.type?.name || '',
      object1Cc: event.object1CC,
      objectAdv: event.objectAdv,
      commentaire: event.commentaire,
      spawn: event.spawn,
      lieu_event: event.location,
      nb_resp: event.nbResp,
      respawn: event.respawn,
      regequi_infanterie: event.equipmentRules.Infanterie || '',
      regequi_aerien: event.equipmentRules.Aerien || '',
      regequi_vehicules: event.equipmentRules.Vehicules || '',
      regleenga_infanterie: event.engagementRules.Infanterie || '',
      regleenga_aerien: event.engagementRules.Aerien || '',
      regleenga_vehicules: event.engagementRules.Vehicules || '',
      reglevehicule_infanterie: event.vehicleRules.Infanterie || '',
      reglevehicule_aerien: event.vehicleRules.Aerien || '',
      reglevehicule_vehicules: event.vehicleRules.Vehicules || '',
    };

    const SVGMgr = new SVGManager(data, config)
    await SVGMgr.generateImage();
    const channelBrief : ForumChannel = this.bot.guild.channels.cache.get(await settingsService.getString(SettingKeys.bot.channels.briefing)) as ForumChannel;
    const file = new AttachmentBuilder(outputPath);

    await channelBrief.threads.fetch();
    const threads = channelBrief.threads.cache;

    let message = null;
    // 2. Si on a déjà un ID de message à rafraîchir, on cherche d’abord dedans
    if (event.discord.briefingMessageId) {
      for (const thread of threads.values()) {
        try {
          const existingMsg = await thread.messages.fetch(event.discord.briefingMessageId);
          // Cas 3 : message trouvé, on le supprime et on renvoie le nouveau dans le même thread
          await existingMsg.delete();
          message = await thread.send({ files: [file] });
          
          break;
        } catch (err: any) {
          // 10008 = Unknown Message → pas dans ce thread, on continue
          if (err.code !== 10008) {
            await this.logger.error({ msg: 'Erreur lors de la recherche du message de briefing existant', err } );
          }
        }
      }
    }

    // 3. Si on n’a pas trouvé le message (cas 1 ou 2), on crée un nouveau thread
    if (!message) {
      const tagId = await settingsService.getString(SettingKeys.bot.events.briefingTag);
      const tag = channelBrief.availableTags.find(t => t.id === tagId);
      const newThread = await channelBrief.threads.create({
        name: event.name,
        appliedTags: tag ? [tag.id] : [],
        message: { files: [file] }
      });

      message = await newThread.fetchStarterMessage();

    }

    event.discord.briefingMessageId = message!.id;

    await fsp.unlink(config.outputPngPath).catch(() => {});


  }

  /** Recherche d’un utilisateur par début de nom */
  searchUserAttribution(searchUser: string) {
    const members = Array.from(this.bot.guild.members.cache.values());
    const re = new RegExp(`^${searchUser.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`, 'i');
    return members
      .filter(m => re.test(m.displayName.replace(/\[.*?\]/g, '').trim()))
      .map(m => ({ avatar: m.displayAvatarURL(), name: m.displayName, id: m.id }));
  }

  
  /** Sélectionne le bon canal TextChannel en fonction du type d’event */
  async getChannel(event: Event): Promise<TextChannel> {
    let param: SettingKey | undefined;
    if (event.type) {
      const type = event.type.name.toUpperCase() ?? "";
      if (type.includes('ENTRAINEMENT COMPÉTITION')) param = SettingKeys.bot.channels.training;
      else if (type.includes('GROS EVENT')) param = SettingKeys.bot.channels.grosEvent;
    }

    if (!param) {
      const day = event.start.toLocaleDateString('fr-FR', { weekday: 'long' }).toLowerCase() as keyof typeof EventChannelSettings;
      param = EventChannelSettings[day];
    }

    const id = await settingsService.getString(param);
    const ch = this.bot.guild.channels.cache.get(id);
    if (!ch) throw new Error(`Channel non trouvé pour ${param}`);
    return ch as TextChannel;
  }

  /** Essaie de convertir une Date ou une string ISO en Date. */
  private parseDate(dt: Date | string): Date | null {
    if (dt instanceof Date) {
      return dt;
    }
    const d = new Date(dt);
    return isNaN(d.getTime()) ? null : d;
  }

  formatDateTime(dt: Date | string): string {
    const date = this.parseDate(dt);
    if (!date) {
      // si ce n'est pas un ISO valide, on renvoie la string d’origine
      return String(dt);
    }
    return date.toLocaleString('fr-FR', {
      weekday: 'long',
      day:     '2-digit',
      month:   'long',
      year:    'numeric',
      hour:    '2-digit',
      minute:  '2-digit',
    });
  }

  formatDate(dt: Date | string): string {
    const date = this.parseDate(dt);
    if (!date) {
      return String(dt);
    }
    return date.toLocaleDateString('fr-FR', {
      day:   '2-digit',
      month: 'long',
      year:  'numeric',
    });
  }

  formatTime(dt: Date | string): string {
    const date = this.parseDate(dt);
    if (!date) {
      return String(dt);
    }
    return date.toLocaleTimeString('fr-FR', {
      hour:   '2-digit',
      minute: '2-digit',
    });
  }

  formatValue(val: any): string {
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
  
  sanitizeFileName(input: string, maxLength = 100): string {
    // 1️⃣ On normalise les diacritiques (é → e, ç → c, …)
    let name = input.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

    // 2️⃣ On remplace les caractères interdits Windows/Linux par '-'
    //    <>:"/\\|?* et tout caractère de contrôle \x00–\x1F
    name = name.replace(/[<>:"\/\\|?*\x00-\x1F]/g, '-');

    // 3️⃣ On remplace les espaces multiples ou underscores par un seul '-'
    name = name.replace(/[\s_-]+/g, '-');

    // 4️⃣ On retire tout ce qui n’est pas alphanumérique, '-', ou '.'
    name = name.replace(/[^a-zA-Z0-9-\.]/g, '');

    // 5️⃣ Éviter les noms réservés Windows (CON, PRN, AUX, NUL, COM1…LPT9)
    const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
    if (reserved.test(name)) {
      name = '_' + name;
    }

    // 6️⃣ Tronquer pour ne pas dépasser maxLength
    if (name.length > maxLength) {
      // On garde l’extension si présente
      const extIndex = name.lastIndexOf('.');
      if (extIndex > 0) {
        const ext = name.slice(extIndex);
        const base = name.slice(0, extIndex).slice(0, maxLength - ext.length);
        name = base + ext;
      } else {
        name = name.slice(0, maxLength);
      }
    }

    // 7️⃣ Enfin, retirer tirets en début/fin
    name = name.replace(/^-+|-+$/g, '');

    return name;
  }

  /**
   * Handler pour la commande /event dispatch
   * Crée les channels d'équipe et déplace les membres du vocal courant.
   */
  public async handleDispatch(interaction: ChatInputCommandInteraction) {

    switch (interaction.options.getSubcommand()) {
      case 'dispatch':
        await this.sendDispatch(interaction);
        break;
      case 'scheduler':
        await this.handleScheduler(interaction);
        break;
      case 'createchannels':
        await this.handleCreateChannels(interaction);
        break;
    }
  }

  public async sendDispatch(interaction: ChatInputCommandInteraction) {
    // Vérifie que la commande est lancée dans un vocal
    const member = interaction.member as GuildMember;
    const voice = member.voice.channel;
    if (!voice || voice.type !== ChannelType.GuildVoice) {
      await interaction.followUp({ content: "Tu dois être dans un salon vocal pour utiliser cette commande.", ephemeral: true });
      return;
    }

    // Récupère l'event lié à la catégorie du vocal
    const event = await this.em.findOne(Event, { discord: { vocalParentId: voice.parentId } });
    if (!event) {
      await interaction.followUp({ content: "Aucun event associé à cette catégorie.", ephemeral: true });
      return;
    }

    // Récupère tous les membres dans le vocal
    const members = Array.from((voice as VoiceChannel).members.values());
    if (members.length === 0) {
      await interaction.followUp({ content: "Aucun membre à dispatcher.", ephemeral: true });
      return;
    }

    // Crée un channel par membre (exemple simple, à adapter pour des équipes)
    const createdChannels: string[] = [];
    const category = interaction.guild!.channels.cache.get(event.discord.vocalParentId!);
    if (!category || category.type !== ChannelType.GuildCategory) {
      await interaction.followUp({ content: "Catégorie d'équipe introuvable.", ephemeral: true });
      return;
    }
    for (const m of members) {
      // Cherche un channel existant dans la catégorie avec le nom attendu
      const existing = category.children.cache.find(
        ch => ch.type === ChannelType.GuildVoice && ch.name === `Équipe ${m.displayName}`
      );
      let teamChannel;
      if (existing) {
        teamChannel = existing;
      } else {
        teamChannel = await interaction.guild!.channels.create({
          name: `Équipe ${m.displayName}`,
          type: ChannelType.GuildVoice,
          parent: event.discord.vocalParentId!,
          reason: `Dispatch équipe pour ${event.name}`,
        });
        createdChannels.push(teamChannel.name);
      }
      if (teamChannel && teamChannel.type === ChannelType.GuildVoice) {
        await m.voice.setChannel(teamChannel.id);
      }
    }

    await interaction.reply({
      content: `Membres dispatchés dans les channels :\n${members.map(m => `- Équipe ${m.displayName}`).join('\n')}`,
      ephemeral: true,
    });
  }

  public async handleScheduler(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember | null;
    if (!member) {
      await interaction.followUp({ content: 'Commande réservée aux administrateurs.', ephemeral: true });
      return;
    }

    const guildMember = await this.bot.guild.members.fetch(member.id).catch(() => null);
    if (!guildMember) {
      await interaction.followUp({ content: 'Impossible de vérifier les permissions.', ephemeral: true });
      return;
    }

    // Autoriser le propriétaire de la guilde ou les membres avec la permission Administrateur
    if (!(guildMember.id === this.bot.guild.ownerId || guildMember.permissions.has('Administrator'))) {
      await interaction.followUp({ content: 'Seuls les administrateurs peuvent utiliser cette sous-commande.', ephemeral: true });
      return;
    }
    const count = await this.bot.schedulerManager.appEvent.sendEventsWeek();
    await interaction.followUp(`Les événements planifiés de la semaine ont été lancés. (${count} événements)`);
  }

  public async handleCreateChannels(interaction: ChatInputCommandInteraction) {
    const ownerId = process.env.ENGOO_ID;
    if (!ownerId || interaction.user.id !== ownerId) {
      await interaction.followUp({ content: '⛔ Sous-commande réservée à Engoo.', ephemeral: true });
      return;
    }

    const eventId = interaction.options.getInteger('event_id', true);
    const event = await this.em.findOne(Event, { id: eventId });
    if (!event) {
      await interaction.followUp({ content: `❌ Event introuvable pour l'ID ${eventId}.`, ephemeral: true });
      return;
    }

    await this.bot.schedulerManager.event.ensureEventVoiceChannels(event);
    await interaction.followUp({
      content: `✅ Channels vocaux créés pour l'event #${event.id} (${event.name}).`,
      ephemeral: true,
    });
  }

  public getSlashHandlers(): Record<string, CommandHandler> {
    return {
      eventHandler: this.handleDispatch.bind(this) as CommandHandler,
    };
  }

  /**
   * Combine la date de event.start et l'heure de lancServ ("HH:mm:ss") pour obtenir un Date complet.
   */
  combineDateAndTime(date: Date, time: Date): Date | null {
    if (!(date instanceof Date) || isNaN(date.getTime()) || !(time instanceof Date) || isNaN(time.getTime())) {
      return null;
    }
    const combined = new Date(date);
    combined.setHours(time.getHours(), time.getMinutes(), time.getSeconds(), time.getMilliseconds());
    return combined;
  }
}
