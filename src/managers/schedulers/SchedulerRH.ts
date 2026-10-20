import { listGuildMembers } from '../../utils/GuildMembers.js';
import { LockMode } from '@mikro-orm/core';
import type { BotManager } from '../../BotManager.js';
import { RecrutementDemande } from '../../entities/recrutement/RecrutementDemande.js';
import { getManagerLogger } from '../../logger.js';
import { expireArrivalPrefix } from '../../utils/ArrivalPrefix.js';
import { SafeMethod } from '../../exception/Safe.js';

const INACTIVITY_TIMEOUT = 7 * 24 * 60 * 60 * 1000;

export function recruitmentExpired(demande: RecrutementDemande, now: number): boolean {
    return (demande.status === 'waiting_rsi' || demande.status === 'review') && (!demande.pendingStatus || demande.pendingStatus === 'review') && now - demande.lastActivityAt.getTime() >= INACTIVITY_TIMEOUT;
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
            const requests = await this.bot.db.getEm().find(RecrutementDemande, { guildId: this.bot.guild.id });
            for (const demande of requests) {
                try {
                    const needsSync = await this.bot.db.getEm().transactional(async em => {
                        const current = await em.findOneOrFail(RecrutementDemande,
                            { id: demande.id, guildId: this.bot.guild.id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
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
