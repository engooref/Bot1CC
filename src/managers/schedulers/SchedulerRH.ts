import { listGuildMembers } from '../../utils/GuildMembers.js';
import { LockMode } from '@mikro-orm/core';
import type { BotManager } from '../../BotManager.js';
import { RecrutementDemande } from '../../entities/recrutement/RecrutementDemande.js';
import { getManagerLogger } from '../../logger.js';
import { expireArrivalPrefix } from '../../utils/ArrivalPrefix.js';
import { SafeMethod } from '../../exception/Safe.js';
import { notifyRH, staffLink } from '../../utils/NotifyRH.js';
import { SettingKeys } from '../../constants/SettingKeys.js';
import { settingsService } from '../../services/SettingsService.js';

const INACTIVITY_TIMEOUT = 7 * 24 * 60 * 60 * 1000;

export function recruitmentExpired(demande: RecrutementDemande, now: number): boolean {
    return (demande.status === 'waiting_rsi' || demande.status === 'review') && (!demande.pendingStatus || demande.pendingStatus === 'review') && now - demande.lastActivityAt.getTime() >= INACTIVITY_TIMEOUT;
}

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVIEW_REMINDER_DAYS = 3;

/** Date d'entrée dans l'étape Postulant, déduite de l'historique ; undefined si inconnue. */
export function postulantSince(demande: Pick<RecrutementDemande, 'decisions'>): number | undefined {
    for (let i = demande.decisions.length - 1; i >= 0; i--) {
        if (demande.decisions[i].to === 'postulant') {
            const at = Date.parse(demande.decisions[i].at);
            return Number.isNaN(at) ? undefined : at;
        }
    }
    return undefined;
}

export function interviewReminderDue(demande: Pick<RecrutementDemande, 'status' | 'pendingStatus' | 'decisions' | 'mentorship'>, now: number, days: number): boolean {
    if (demande.status !== 'postulant' || demande.pendingStatus) return false;
    const since = postulantSince(demande);
    if (since === undefined) return false;
    const last = demande.mentorship?.interviewRemindedAt ? Date.parse(demande.mentorship.interviewRemindedAt) : NaN;
    return now >= (Number.isNaN(last) ? since : last) + days * DAY;
}

export class SchedulerRH {
    private logger = getManagerLogger('SchedulerRH');
    private checking = false;

    constructor(private bot: BotManager) {
        setInterval(() => this.checkRH(), 5 * 60_000).unref();
        void this.checkRH();
    }

