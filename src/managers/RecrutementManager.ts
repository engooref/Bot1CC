import { SettingKeys } from '../constants/SettingKeys.js';
import { recruitmentNickname } from '../utils/ArrivalPrefix.js';
export { recruitmentNickname } from '../utils/ArrivalPrefix.js';
import { LockMode, type EntityManager } from '@mikro-orm/core';
import {
    AttachmentBuilder, ChannelType, EmbedBuilder, MessageFlags,
    PermissionFlagsBits as P,
    type ButtonInteraction, type ModalSubmitInteraction,
    type GuildMember, type Message, type TextChannel,
} from 'discord.js';
import type { BotManager } from '../BotManager.js';
import { settingsService } from '../services/SettingsService.js';
import { getManagerLogger } from '../logger.js';
import { RHMember } from '../entities/rh/RHMember.js';
import { RecrutementDemande, type RecrutementStatus } from '../entities/recrutement/RecrutementDemande.js';
import RecrutementView, { RecruitmentActions, recruitmentLabels } from '../view/RecrutementView.js';

const TICKET_PERMISSIONS = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory];

export function recruitmentTarget(action: string, status: RecrutementStatus): RecrutementStatus {
    if (action === RecruitmentActions.Submit && status === 'waiting_rsi') {
        return 'review';
    }
    if (action === RecruitmentActions.Validate && (status === 'waiting_rsi' || status === 'review')) {
        return 'postulant';
    }
    if (action === RecruitmentActions.Interview && status === 'postulant') {
        return 'candidate';
    }
    if (action === RecruitmentActions.ConfirmRefuse && (status === 'waiting_rsi' || status === 'review' || status === 'postulant')) {
        return 'refused';
    }
    throw new Error('Cette action ne correspond plus à l’état de la demande.');
}
export class RecrutementManager {

    private logger = getManagerLogger('RecrutementManager');

    private engagementPublishedChannel?: string;

    constructor(private bot: BotManager) { }

    private async getStaffRoleId(): Promise<string> {
        const roleId = await settingsService.get<string>(SettingKeys.site.roles.rh);
        if (typeof roleId !== 'string' || !/^\d{17,20}$/.test(roleId)) {
            throw new Error(`Le paramètre ${SettingKeys.site.roles.rh} doit contenir un seul ID de rôle RH.`);
        }
        return roleId;
    }

    private async isStaffMember(member: GuildMember): Promise<boolean> {
        if (member.permissions.has(P.Administrator)) return true;
        return member.roles.cache.has(await this.getStaffRoleId());
    }

    async isRecruitmentActivity(message: Message, demande: RecrutementDemande): Promise<boolean> {
        if (message.author.bot) return false;
        if (message.author.id === demande.applicantId) return true;
        const member = await this.bot.guild.members.fetch({ user: message.author.id, force: true }).catch((err: { code?: number }) => {
            if (err.code === 10007) return null;
            throw err;
        });
        return !!member && await this.isStaffMember(member);
    }

