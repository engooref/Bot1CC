import { SettingKeys } from '../constants/SettingKeys.js';
import {
    ButtonInteraction, ChannelType, EmbedBuilder, GuildMember, MessageFlags,
    ModalSubmitInteraction, PermissionFlagsBits, StringSelectMenuInteraction, TextChannel,
} from 'discord.js';
import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/core';
import { BotManager } from '../BotManager.js';
import { settingsService } from '../services/SettingsService.js';
import { getManagerLogger } from '../logger.js';
import type { InteractionData } from '../types/interaction.js';
import { JSONTypeComponent } from '../utils/Type.js';
import DiploView, { DiploActions, type DiploContext } from '../view/DiploView.js';
import { DiplomatieCorporation, DiplomatieDemande, DiplomatieDemandeStatut as Status } from '../entities/diplomatie/index.js';

type DiploInteraction = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;
type CorporationChoice = { id: number } | { name: string; channelId?: string };
class DiploError extends Error {}

export class DiploManager {
    private readonly logger = getManagerLogger('DiploManager');
    // Sérialise les créations de salons dans ce processus ; le verrou SQL protège les décisions.
    private queue: Promise<unknown> = Promise.resolve();

    constructor(private readonly bot: BotManager) {}

    private exclusive<T>(action: () => Promise<T>): Promise<T> {
        const task = this.queue.then(action);
        this.queue = task.catch(() => undefined);
        return task;
    }

    public async createRequest(member: GuildMember): Promise<void> {
        await this.exclusive(async () => {
            const em = this.bot.db.getEm();
            let demande = await em.findOne(DiplomatieDemande, {
                guildId: member.guild.id, applicantId: member.id, status: Status.Pending,
            });
            const roleId = await this.diplomatRole();
            const parent = await this.textChannel(await settingsService.getString(SettingKeys.bot.diplomatie.channelDemande));
            const staff = await this.textChannel(await settingsService.getString(SettingKeys.bot.diplomatie.channel));
            let thread = demande ? await member.guild.channels.fetch(demande.threadId) : null;
            if (!thread) {
                thread = await parent.threads.create({
                    name: `Diplomatie - ${member.displayName}`.slice(0, 100),
                    type: ChannelType.PrivateThread, autoArchiveDuration: 10080, invitable: false,
                    reason: `Demande de diplomatie de ${member.id}`,
                });
                if (demande) demande.threadId = thread.id;
                else demande = em.create(DiplomatieDemande, {
                    guildId: member.guild.id, applicantId: member.id, threadId: thread.id,
                    status: Status.Pending, requestedAt: new Date(),
                });
                try { await em.persistAndFlush(demande); }
                catch (err) {
                    try { await thread.delete('Échec de l’enregistrement de la demande'); }
                    catch (cleanupError) { await this.logger.error({ err: cleanupError }, 'Suppression du fil orphelin impossible'); }
                    throw err;
                }
                await thread.send({ content: `Bonjour <@${member.id}>, bienvenue dans ton fil privé de diplomatie. L’équipe diplomatique examinera ta demande ici.`, allowedMentions: { users: [member.id] } });
            }
            if (!thread.isThread() || !demande) throw new DiploError('Le fil de demande est introuvable.');
            if (thread.archived) await thread.setArchived(false);
            await thread.members.add(member.id);
            await member.guild.members.fetch();
            const role = await member.guild.roles.fetch(roleId);
            const additions = await Promise.allSettled(role!.members.map(diplomat => thread.members.add(diplomat.id)));
            for (const result of additions) if (result.status === 'rejected') {
                await this.logger.warn({ err: result.reason }, 'Ajout d’un diplomate au fil impossible');
            }

            let notificationChannel = demande.notificationChannelId
                ? await member.guild.channels.fetch(demande.notificationChannelId) : null;
            if (!notificationChannel) {
                await staff.threads.fetchActive();
                notificationChannel = staff.threads.cache.find(t => t.name === 'Demandes Diplomaties' && !t.archived)
                    ?? await staff.threads.create({ name: 'Demandes Diplomaties', autoArchiveDuration: 10080 });
            }
            if (!notificationChannel.isThread() && notificationChannel.type !== ChannelType.GuildText) {
                throw new DiploError('Le salon de suivi des demandes est invalide.');
            }
            if (notificationChannel.isThread() && notificationChannel.archived) await notificationChannel.setArchived(false);
            const view = new DiploView(this.bot, { demandeId: demande.id, guildId: member.guild.id });
            const options = {
                content: `<@&${roleId}>`, allowedMentions: { roles: [roleId] },
                embeds: [new EmbedBuilder().setTitle('Demande de diplomatie').setColor(role!.hexColor)
                    .setDescription(`Nouvelle demande de <@${member.id}>.`)
                    .addFields({ name: 'Contacter le candidat', value: `[Ouvrir le fil](https://discord.com/channels/${member.guild.id}/${thread.id})` })
                    .setThumbnail(member.displayAvatarURL()).setTimestamp(demande.requestedAt)],
            };
            let message;
            if (demande.notificationMessageId) {
                try { message = await notificationChannel.messages.fetch(demande.notificationMessageId); }
                catch (err) { if ((err as { code?: number }).code !== 10008) throw err; }
            }
            message = message ? await view.edit(message, options) : await view.send(notificationChannel, options);
            demande.notificationChannelId = notificationChannel.id;
            demande.notificationMessageId = message.id;
            await em.flush();
        });
    }