    @SafeMethod
    async checkRH(): Promise<void> {
        if (this.checking) return;
        this.checking = true;
        try {
            try {
                const members = await listGuildMembers(this.bot.guild);
                for (const member of members.values()) {
                    try {
                        await expireArrivalPrefix(member);
                        await this.bot.recrutementManager.onMember(member);
                    } catch (err) {
                        await this.logger.error({ err, applicantId: member.id }, 'Suivi du membre RH impossible');
                    }
                }
            } catch (err) {
                // Les dossiers connus et les parrainages restent traités si le recensement échoue.
                await this.logger.error({ err }, 'Liste des membres RH indisponible ; poursuite des dossiers existants');
            }
            try {
                await this.bot.recrutementManager.publishEngagement();
            } catch (err) {
                await this.logger.error({ err }, 'Publication Engagez-vous impossible');
            }
            try { await this.bot.parrainageManager?.check(); }
            catch (err) { await this.logger.error({ err }, 'Suivi des parrainages impossible'); }
            const reminderDays = await this.interviewReminderDays();
            const requests = await this.bot.db.getEm().find(RecrutementDemande, { guildId: this.bot.guild.id });
            for (const demande of requests) {
                try {
                    const needsSync = await this.bot.db.getEm().transactional(async em => {
                        const current = await em.findOneOrFail(RecrutementDemande,
                            { id: demande.id, guildId: this.bot.guild.id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
                        if (await this.alreadyMember(current)) {
                            current.pendingStatus = 'integrated';
                            current.needsSync = true;
                            current.decisions.push({ from: current.status, to: 'integrated', actorId: this.bot.user!.id,
                                at: new Date().toISOString(), reason: 'Rôle Membre déjà attribué : demande clôturée sans expiration.' });
                        }
                        if (recruitmentExpired(current, Date.now())) {
                            await this.refreshApplicantActivity(current);
                        }
                        if (recruitmentExpired(current, Date.now())) {
                            current.pendingStatus = 'expired';
                            current.needsSync = true;
                            current.decisions.push({ from: current.status, to: 'expired', actorId: this.bot.user!.id,
                                at: new Date().toISOString(), reason: '7 jours sans activité avant validation RSI par les RH.' });
                        }
                        await this.removeExpiredArrivalPrefix(current);
                        await this.remindInterview(current, reminderDays);
                        await em.flush();
                        return current.needsSync || !!current.pendingStatus;
                    });
                    if (needsSync) await this.bot.recrutementManager.resume(demande.id);
                } catch (err) {
                    await this.logger.error({ err, demandeId: demande.id }, 'Suivi de la demande RH impossible');
                }
            }
        } finally {
            this.checking = false;
        }
    }

    private async interviewReminderDays(): Promise<number> {
        const days = await settingsService.getInt(SettingKeys.bot.recrutement.interviewReminderDays, DEFAULT_INTERVIEW_REMINDER_DAYS);
        if (days > 0) return days;
        await this.logger.error({ days }, `Délai de rappel d'entretien invalide : ${DEFAULT_INTERVIEW_REMINDER_DAYS} jours utilisés`);
        return DEFAULT_INTERVIEW_REMINDER_DAYS;
    }

    /** Appelé dans la transaction verrouillée : l'envoi et l'enregistrement du rappel vont ensemble. */
    private async remindInterview(demande: RecrutementDemande, days: number) {
        const now = Date.now();
        if (!interviewReminderDue(demande, now, days)) return;
        const waited = Math.floor((now - postulantSince(demande)!) / DAY);
        await notifyRH(this.bot.guild, demande, `Le dossier de <@${demande.applicantId}> attend un entretien depuis ${waited} jours.\n${staffLink(demande)}`);
        demande.mentorship = { ...demande.mentorship, interviewRemindedAt: new Date(now).toISOString() };
    }

    private async alreadyMember(demande: RecrutementDemande): Promise<boolean> {
        const roleId = this.bot.roleMember?.id;
        if (!roleId || !(demande.status === 'waiting_rsi' || demande.status === 'review') || (demande.pendingStatus && demande.pendingStatus !== 'review')) {
            return false;
        }
        const member = await this.bot.guild.members.fetch({ user: demande.applicantId, force: true }).catch((err: { code?: number }) => {
            if (err.code === 10007) return null;
            throw err;
        });
        return !!member?.roles.cache.has(roleId);
    }

    private async refreshApplicantActivity(demande: RecrutementDemande) {
        if (!demande.channelId) {
            return;
        }
        const channel = await this.bot.guild.channels.fetch(demande.channelId);
        if (!channel?.isTextBased() || !('messages' in channel)) {
            throw new Error(`Ticket de recrutement introuvable : ${demande.channelId}`);
        }
        let before: string | undefined;
        for (;;) {
            const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
            if (!messages.size) {
                return;
            }
            const ordered = [...messages.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
            let latest;
            for (const message of ordered) {
                if (message.createdTimestamp <= demande.lastActivityAt.getTime()) break;
                if (await this.bot.recrutementManager.isRecruitmentActivity(message, demande)) {
                    latest = message;
                    break;
                }
            }
            if (latest) {
                demande.lastActivityAt = new Date(latest.createdTimestamp);
                return;
            }
            const oldest = ordered[ordered.length - 1];
            if (messages.size < 100 || oldest.createdTimestamp <= demande.lastActivityAt.getTime() || before === oldest.id) {
                return;
            }
            before = oldest.id;
        }
    }

    private async removeExpiredArrivalPrefix(demande: RecrutementDemande) {
        if (demande.arrivalTaggedAt && !demande.arrivalRemovedAt && Date.now() - demande.arrivalTaggedAt.getTime() >= INACTIVITY_TIMEOUT) {
            const member = await this.bot.guild.members.fetch(demande.applicantId).catch((error: { code?: number }) => {
                if (error.code === 10007) {
                    return null;
                }
                throw error;
            });
            if (member && /^\[A\]\s*/.test(member.displayName)) {
                try {
                    await member.setNickname(member.displayName.replace(/^\[A\]\s*/, ''), 'Fin du préfixe Arrivant');
                } catch (error) {
                    await this.logger.error({ err: error, memberId: member.id }, 'Impossible de modifier le pseudonyme du membre');
                }
            }
            demande.arrivalRemovedAt = new Date();
        }
    }

}