    private async getTextChannel(id: string): Promise<TextChannel> {
        const channel = id ? await this.bot.guild.channels.fetch(id) : null;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error(`Salon textuel de recrutement invalide : ${id || '(vide)'}`);
        }
        const me = await this.bot.guild.members.fetchMe();
        if (!channel.permissionsFor(me)?.has(TICKET_PERMISSIONS.concat(P.EmbedLinks))) {
            throw new Error(`Permissions insuffisantes dans ${id}`);
        }
        return channel;
    }

    private async withLockedRequest<T>(id: number, operation: (demande: RecrutementDemande, entityManager: EntityManager) => Promise<T>): Promise<T> {
        return this.bot.db.getEm().transactional(async (entityManager) => {
            const demande = await entityManager.findOneOrFail(RecrutementDemande, { id, guildId: this.bot.guild.id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
            return operation(demande, entityManager);
        });
    }


    async onMember(member: GuildMember) {
        if (member.guild.id !== this.bot.guild.id || member.user.bot || member.pending) {
            return;
        }
        const trigger = await settingsService.getString(SettingKeys.bot.roles.postulant);
        if (!trigger || !member.roles.cache.has(trigger)) {
            return;
        }
        await this.ensureRequest(member);
    }

    private async ensureRequest(member: GuildMember) {
        const trigger = await settingsService.getString(SettingKeys.bot.roles.postulant);
        if (!member.roles.cache.has(trigger) || member.roles.cache.has(this.bot.roleMember?.id ?? '')) {
            return;
        }

        const entityManager = this.bot.db.getEm();
        let demande = await entityManager.findOne(RecrutementDemande, { guildId: member.guild.id, applicantId: member.id });
        if (!demande) {
            const legacy = await entityManager.findOne(RHMember, { user: { discordId: member.id }, status: 'Candidatures' });
            if (legacy) {
                return;
            }
            const candidate = Object.assign(new RecrutementDemande(), { guildId: member.guild.id, applicantId: member.id,
                arrivalTaggedAt: new Date(member.joinedTimestamp ?? Date.now()) });
            try {
                await entityManager.persist(candidate).flush();
                demande = candidate;
            } catch (error) {
                demande = await this.bot.db.getEm().findOne(RecrutementDemande, { guildId: member.guild.id, applicantId: member.id });
                if (!demande) {
                    throw error;
                }
            }
        }
        if (demande.status === 'refused' || demande.status === 'expired' || demande.status === 'integrated') {
            return;
        }
        await this.resume(demande.id);
    }

    private async ensureTicket(demande: RecrutementDemande, entityManager: EntityManager) {
        const staffRoleId = await this.getStaffRoleId();
        const me = await this.bot.guild.members.fetchMe();
        if (!me.permissions.has([P.ManageRoles, P.ManageNicknames, P.ManageChannels])) {
            throw new Error('Le bot doit pouvoir gérer les rôles, pseudos et salons.');
        }
        if (!demande.channelId) {
            const categoryId = await settingsService.getString(SettingKeys.bot.recrutement.categoryAdmission);
            const category = categoryId ? await this.bot.guild.channels.fetch(categoryId) : null;
            if (!category || category.type !== ChannelType.GuildCategory || !category.permissionsFor(me)?.has(P.ManageChannels)) {
                throw new Error(`${SettingKeys.bot.recrutement.categoryAdmission} doit désigner une catégorie gérable.`);
            }
            const marker = `recrutement:${demande.guildId}:${demande.id}`;
            const channels = await this.bot.guild.channels.fetch();
            let ticket = channels.find(c => c?.type === ChannelType.GuildText && c.topic === marker) as TextChannel | undefined;
            if (!ticket) {
                const member = await this.bot.guild.members.fetch(demande.applicantId);
                ticket = await this.bot.guild.channels.create({
                    name: `admission-${member.user.username}`.slice(0, 100), type: ChannelType.GuildText,
                    parent: category.id, topic: marker,
                    permissionOverwrites: [
                        { id: this.bot.guild.id, deny: [P.ViewChannel] },
                        { id: demande.applicantId, allow: TICKET_PERMISSIONS },
                        { id: me.id, allow: [...TICKET_PERMISSIONS, P.ManageChannels, P.ManageMessages, P.EmbedLinks] },
                        { id: staffRoleId, allow: TICKET_PERMISSIONS },
                    ],
                });
            }
            demande.channelId = ticket.id;
            await entityManager.flush();
        }
    }

    private async syncPostulantAccess(demande: RecrutementDemande, entityManager: EntityManager) {
        const restricted = ['waiting_rsi', 'review'].includes(demande.status);
        const channels = await this.bot.guild.channels.fetch();
        const saved = demande.postulantChannelAccess ?? {};
        if (restricted) {
            const roleId = await settingsService.getString(SettingKeys.bot.roles.postulant);
            const role = roleId ? await this.bot.guild.roles.fetch(roleId) : null;
            if (!role) throw new Error('Le rôle Postulant est introuvable.');
            const admissionCategory = await settingsService.getString(SettingKeys.bot.recrutement.categoryAdmission);
            // Sauvegarder tous les états avant de modifier une catégorie synchronisée.
            for (const channel of channels.values()) {
                if (!channel || !('permissionOverwrites' in channel) || channel.id === demande.channelId || channel.id === admissionCategory) continue;
                const roleAccess = channel.permissionOverwrites.cache.get(role.id);
                const granted = roleAccess?.allow.has(P.ViewChannel)
                    || (!channel.permissionsFor(this.bot.guild.roles.everyone)?.has(P.ViewChannel)
                        && channel.permissionsFor(role)?.has(P.ViewChannel));
                if (!granted || saved[channel.id]) continue;
                const overwrite = channel.permissionOverwrites.cache.get(demande.applicantId);
                saved[channel.id] = {
                    hadOverwrite: !!overwrite,
                    viewChannel: overwrite?.allow.has(P.ViewChannel) ? true : overwrite?.deny.has(P.ViewChannel) ? false : null,
                };
            }
            demande.postulantChannelAccess = saved;
            await entityManager.flush();
            // Les enfants d’abord évitent de sauvegarder un refus propagé par leur catégorie.
            const ordered = [...channels.values()].sort((a, b) => Number(a?.type === ChannelType.GuildCategory) - Number(b?.type === ChannelType.GuildCategory));
            for (const channel of ordered) {
                if (!channel || !saved[channel.id] || !('permissionOverwrites' in channel)) continue;
                if (!channel.permissionOverwrites.cache.get(demande.applicantId)?.deny.has(P.ViewChannel)) {
                    await channel.permissionOverwrites.edit(demande.applicantId, { ViewChannel: false }, { reason: 'Recrutement : accès réservé à l’étape entretien vocal' });
                }
            }
        } else {
            // Restaurer uniquement ViewChannel, sans toucher aux autres droits individuels.
            const ordered = Object.keys(saved).sort((a, b) => Number(channels.get(b)?.type === ChannelType.GuildCategory) - Number(channels.get(a)?.type === ChannelType.GuildCategory));
            for (const channelId of ordered) {
                const channel = channels.get(channelId);
                const previous = saved[channelId];
                if (channel && 'permissionOverwrites' in channel) {
                    const overwrite = channel.permissionOverwrites.cache.get(demande.applicantId);
                    if (overwrite?.deny.has(P.ViewChannel)) {
                        const restored = await channel.permissionOverwrites.edit(demande.applicantId, { ViewChannel: previous.viewChannel }, { reason: 'Recrutement : fin du blocage des accès Postulant' });
                        if (!previous.hadOverwrite && restored.permissionOverwrites.cache.get(demande.applicantId)?.allow.bitfield === 0n
                            && restored.permissionOverwrites.cache.get(demande.applicantId)?.deny.bitfield === 0n) {
                            await channel.permissionOverwrites.delete(demande.applicantId);
                        }
                    }
                }
                delete saved[channelId];
            }
            demande.postulantChannelAccess = saved;
            await entityManager.flush();
        }
    }

    private async applyPendingStatus(demande: RecrutementDemande) {
        const target = demande.pendingStatus;
        if (!target) {
            return;
        }
        if (target === 'integrated') {
            return; // Déjà membre : aucun rôle ni accès à modifier.
        }
        const ticket = await this.getTextChannel(demande.channelId!);
        if (target === 'expired') {
            const member = await this.bot.guild.members.fetch({ user: demande.applicantId, force: true }).catch((err: { code?: number }) => {
                if (err.code === 10007) return null;
                throw err;
            });
            const roleId = await settingsService.getString(SettingKeys.bot.roles.postulant);
            if (member && roleId) await member.roles.remove(roleId, 'Ticket de recrutement expiré');
            await ticket.permissionOverwrites.edit(demande.applicantId, { ViewChannel: false, SendMessages: false, ReadMessageHistory: false });
            return;
        }
        const member = await this.bot.guild.members.fetch({ user: demande.applicantId, force: true });
        if (target === 'review') {
            const profile = await this.bot.userManager.initMemberRh(demande.applicantId);
            profile.status = 'Candidatures';
            profile.dateEntree = demande.submittedAt!;
            await this.bot.userManager.em.persist(profile).flush();
            return;
        }
        if (target === 'refused') {
            const removable = member.roles.cache.filter(r => r.id !== member.guild.id && !r.managed);
            if (removable.some(r => !r.editable)) {
                throw new Error('Le bot ne peut pas retirer tous les rôles : vérifier sa position.');
            }
            for (const id of removable.keys()) {
                await member.roles.remove(id, 'Candidature refusée');
            }
            try {
                await member.setNickname(recruitmentNickname(member.displayName, ''), 'Candidature refusée');
            } catch (error) {
                await this.logger.error({ err: error, memberId: member.id }, 'Impossible de modifier le pseudonyme du membre');
            }
        } else if (target === 'postulant') {
            const profile = await this.bot.userManager.initMemberRh(demande.applicantId);
            profile.status = 'Candidatures';
            profile.dateEntree = demande.submittedAt ?? new Date();
            await this.bot.userManager.em.persist(profile).flush();
            try {
                await member.setNickname(recruitmentNickname(member.displayName, '[P]'), 'Dépôt RSI validé');
            } catch (error) {
                await this.logger.error({ err: error, memberId: member.id }, 'Impossible de modifier le pseudonyme du membre');
            }
        } else {
            const postulantRoleId = await settingsService.getString(SettingKeys.bot.roles.postulant);
            const candidateRoleId = await settingsService.getString(SettingKeys.bot.recrutement.roleCandidat);
            if (!candidateRoleId || candidateRoleId === postulantRoleId || candidateRoleId === this.bot.roleMember?.id) {
                throw new Error('Le rôle Candidat doit être renseigné et distinct des rôles Postulant et Membre.');
            }
            await member.roles.add(candidateRoleId, 'Validation RH du recrutement');
            if (postulantRoleId) {
                await member.roles.remove(postulantRoleId, 'Changement de statut de recrutement');
            }
            try {
            await member.setNickname(recruitmentNickname(member.displayName, '[C-1CC]'));
            } catch (error) {
                await this.logger.error({ err: error, memberId: member.id }, 'Impossible de modifier le pseudonyme du membre');
            }
        }
    }

    private async notifySyncFailure(demande: RecrutementDemande, error: unknown) {
        const previousError = demande.lastError;
        demande.lastError = error instanceof Error ? error.message : String(error);
        if (previousError !== demande.lastError && demande.notificationChannelId) {
            try {
                const staffChannel = await this.bot.guild.channels.fetch(demande.notificationChannelId);
                if (staffChannel?.isThread() && staffChannel.archived) {
                    await staffChannel.setArchived(false);
                }
                if (staffChannel && (staffChannel.isThread() || staffChannel.type === ChannelType.GuildText)) {
                    await staffChannel.send({ content: `⚠️ Demande n°${demande.id} : opération non terminée, reprise automatique prévue. ${demande.lastError}`.slice(0, 1900), allowedMentions: { parse: [] } });
                }
            } catch (noticeError) {
                await this.logger.error({ err: noticeError, demandeId: demande.id }, 'Notification de reprise impossible');
            }
        }
    }

    async resume(id: number) {
        const error = await this.withLockedRequest(id, async (demande, entityManager) => {
            try {
                if (['waiting_rsi', 'review'].includes(demande.status)) {
                    await this.syncPostulantAccess(demande, entityManager);
                }
                await this.ensureTicket(demande, entityManager);
                if (demande.pendingStatus) {
                    await this.applyPendingStatus(demande);
                    demande.status = demande.pendingStatus;
                    demande.pendingStatus = undefined;
                    if (demande.status === 'candidate') {
                        demande.candidateAt = new Date();
                        demande.mentorship = { waitingSince: demande.candidateAt.toISOString() };
                    }
                    demande.needsSync = true;
                    await entityManager.flush();
                }
                if (!['waiting_rsi', 'review'].includes(demande.status) && Object.keys(demande.postulantChannelAccess ?? {}).length) {
                    await this.syncPostulantAccess(demande, entityManager);
                }
                if (['waiting_rsi', 'review', 'postulant'].includes(demande.status)) {
                    const member = await this.bot.guild.members.fetch({ user: demande.applicantId, force: true });
                    const nickname = recruitmentNickname(member.displayName, '[P]');
                    if (member.displayName !== nickname) {
                        try {
                            await member.setNickname(nickname, 'Demande de recrutement Postulant');
                        } catch (error) {
                            await this.logger.error({ err: error, memberId: member.id }, 'Impossible de modifier le pseudonyme du membre');
                        }
                    }
                }
                if (demande.needsSync) {
                    await this.syncMessages(demande, entityManager);
                    demande.needsSync = false;
                }
                demande.lastError = undefined;
                await entityManager.flush();
                return null;
            } catch (error) {
                await this.notifySyncFailure(demande, error);
                demande.needsSync = true;
                await entityManager.flush();
                return demande.lastError;
            }
        });
        if (error) {
            throw new Error(error);
        }
    }

    private async syncMessages(demande: RecrutementDemande, entityManager: EntityManager) {
        await this.syncWelcomeMessage(demande, entityManager);
        await this.syncTicketUpdate(demande, entityManager);
        await this.syncStaffNotification(demande, entityManager);
    }

    private async syncTicketUpdate(demande: RecrutementDemande, entityManager: EntityManager) {
        const decision = demande.decisions[demande.decisions.length - 1];
        if (!decision || decision.to !== demande.status || decision.ticketMessageId) return;

        const updates: Partial<Record<RecrutementStatus, string>> = {
            review: 'Votre dépôt de candidature RSI a bien été déclaré. Merci de patienter : les RH vont vérifier votre candidature et poursuivre le processus avec vous.',
            postulant: 'Les RH ont validé votre candidature RSI. La prochaine étape est un entretien vocal avec les RH : convenez d’un rendez-vous dans ce ticket. Les salons autorisés au rôle Postulant sont désormais accessibles. Le délai d’expiration de 7 jours ne s’applique plus.',
            candidate: 'Les RH ont validé votre entretien. Vous êtes désormais Candidat : votre préfixe est [C-1CC] et votre rôle Candidat vous a été attribué.',
            refused: 'Les RH ont refusé votre candidature. Votre parcours de recrutement est terminé.',
            expired: 'Votre ticket a été fermé après 7 jours sans activité. Votre rôle Postulant a été retiré.',
        };
        const update = updates[demande.status];
        if (!update) return;
        const ticket = await this.getTextChannel(demande.channelId!);
        const reason = demande.status === 'refused' && decision.reason ? `\nMotif : ${decision.reason}` : '';
        const message = await ticket.send({
            content: `<@${demande.applicantId}> — ${update}${reason}`,
            allowedMentions: { parse: [] },
        });
        decision.ticketMessageId = message.id;
        await entityManager.flush();
    }

    private async syncWelcomeMessage(demande: RecrutementDemande, entityManager: EntityManager) {
        const ticket = await this.getTextChannel(demande.channelId!);
        const decision = demande.decisions[demande.decisions.length - 1];
        const details = [`**${recruitmentLabels[demande.status]}**`];
        if (demande.status === 'review') {
            details.push('Votre dépôt de candidature RSI a bien été déclaré. Merci de patienter pendant que les RH vérifient votre candidature et poursuivent le processus.');
        }
        if (demande.status === 'waiting_rsi') {
            details.push('Vous avez 7 jours pour déposer votre candidature sur [la page RSI du 1CC](https://robertsspaceindustries.com/orgs/1CC). Les RH vérifieront ensuite votre inscription.',
                'Chaque message de votre part ou d’un membre du staff dans ce ticket relance le délai de 7 jours. Sans activité, le ticket sera fermé et votre rôle Postulant sera retiré.');
        } else if (demande.status === 'review') {
            details.push('Chaque message de votre part ou d’un membre du staff relance le délai de 7 jours. Ce délai reste applicable jusqu’à la validation RSI par les RH.');
        } else if (demande.status === 'postulant') {
            details.push('Votre candidature RSI est validée. Prenez rendez-vous pour un entretien vocal avec les RH. Les salons autorisés au rôle Postulant sont désormais accessibles. Le délai d’expiration de 7 jours ne s’applique plus.');
        } else if (demande.status === 'refused') {
            details.push('Les RH ont refusé votre candidature. Votre parcours de recrutement est terminé.');
        } else if (demande.status === 'expired') {
            details.push('Le ticket a été fermé après 7 jours sans activité. Votre rôle Postulant a été retiré. Contactez les RH pour une nouvelle demande.');
        }
        if (decision) {
            details.push(`Dernière décision : ${recruitmentLabels[decision.to]} — <@${decision.actorId}>.`, decision.reason || '');
        }
        if (demande.status === 'candidate') {
            details.push('Votre passage Candidat est validé. Les RH organisent votre parrainage pour découvrir l’ensemble du 1CC.');
        }
        const welcomeView = RecrutementView.ticket(this.bot, demande);
        const oldWelcome = demande.welcomeMessageId ? await ticket.messages.fetch(demande.welcomeMessageId).catch((error: { code?: number }) => {
            if (error.code === 10008) {
                return null;
            }
            throw error;
        }) : null;
        const welcome = await welcomeView.sendOrEdit(ticket, oldWelcome, {
            content: `<@${demande.applicantId}>`, allowedMentions: { parse: [] },
            embeds: [new EmbedBuilder().setTitle('Votre candidature 1CC').setDescription(details.join('\n\n')).setTimestamp(demande.openedAt)],
        });
        demande.welcomeMessageId = welcome.id;
        await entityManager.flush();
        if (!welcome.pinned) {
            await welcome.pin();
        }
    }

    private async syncStaffNotification(demande: RecrutementDemande, entityManager: EntityManager) {
        const decision = demande.decisions[demande.decisions.length - 1];
        if (!demande.notificationChannelId) {
            const staffChannel = await this.getTextChannel(await settingsService.getString(SettingKeys.bot.channels.rh));
            const me = await this.bot.guild.members.fetchMe();
            if (staffChannel.permissionsFor(this.bot.guild.roles.everyone)?.has(P.ViewChannel)) {
                throw new Error('Le salon RH doit être privé pour @everyone.');
            }
            if (!staffChannel.permissionsFor(me)?.has([P.CreatePublicThreads, P.SendMessagesInThreads])) {
                throw new Error('Le bot ne peut pas gérer le fil RH.');
            }
            await staffChannel.threads.fetchActive();
            const thread = staffChannel.threads.cache.find(t => t.name === 'Candidatures' && !t.archived)
                ?? await staffChannel.threads.create({ name: 'Candidatures', autoArchiveDuration: 10080 });
            demande.notificationChannelId = thread.id;
            await entityManager.flush();
        }
        const staffChannel = await this.bot.guild.channels.fetch(demande.notificationChannelId);
        if (!staffChannel || (!staffChannel.isThread() && staffChannel.type !== ChannelType.GuildText)) {
            throw new Error('Fil de suivi RH introuvable.');
        }
        if (staffChannel.isThread() && staffChannel.archived) {
            await staffChannel.setArchived(false);
        }
        const roleId = await this.getStaffRoleId();
        const rhRole = await this.bot.guild.roles.fetch(roleId);
        const member = await this.bot.guild.members.fetch(demande.applicantId);
        const openedAt = demande.openedAt.toLocaleString('fr-FR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
        const embed = new EmbedBuilder()
            .setTitle('Annonce Candidature')
            .setDescription(`<@&${roleId}>\nUn nouveau dossier vient d’être ouvert pour **${member.displayName}** le **${openedAt}**.\nMerci de bien vouloir prendre en charge cette candidature dès que possible.`)
            .setColor(rhRole?.color || 0x00AE86)
            .setThumbnail(member.user.displayAvatarURL())
            .addFields(
                { name: 'Lien vers la liste des candidatures', value: '[Candidatures 1CC](https://robertsspaceindustries.com/en/orgs/1CC/admin/applications)', inline: true },
                { name: 'Contacter le candidat', value: `[Envoyer un message privé](https://discord.com/users/${demande.applicantId})`, inline: true },
                { name: 'Ticket de recrutement', value: `<#${demande.channelId}>`, inline: true },
                { name: 'Parcours', value: recruitmentLabels[demande.status] },
            );
        if (demande.submittedAt) {
            embed.addFields({ name: 'Dépôt déclaré', value: demande.submittedAt.toISOString() });
        }
        if (demande.candidateAt) {
            embed.addFields({ name: 'Passage Candidat', value: demande.candidateAt.toISOString() });
        }
        if (demande.status === 'candidate' && this.bot.parrainageManager) {
            embed.addFields({ name: 'Parrainage', value: await this.bot.parrainageManager.summary(demande) });
        }
        if (decision) {
            embed.addFields({ name: 'Dernière décision', value: `<@${decision.actorId}> — ${decision.at}${decision.reason ? `\n${decision.reason}` : ''}`.slice(0, 1024) });
        }
        const old = demande.notificationMessageId ? await staffChannel.messages.fetch(demande.notificationMessageId).catch((error: { code?: number }) => {
            if (error.code === 10008) {
                return null;
            }
            throw error;
        }) : null;
        const notification = await RecrutementView.staff(this.bot, demande).sendOrEdit(staffChannel, old, {
            content: '',
            embeds: [embed],
            allowedMentions: { parse: [], roles: [], users: [] },
        });
        demande.notificationMessageId = notification.id;
        await entityManager.flush();
    }

    private async recordDecision(demandeId: number, interaction: ButtonInteraction | ModalSubmitInteraction, data: Record<string, unknown>) {
        await this.withLockedRequest(demandeId, async (demande, entityManager) => {
            const member = await this.bot.guild.members.fetch({ user: interaction.user.id, force: true });
            if (interaction.customId === RecruitmentActions.Submit) {
                if (demande.applicantId !== member.id || interaction.channelId !== demande.channelId) {
                    throw new Error('Seul le demandeur peut confirmer dans son ticket.');
                }
            } else if (!await this.isStaffMember(member)) {
                throw new Error('Action réservée aux RH et administrateurs.');
            }
            if (demande.pendingStatus) {
                throw new Error('Une opération est en cours de reprise. Les RH peuvent consulter les journaux.');
            }
            if (data.expectedStatus && data.expectedStatus !== demande.status) {
                throw new Error('La candidature a évolué depuis cette confirmation.');
            }
            const target = recruitmentTarget(interaction.customId, demande.status);
            demande.pendingStatus = target;
            demande.needsSync = true;
            if (target === 'review' || (target === 'postulant' && !demande.submittedAt)) {
                demande.submittedAt = new Date();
            }
            demande.decisions.push({ from: demande.status, to: target, actorId: member.id, at: new Date().toISOString(),
                reason: interaction.isModalSubmit() ? interaction.fields.getTextInputValue('reason').trim() : undefined });
            await entityManager.flush();
        });
    }

    async handler(interaction: ButtonInteraction | ModalSubmitInteraction, data: Record<string, unknown>) {
        try {
            if (interaction.guildId !== this.bot.guild.id) {
                throw new Error('Serveur invalide.');
            }
            if (interaction.customId === RecruitmentActions.Ticket) {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const demande = await this.bot.db.getEm().findOne(RecrutementDemande, { guildId: interaction.guildId, applicantId: interaction.user.id });
                let response = 'Sélectionnez « Je postule » dans l’intégration Discord. Si vous avez une ancienne candidature, contactez les RH.';
                if (demande) {
                    const hasActiveTicket = demande.channelId && !['refused', 'expired', 'integrated'].includes(demande.status);
                    response = hasActiveTicket
                        ? `Votre ticket : <#${demande.channelId}>`
                        : 'Votre demande est terminée. Contactez les RH.';
                }
                await interaction.editReply(response);
                return;
            }
            if (typeof data.demandeId !== 'number' || data.guildId !== interaction.guildId) {
                throw new Error('Contexte de candidature invalide.');
            }
            if (data.actorId && data.actorId !== interaction.user.id) {
                throw new Error('Cette confirmation ne vous appartient pas.');
            }
            if (interaction.customId === RecruitmentActions.Refuse && interaction.isButton()) {
                const member = await this.bot.guild.members.fetch({ user: interaction.user.id, force: true });
                if (!await this.isStaffMember(member)) {
                    throw new Error('Action réservée aux RH et administrateurs.');
                }
                const demande = await this.bot.db.getEm().findOneOrFail(RecrutementDemande, { id: data.demandeId, guildId: interaction.guildId });
                recruitmentTarget(RecruitmentActions.ConfirmRefuse, demande.status);
                const view = RecrutementView.refusal(this.bot, demande, interaction.user.id);
                await view.replyOrEditInteraction(interaction, { content: 'Confirmer le refus de cette candidature ? Un motif pourra être saisi.', flags: MessageFlags.Ephemeral }, true);
                return;
            }
            if (interaction.customId === RecruitmentActions.ConfirmRefuse && interaction.isButton()) {
                const member = await this.bot.guild.members.fetch({ user: interaction.user.id, force: true });
                if (!await this.isStaffMember(member)) {
                    throw new Error('Action réservée aux RH et administrateurs.');
                }
                const demande = await this.bot.db.getEm().findOneOrFail(RecrutementDemande, { id: data.demandeId, guildId: interaction.guildId });
                await interaction.showModal(RecrutementView.refusal(this.bot, demande, interaction.user.id).modal![0]);
                return;
            }
            const demandeId = data.demandeId;
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            await this.recordDecision(demandeId, interaction, data);
            await this.resume(demandeId);
            if (interaction.customId === RecruitmentActions.Interview && this.bot.parrainageManager) {
                await this.bot.parrainageManager.staffPanel(interaction, demandeId, true);
            } else await interaction.editReply('Demande mise à jour.');
        } catch (error) {
            await this.logger.error({ err: error }, 'Action de recrutement impossible');
            const content = `Action non terminée : ${error instanceof Error ? error.message : 'erreur interne'}. Une opération déjà enregistrée sera reprise automatiquement.`;
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content });
            } else {
                await interaction.reply({ content, flags: MessageFlags.Ephemeral });
            }
        }
    }

    async onMessage(message: Message) {
        if (message.author.bot || message.guildId !== this.bot.guild.id) {
            return;
        }
        const entityManager = this.bot.db.getEm();
        const demande = await entityManager.findOne(RecrutementDemande, { guildId: this.bot.guild.id, channelId: message.channelId });
        if (demande && await this.isRecruitmentActivity(message, demande)) {
            await this.withLockedRequest(demande.id, async (lockedRequest, transaction) => {
                if ((lockedRequest.status === 'waiting_rsi' || lockedRequest.status === 'review') && (!lockedRequest.pendingStatus || lockedRequest.pendingStatus === 'review') && message.createdTimestamp > lockedRequest.lastActivityAt.getTime()) {
                    lockedRequest.lastActivityAt = new Date(message.createdTimestamp);
                    await transaction.flush();
                }
            });
        }
    }

    async publishEngagement() {
        const channelId = await settingsService.getString(SettingKeys.bot.channels.enga);
        if (this.engagementPublishedChannel === channelId) {
            return;
        }
        const channel = await this.getTextChannel(channelId);
        const fetched = await channel.messages.fetch({ limit: 100 });
        const old = fetched.find(m => m.author.id === this.bot.user!.id && m.components.some(row => 'components' in row && row.components.some(c => 'customId' in c && (c.customId === RecruitmentActions.Ticket || c.customId === 'button_enga'))));
        await RecrutementView.public(this.bot).sendOrEdit(channel, old, {
            content: '### Rejoindre le 1er Corps Colonial\nSélectionnez « Je postule » dans l’intégration Discord : votre ticket privé sera créé automatiquement. Déposez ensuite votre candidature RSI et confirmez son dépôt dans ce ticket. Les RH prendront en charge votre demande.',
            files: [new AttachmentBuilder('res/AFFICHE-1CC.png')], attachments: [],
        });
        this.engagementPublishedChannel = channel.id;
    }
}