    public async handlerResponse(interaction: DiploInteraction, data: InteractionData): Promise<void> {
        try {
            // Le formulaire n’effectue aucune mutation ; l’autorisation est revérifiée à sa soumission.
            if (interaction.isButton() && interaction.customId === DiploActions.Create) {
                if (!this.isContext(data) || data.guildId !== interaction.guildId || data.actorId !== interaction.user.id) {
                    await interaction.reply({ content: 'Ce choix de corporation ne vous appartient pas.', flags: MessageFlags.Ephemeral });
                    return;
                }
                const view = new DiploView(this.bot, data, DiploView.corporationForm());
                await interaction.showModal(view.modal![0]);
                return;
            }
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            if (interaction.guildId !== this.bot.guild.id) throw new DiploError('Cette demande appartient à un autre serveur.');
            const roleId = await this.diplomatRole();
            const member = await this.bot.guild.members.fetch({ user: interaction.user.id, force: true });
            if (!member.roles.cache.has(roleId) && member.id !== process.env.ENGOO_ID) throw new DiploError('Cette action est réservée aux diplomates.');
            if (data.actorId && data.actorId !== interaction.user.id) throw new DiploError('Ce formulaire appartient à un autre diplomate.');
            const demande = await this.resolveRequest(interaction, data);
            if (interaction.customId === DiploActions.Cancel) {
                await interaction.editReply('Action annulée. Aucune décision supplémentaire n’a été enregistrée.');
                return;
            }
            if (demande.status !== Status.Pending) {
                const warnings = await this.finish(demande);
                await interaction.editReply(`Cette demande est déjà ${demande.status === Status.Accepted ? 'acceptée' : 'refusée'}.${warnings}`);
                return;
            }
            const context: DiploContext = { demandeId: demande.id, guildId: demande.guildId, actorId: interaction.user.id };
            switch (interaction.customId) {
                case DiploActions.Accept:
                case DiploActions.Previous:
                case DiploActions.Next: {
                    if (!interaction.isButton()) throw new DiploError('Action invalide.');
                    const page = Number.isSafeInteger(data.page) ? Number(data.page) : 0;
                    context.page = Math.max(0, page + (interaction.customId === DiploActions.Next ? 1 : interaction.customId === DiploActions.Previous ? -1 : 0));
                    const em = this.bot.db.getEm();
                    const total = await em.count(DiplomatieCorporation, { guildId: demande.guildId });
                    context.page = Math.min(context.page, Math.max(0, Math.ceil(total / 25) - 1));
                    const corporations = await em.find(DiplomatieCorporation, { guildId: demande.guildId }, {
                        orderBy: { name: 'asc', id: 'asc' }, limit: 25, offset: context.page * 25,
                    });
                    await DiploView.corporations(this.bot, context, corporations, total).replyOrEditInteraction(interaction, {
                        content: `Choisissez la corporation du candidat (page ${context.page + 1}/${Math.max(1, Math.ceil(total / 25))}). Vous pouvez aussi créer une corporation ou associer son salon existant.`,
                    }, true);
                    return;
                }
                case DiploActions.Select: {
                    if (!interaction.isStringSelectMenu()) throw new DiploError('Sélection invalide.');
                    const corporation = await this.bot.db.getEm().findOne(DiplomatieCorporation, {
                        id: this.positiveId(interaction.values[0]), guildId: demande.guildId,
                    });
                    if (!corporation) throw new DiploError('Corporation introuvable.');
                    context.corporationId = corporation.id;
                    await DiploView.confirmation(this.bot, context, true).replyOrEditInteraction(interaction, {
                        content: `Accorder à <@${demande.applicantId}> l’accès au salon <#${corporation.channelId}> et accepter sa demande ?`, allowedMentions: { parse: [] },
                    }, true);
                    return;
                }
                case DiploActions.Refuse:
                    await DiploView.confirmation(this.bot, context, false).replyOrEditInteraction(interaction, {
                        content: 'Confirmer le refus ? Le candidat sera informé dans son fil, puis celui-ci sera archivé.',
                    }, true);
                    return;
                case DiploActions.ConfirmAccept: {
                    if (!interaction.isButton()) throw new DiploError('Action invalide.');
                    const result = await this.acceptDiplomacy(demande.id, interaction.user.id, { id: this.positiveId(data.corporationId) });
                    await interaction.editReply(`Demande acceptée. Le candidat a accès à <#${result.corporation!.channelId}>.${await this.finish(result)}`);
                    return;
                }
                case DiploActions.CorporationForm: {
                    if (!interaction.isModalSubmit()) throw new DiploError('Formulaire invalide.');
                    const name = interaction.fields.getTextInputValue('name').normalize('NFKC').trim().replace(/\s+/g, ' ');
                    const channelId = interaction.fields.getTextInputValue('channelId').trim().replace(/^<#(\d+)>$/, '$1');
                    if (!name || name.length > 100) throw new DiploError('Le nom doit contenir entre 1 et 100 caractères.');
                    if (channelId && !/^\d{17,20}$/.test(channelId)) throw new DiploError('Indiquez l’ID Discord du salon existant, ou laissez ce champ vide.');
                    const result = await this.acceptDiplomacy(demande.id, interaction.user.id, { name, channelId: channelId || undefined });
                    await interaction.editReply(`Demande acceptée. Le candidat a accès à <#${result.corporation!.channelId}>.${await this.finish(result)}`);
                    return;
                }
                case DiploActions.ConfirmRefuse: {
                    if (!interaction.isButton()) throw new DiploError('Action invalide.');
                    const result = await this.refuseDiplomacy(demande.id, interaction.user.id);
                    await interaction.editReply(`Demande refusée.${await this.finish(result)}`);
                    return;
                }
                default: throw new DiploError('Action de diplomatie inconnue.');
            }
        } catch (err) {
            await this.logger.error({ err }, 'Erreur de traitement de la diplomatie');
            const content = err instanceof DiploError ? err.message : 'Le traitement a échoué. Vous pouvez réessayer depuis la notification de demande.';
            if (interaction.deferred || interaction.replied) await interaction.editReply({ content, components: [] });
            else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        }
    }

    private isContext(data: InteractionData): data is DiploContext {
        return Number.isSafeInteger(data.demandeId) && Number(data.demandeId) > 0 && typeof data.guildId === 'string';
    }

    private positiveId(value: unknown): number {
        const id = Number(value);
        if (!Number.isSafeInteger(id) || id <= 0) throw new DiploError('Identifiant invalide.');
        return id;
    }

    private async resolveRequest(interaction: DiploInteraction, data: InteractionData): Promise<DiplomatieDemande> {
        if (data.guildId !== interaction.guildId) throw new DiploError('Contexte de demande invalide.');
        return this.exclusive(async () => {
            const em = this.bot.db.getEm();
            if (this.isContext(data)) {
                const demande = await em.findOne(DiplomatieDemande, { id: data.demandeId, guildId: this.bot.guild.id }, { populate: ['corporation'] });
                if (!demande) throw new DiploError('Demande introuvable.');
                return demande;
            }
            // Compatibilité avec les notifications envoyées par le premier squelette.
            if (!interaction.isButton() || ![DiploActions.Accept, DiploActions.Refuse].includes(interaction.customId as DiploActions)
                || typeof data.applicantId !== 'string' || typeof data.threadId !== 'string'
                || !/^\d+$/.test(data.applicantId) || !/^\d+$/.test(data.threadId)) throw new DiploError('Contexte de demande invalide.');
            let demande = await em.findOne(DiplomatieDemande, { guildId: this.bot.guild.id, threadId: data.threadId });
            if (!demande) {
                demande = em.create(DiplomatieDemande, {
                    guildId: this.bot.guild.id, applicantId: data.applicantId, threadId: data.threadId,
                    notificationChannelId: interaction.channelId, notificationMessageId: interaction.message.id,
                    status: Status.Pending, requestedAt: new Date(interaction.message.createdTimestamp),
                });
                await em.persistAndFlush(demande);
            }
            return demande;
        });
    }

    private async diplomatRole(): Promise<string> {
        const id = await settingsService.getString(SettingKeys.bot.diplomatie.role);
        if (!id || !await this.bot.guild.roles.fetch(id)) throw new DiploError('Le rôle diplomate doit être configuré.');
        return id;
    }

    private async textChannel(id: string): Promise<TextChannel> {
        if (!id) throw new DiploError('Un salon de diplomatie n’est pas configuré.');
        const channel = await this.bot.guild.channels.fetch(id);
        if (channel?.type !== ChannelType.GuildText) throw new DiploError('Le salon configuré doit être un salon textuel de ce serveur.');
        return channel;
    }

    private async lockedRequest(em: EntityManager, id: number): Promise<DiplomatieDemande> {
        const demande = await em.findOne(DiplomatieDemande, { id, guildId: this.bot.guild.id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
        if (!demande) throw new DiploError('Demande introuvable.');
        if (demande.status !== Status.Pending) throw new DiploError('Cette demande a déjà été traitée.');
        return demande;
    }

    public async acceptDiplomacy(id: number, diplomatId: string, choice: CorporationChoice): Promise<DiplomatieDemande> {
        return this.exclusive(async () => {
            const undo: Array<() => Promise<unknown>> = [];
            try {
                return await this.bot.db.getEm().transactional(async em => {
                    const demande = await this.lockedRequest(em, id);
                    const roleId = await this.diplomatRole();
                    await this.bot.guild.members.fetch({ user: demande.applicantId, force: true });
                    let corporation: DiplomatieCorporation | null;
                    if ('id' in choice) {
                        corporation = await em.findOne(DiplomatieCorporation, { id: choice.id, guildId: demande.guildId });
                        if (!corporation) throw new DiploError('Corporation introuvable.');
                    } else {
                        corporation = await em.findOne(DiplomatieCorporation, { guildId: demande.guildId, name: choice.name });
                        if (corporation && choice.channelId && corporation.channelId !== choice.channelId) {
                            throw new DiploError('Ce nom de corporation est déjà associé à un autre salon.');
                        }
                        if (!corporation) {
                            let channel: TextChannel;
                            if (choice.channelId) {
                                channel = await this.textChannel(choice.channelId);
                                if (await em.findOne(DiplomatieCorporation, { channelId: channel.id })) throw new DiploError('Ce salon est déjà associé à une corporation.');
                                const reserved = await Promise.all([SettingKeys.bot.diplomatie.channel, SettingKeys.bot.diplomatie.channelDemande].map(key => settingsService.getString(key)));
                                if (reserved.includes(channel.id)) throw new DiploError('Le salon de suivi ou de candidature ne peut pas devenir un salon de corporation.');
                            } else {
                                const categoryId = await settingsService.getString(SettingKeys.bot.diplomatie.categoryCorporations);
                                const category = categoryId ? await this.bot.guild.channels.fetch(categoryId) : null;
                                if (category?.type !== ChannelType.GuildCategory) throw new DiploError('Configurez la catégorie des corporations : bot.diplomatie.category_corporations.');
                                const allow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory];
                                channel = await this.bot.guild.channels.create({
                                    name: `ambassade-${choice.name}`.slice(0, 100), type: ChannelType.GuildText, parent: category.id,
                                    permissionOverwrites: [
                                        { id: this.bot.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                                        { id: roleId, allow },
                                        { id: this.bot.user!.id, allow: [...allow, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles] },
                                    ], reason: `Corporation créée par ${diplomatId}`,
                                });
                                undo.push(() => channel.delete('Annulation de la création de corporation après échec'));
                            }
                            corporation = em.create(DiplomatieCorporation, { guildId: demande.guildId, name: choice.name, channelId: channel.id, createdAt: new Date() });
                            await em.persistAndFlush(corporation);
                        }
                    }
                    const channel = await this.textChannel(corporation.channelId);
                    if (channel.permissionsFor(this.bot.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)) {
                        throw new DiploError('Ce salon est public. Rendez-le privé avant de l’associer à une corporation.');
                    }
                    // Préserve les représentants et permissions déjà présents dans un salon existant.
                    await this.grantAccess(channel, roleId, undo);
                    await this.grantAccess(channel, demande.applicantId, undo);
                    demande.corporation = corporation;
                    demande.status = Status.Accepted;
                    demande.processedById = diplomatId;
                    demande.processedAt = new Date();
                    await em.flush();
                    return demande;
                });
            } catch (err) {
                for (const compensate of undo.reverse()) {
                    try { await compensate(); }
                    catch (rollbackError) { await this.logger.error({ err: rollbackError }, 'Restauration Discord après échec de diplomatie impossible'); }
                }
                throw err;
            }
        });
    }

    private async grantAccess(channel: TextChannel, id: string, undo: Array<() => Promise<unknown>>): Promise<void> {
        const previous = channel.permissionOverwrites.cache.get(id);
        const permissions = { ViewChannel: true, SendMessages: true, ReadMessageHistory: true };
        const restore = Object.fromEntries(Object.keys(permissions).map(key => {
            const bit = PermissionFlagsBits[key as keyof typeof permissions];
            return [key, previous?.allow.has(bit) ? true : previous?.deny.has(bit) ? false : null];
        }));
        await channel.permissionOverwrites.edit(id, permissions);
        undo.push(() => previous ? channel.permissionOverwrites.edit(id, restore) : channel.permissionOverwrites.delete(id));
    }

    public async refuseDiplomacy(id: number, diplomatId: string): Promise<DiplomatieDemande> {
        return this.exclusive(() => this.bot.db.getEm().transactional(async em => {
            const demande = await this.lockedRequest(em, id);
            demande.status = Status.Refused;
            demande.processedById = diplomatId;
            demande.processedAt = new Date();
            await em.flush();
            return demande;
        }));
    }

    /** Une erreur de notification ne doit jamais annuler une décision déjà enregistrée. */
    private async finish(demande: DiplomatieDemande): Promise<string> {
        return this.exclusive(() => this.finalizeRequest(demande));
    }

    private async finalizeRequest(demande: DiplomatieDemande): Promise<string> {
        const errors: string[] = [];
        const accepted = demande.status === Status.Accepted;
        try {
            const thread = await this.bot.guild.channels.fetch(demande.threadId);
            if (!thread?.isThread()) throw new Error('Fil de candidature absent');
            // Le message de clôture identifiable évite les doublons lors d’une reprise.
            const marker = `Diplomatie #${demande.id}`;
            const messages = await thread.messages.fetch({ limit: 100 });
            if (!messages.some(message => message.author.id === this.bot.user!.id && message.embeds.some(embed => embed.footer?.text === marker))) {
                if (thread.archived) await thread.setArchived(false);
                await thread.send({
                    embeds: [new EmbedBuilder().setDescription(accepted
                        ? `Votre demande est acceptée. Vous pouvez poursuivre les échanges dans <#${demande.corporation!.channelId}>.`
                        : 'Votre demande de diplomatie a été refusée. Ce fil va être archivé.')
                        .setFooter({ text: marker })], allowedMentions: { parse: [] },
                });
            }
            if (!thread.locked) await thread.setLocked(true, 'Demande de diplomatie traitée');
            if (!thread.archived) await thread.setArchived(true, 'Demande de diplomatie traitée');
        } catch (err) {
            errors.push('clôture du fil');
            await this.logger.error({ err, demandeId: demande.id }, 'Clôture du fil de diplomatie impossible');
        }
        try {
            if (!demande.notificationChannelId || !demande.notificationMessageId) throw new Error('Notification absente');
            const channel = await this.bot.guild.channels.fetch(demande.notificationChannelId);
            if (!channel?.isTextBased()) throw new Error('Salon de notification absent');
            if (channel.isThread() && channel.archived) await channel.setArchived(false);
            const message = await channel.messages.fetch(demande.notificationMessageId);
            const options: import('discord.js').MessageEditOptions = {
                content: '', components: [], allowedMentions: { parse: [] },
                embeds: [new EmbedBuilder().setTitle(`Demande de diplomatie ${accepted ? 'acceptée' : 'refusée'}`)
                    .setColor(accepted ? 0x57F287 : 0xED4245)
                    .setDescription(`Candidat : <@${demande.applicantId}>\nTraitée par : <@${demande.processedById}>${accepted ? `\nCorporation : ${demande.corporation!.name}\nSalon : <#${demande.corporation!.channelId}>` : ''}`)
                    .setTimestamp(demande.processedAt ?? new Date())],
            };
            if (errors.length) {
                await new DiploView(this.bot, { demandeId: demande.id, guildId: demande.guildId }, [{
                    type: JSONTypeComponent.Button, customId: DiploActions.Retry,
                    label: 'Réessayer la clôture', style: 'Secondary',
                }]).edit(message, options);
            } else {
                await message.edit(options);
            }
        } catch (err) {
            errors.push('mise à jour de la notification');
            await this.logger.error({ err, demandeId: demande.id }, 'Notification de décision impossible');
        }
        return errors.length ? ` Décision enregistrée, mais ${errors.join(' et ')} à reprendre avec le bouton de la notification.` : '';
    }
}
