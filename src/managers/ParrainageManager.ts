import { listGuildMembers } from '../utils/GuildMembers.js';
import { LockMode, type EntityManager } from '@mikro-orm/core';
import { ChannelType, MessageFlags, PermissionFlagsBits as P, type GuildMember, type DMChannel, type TextChannel } from 'discord.js';
import type { BotManager } from '../BotManager.js';
import { RecrutementDemande as Demande, type RecruitmentMentorship } from '../entities/recrutement/RecrutementDemande.js';
import { RecrutementParrainage as Attribution, type ParrainAvis } from '../entities/recrutement/RecrutementParrainage.js';
import { ParrainPreference as Preference } from '../entities/recrutement/ParrainPreference.js';
import { SettingKeys } from '../constants/SettingKeys.js';
import { settingsService } from '../services/SettingsService.js';
import { getManagerLogger } from '../logger.js';
import { DEFAULT_CANDIDATE_PERIOD_DAYS, candidatePeriodDays, daysToMs, extensionDays, formatDays, mentorReminderDays, mentorWaitDays } from '../utils/RecruitmentDelays.js';
import View, { mentoraEmbed, parrainButton as button, parrainSelect as select } from '../view/ParrainageView.js';
import type { ComponentInteraction } from '../view/BaseView.js';
import { JSONTypeComponent as T, type JSONComponent, type ModalField } from '../utils/Type.js';
import { notifyRH, staffLink } from '../utils/NotifyRH.js';
import type { CommandHandler } from '../utils/SlashCommandManager.js';

type Context = Record<string, unknown>;
type PeriodSource = Pick<Demande, 'status' | 'candidateAt' | 'mentorship'>;
/**
 * Fin de la période de candidat : début (`periodStartAt` si « le mois repart », sinon `candidateAt`)
 * + durée du paramètre + jours de prolongation cumulés. `null` tant que la date de départ est inconnue.
 */
export function candidatePeriodEnd(d: Pick<Demande, 'candidateAt' | 'mentorship'>, periodDays = DEFAULT_CANDIDATE_PERIOD_DAYS): Date | null {
    const raw = d.mentorship?.periodStartAt;
    const parsed = raw ? Date.parse(raw) : NaN;
    const start = Number.isNaN(parsed) ? d.candidateAt?.getTime() : parsed;
    if (start === undefined) return null;
    const extra = d.mentorship?.periodExtraDays;
    return new Date(start + daysToMs(periodDays + (typeof extra === 'number' && extra > 0 ? extra : 0)));
}
export function candidatePeriodEnded(d: PeriodSource, now = Date.now(), periodDays = DEFAULT_CANDIDATE_PERIOD_DAYS): boolean {
    const end = candidatePeriodEnd(d, periodDays);
    return d.status === 'candidate' && !d.mentorship?.closedAt && !!end && now >= end.getTime();
}
/** Une relance est due si aucune n'a eu lieu depuis la fin de la période, ou si la dernière date de `intervalDays` jours ou plus. */
export function reminderDue(lastAt: string | undefined, periodEnd: Date, now: number, intervalDays: number): boolean {
    const last = lastAt ? Date.parse(lastAt) : NaN;
    return Number.isNaN(last) || last < periodEnd.getTime() || now - last >= daysToMs(intervalDays);
}
/** Durée de prolongation saisie par les RH : entier de 1 à 365 jours. */
export function parseExtensionDays(raw: string): number {
    const text = raw.trim();
    const days = Number(text);
    if (!/^\d+$/.test(text) || days < 1 || days > 365) throw new Error('Durée de prolongation : un nombre entier de jours entre 1 et 365');
    return days;
}
/** Prolonger : les jours s'ajoutent aux prolongations précédentes (sans limite) et les relances repartent de zéro. Les autres clés sont conservées. */
export function extendedMentorship(m: RecruitmentMentorship | undefined, days: number): RecruitmentMentorship {
    const previous = typeof m?.periodExtraDays === 'number' && m.periodExtraDays > 0 ? m.periodExtraDays : 0;
    return { ...m, periodExtraDays: previous + days, periodRemindedAt: undefined, mentorRemindedAt: undefined };
}
/** Réaffecter : « le mois continue » ne change que les relances ; « le mois repart » fixe un nouveau début sans prolongation héritée. */
export function reassignedMentorship(m: RecruitmentMentorship | undefined, restart: boolean, now = new Date()): RecruitmentMentorship {
    return { ...m, ...(restart ? { periodStartAt: now.toISOString(), periodExtraDays: undefined } : {}), periodRemindedAt: undefined, mentorRemindedAt: undefined };
}
export type SiteAcceptance = { ok: true } | { ok: false; message: string };
/** Message clair pour le RH selon la réponse du site à l'acceptation (rien n'est enregistré côté bot en cas d'échec). */
export function siteAcceptanceFailure(status: number): string {
    const fallback = 'Vous pouvez accepter le candidat depuis le site.';
    if (status === 403) return `Le site refuse l’acceptation (autorisation). ${fallback}`;
    if (status === 404) return `Le site ne connaît pas cette route ou ce candidat (HTTP 404). ${fallback}`;
    if (status === 409) return `Le candidat n’a pas de compte sur le site : l’acceptation est impossible tant qu’il n’en a pas. ${fallback}`;
    return `Le site a répondu une erreur (HTTP ${status}). ${fallback}`;
}
/**
 * Demande l'acceptation d'un candidat au site (POST /api/internal/bot/candidatures/accept), qui porte toute la logique.
 * Adresse et jeton : `URL_SITE` et `BOT_TOKEN`, comme `SettingsService`. Délai de 10 s, aucune relance.
 */
export async function requestSiteAcceptance(discordId: string, actorId: string, fetcher: typeof fetch = fetch): Promise<SiteAcceptance> {
    const base = process.env.URL_SITE, token = process.env.BOT_TOKEN;
    if (!base || !token) return { ok: false, message: 'Le bot n’est pas configuré pour joindre le site. Vous pouvez accepter le candidat depuis le site.' };
    try {
        const response = await fetcher(`${base.replace(/\/+$/, '')}/api/internal/bot/candidatures/accept`, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-BOT-TOKEN': token },
            body: JSON.stringify({ discordId, actorId }),
            signal: AbortSignal.timeout(10_000),
        });
        return response.ok ? { ok: true } : { ok: false, message: siteAcceptanceFailure(response.status) };
    } catch {
        return { ok: false, message: 'Le site est injoignable (ou n’a pas répondu en 10 secondes). Vous pouvez accepter le candidat depuis le site.' };
    }
}
const PERMISSIONS = ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] as const;
const AVIS: Record<ParrainAvis, string> = { favorable: 'Favorable', prolonger: 'À prolonger', defavorable: 'Défavorable' };
/** Avis proposés au mentor : « prolonger » est désormais une décision des RH (il reste lisible dans les anciens bilans). */
const AVIS_PROPOSES: ParrainAvis[] = ['favorable', 'defavorable'];
export function parrainCapacity(value: unknown): number {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 && n <= 100 ? n : 2;
}
export function parrainAvailability(paused: boolean, count: number, capacity: number): string {
    return paused ? 'En pause' : count >= capacity ? 'Complet' : 'Disponible';
}
/** Minuit Europe/Paris, sans dépendre du fuseau du processus. */
export function parseParrainReturn(value: string, now = new Date()): Date | undefined {
    if (!value.trim()) return undefined;
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
    if (!match) throw new Error('Date attendue : JJ/MM/AAAA');
    const [, day, month, year] = match.map(Number);
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) throw new Error('Date invalide');
    const hour = Number(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).formatToParts(utc).find(part => part.type === 'hour')!.value);
    const result = new Date(utc.getTime() - hour * 3600000);
    if (result <= now) throw new Error('La date de retour doit être future');
    return result;
}

export class ParrainageManager {
    private logger = getManagerLogger('ParrainageManager');
    private checking = false;
    constructor(private bot: BotManager) {}
    getSlashHandlers(): Record<string, CommandHandler> {
        return { parrain: async interaction => {
            if (!interaction.isChatInputCommand()) return;
            if (interaction.guildId !== this.bot.guild.id) {
                await interaction.editReply('Lancez /parrain sur le serveur 1CC.'); return;
            }
            await this.handler(interaction, { guildId: this.bot.guild.id, actorId: interaction.user.id });
        } };
    }
    private async roleId() {
        const id = await settingsService.getString(SettingKeys.bot.recrutement.roleParrain);
        if (!id || id === this.bot.guild.id || !await this.bot.guild.roles.fetch(id)) throw new Error('Le rôle Parrain doit être configuré par les RH');
        return id;
    }
    private async maxCapacity() { return parrainCapacity(await settingsService.get(SettingKeys.bot.recrutement.parrainCapacityMax, 2)); }
    private async member(id: string): Promise<GuildMember | null> {
        return this.bot.guild.members.fetch({ user: id, force: true }).catch((err: { code?: number }) => {
            if (err.code === 10007) return null;
            throw err;
        });
    }
    private async staff(id: string) {
        const m = await this.member(id);
        return !!m && (m.permissions.has(P.Administrator) || m.roles.cache.has(await settingsService.getString(SettingKeys.site.roles.rh)));
    }
    private async requireStaff(id: string) { if (!await this.staff(id)) throw new Error('Action réservée aux RH et administrateurs'); }
    private async requireParrain(id: string) {
        const m = await this.member(id);
        if (!m || m.user.bot || !m.roles.cache.has(await this.roleId())) throw new Error('Le rôle Parrain est requis');
        return m;
    }
    private async preference(userId: string, em = this.bot.db.getEm()) {
        // Ne jamais réinitialiser les préférences lors de deux premières utilisations simultanées.
        await em.getConnection().execute('insert ignore into recruitment_mentor_preference (guild_id, user_id, capacity, paused, history) values (?, ?, ?, 0, ?)', [this.bot.guild.id, userId, Math.min(2, await this.maxCapacity()), '[]']);
        return em.findOneOrFail(Preference, { guildId: this.bot.guild.id, userId });
    }
    private active(demandeId: number, em = this.bot.db.getEm()) {
        return em.findOne(Attribution, { demande: demandeId, endedAt: null });
    }
    private async count(userId: string, em = this.bot.db.getEm()) {
        return em.count(Attribution, { parrainId: userId, endedAt: null, demande: { guildId: this.bot.guild.id } });
    }
    private async request(id: number, em = this.bot.db.getEm(), lock = false) {
        return em.findOneOrFail(Demande, { id, guildId: this.bot.guild.id }, lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {});
    }
    private context(i: ComponentInteraction, extra: Context = {}): Context {
        return { ...extra, guildId: this.bot.guild.id, actorId: i.user.id, privatePanel: true };
    }
    private async display(i: ComponentInteraction, content: string, definitions: JSONComponent[], data: Context = {}, dm?: DMChannel) {
        const view = new View(this.bot, this.context(i, data), definitions);
        if (dm) {
            await view.send(dm, { content, allowedMentions: { parse: [] } });
            return;
        }
        await view.replyOrEditInteraction(i, { content, embeds: [], allowedMentions: { parse: [] }, ...(i.inGuild() ? { flags: MessageFlags.Ephemeral } : {}) }, !i.replied);
    }
    private async form(i: ComponentInteraction, data: Context, action: string, title: string, fields: ModalField[]) {
        if (!i.isButton() && !i.isStringSelectMenu()) throw new Error('Ouvrez à nouveau le formulaire');
        const view = View.form(this.bot, this.context(i, data), action, title, fields);
        await view.remember(i.message.id, i.channelId);
        await i.showModal(view.modal![0]);
    }
    async summary(d: Demande) {
        if (d.mentorship?.closedAt) return `Suivi clôturé — ${d.mentorship.closedReason || 'Terminé'}`.slice(0, 1024);
        const a = await this.active(d.id);
        if (!a) return `Parrain à attribuer\n${await this.periodLabel(d)}`;
        const reviews = a.details?.reviews ?? [];
        const review = reviews[reviews.length - 1];
        return [await this.periodLabel(d), `<@${a.parrainId}> — depuis le ${a.startedAt.toLocaleDateString('fr-FR')}`, a.details?.relay ? '⚠️ Relais demandé' : '', review ? `Avis : ${AVIS[review.avis]}\n${review.comment}` : 'Bilan non déposé'].filter(Boolean).join('\n').slice(0, 1024);
    }
    async staffPanel(i: ComponentInteraction, demandeId: number, accepted = false) {
        await this.requireStaff(i.user.id);
        const d = await this.request(demandeId);
        const a = await this.active(d.id);
        const data = { demandeId, expectedId: a?.id ?? 0 };
        const closed = !!d.mentorship?.closedAt;
        // En attente de mentor : rien à retirer ni à clôturer.
        const waiting = d.status === 'awaiting_mentor';
        const intro = !accepted ? '' : waiting
            ? 'Entretien validé : choisissez un parrain pour ouvrir la période de candidat.\n'
            : 'Entretien validé : le candidat est accepté.\n';
        await this.display(i, `${intro}**Parrainage de <@${d.applicantId}>**\n${await this.summary(d)}`, [
            button('choose', a ? 'Changer le parrain' : 'Choisir un parrain', closed),
            ...(a ? [button('remove', 'Retirer le parrain', closed || waiting)] : [button('later', 'Attribuer plus tard', closed)]),
            button('close', 'Clôturer le suivi', closed || waiting),button('history', 'Historique'), button('directory', 'Gérer les parrains'),
        ], data);
    }
    private async profile(i: ComponentInteraction, userId = i.user.id, sendDM = false) {
        if (userId !== i.user.id) await this.requireStaff(i.user.id);
        await this.requireParrain(userId);
        const p = await this.preference(userId), n = await this.count(userId), cap = Math.min(p.capacity, await this.maxCapacity());
        await this.display(i, `**Espace parrain — <@${userId}>**\n${parrainAvailability(p.paused, n, cap)} · ${n}/${cap} candidats\n${p.returnAt ? `Retour prévu : ${p.returnAt.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}\n` : ''}${p.reason || ''}\nLa pause suspend les nouvelles attributions ; vos accompagnements actuels restent à votre charge.\nVotre mission : faire découvrir l’ensemble du 1CC, son organisation et son esprit.`, [
            button(p.paused ? 'resume' : 'pause', p.paused ? 'Reprendre les attributions' : 'Me mettre en pause'),
            button('capacity', 'Ma capacité'), button('mine', 'Mes candidats'), button('relay_list', 'Demander un relais'),
            ...(userId === i.user.id && i.inGuild() && !sendDM ? [button('dm', 'Continuer en privé')] : []),
        ], { userId }, sendDM ? await i.user.createDM() : undefined);
    }
    private async listing(i: ComponentInteraction, mode: string, data: Context, page = 0) {
        let entries: { label: string; value: string }[] = [];
        if (mode === 'choose' || mode === 'directory') {
            await this.requireStaff(i.user.id);
            const role = await this.roleId(), max = await this.maxCapacity();
            const members = await listGuildMembers(this.bot.guild);
            const d = mode === 'choose' ? await this.request(Number(data.demandeId)) : null;
            for (const m of members.values()) {
                if (m.user.bot || !m.roles.cache.has(role) || m.id === d?.applicantId) continue;
                const p = await this.preference(m.id), count = await this.count(m.id), cap = Math.min(p.capacity, max);
                if (mode === 'choose' && (p.paused || count >= cap)) continue;
                entries.push({ label: `${m.displayName} — ${count}/${cap} · ${parrainAvailability(p.paused, count, cap)}`.slice(0, 100), value: m.id });
            }
        } else {
            const userId = String(data.userId || i.user.id);
            if (userId !== i.user.id) await this.requireStaff(i.user.id);
            await this.requireParrain(userId);
            const rows = await this.bot.db.getEm().find(Attribution, { parrainId: userId, endedAt: null, demande: { guildId: this.bot.guild.id } }, { populate: ['demande'] });
            for (const a of rows) {
                const m = await this.member(a.demande.applicantId);
                entries.push({ label: (m?.displayName || a.demande.applicantId).slice(0, 100), value: String(a.id) });
            }
        }
        entries.sort((a, b) => a.label.localeCompare(b.label, 'fr'));
        const pages = Math.max(1, Math.ceil(entries.length / 25));
        page = Math.max(0, Math.min(page, pages - 1));
        await this.display(i, entries.length ? `Sélectionnez ${mode === 'choose' || mode === 'directory' ? 'un parrain' : 'un candidat'} — page ${page + 1}/${pages}.` : 'Aucun choix disponible. Vous pouvez revenir plus tard.', [
            ...(entries.length ? [select('selection', entries.slice(page * 25, page * 25 + 25), mode === 'relay_list' ? Math.min(25, entries.length - page * 25) : 1)] : []),
            button('prev', 'Précédent', page === 0), button('next', 'Suivant', page + 1 === pages),
            ...(mode === 'choose' || (mode === 'directory' && data.demandeId) ? [button('staff', 'Retour au dossier RH')] : [button('home', 'Mon espace')]),
        ], { ...data, mode, page });
    }
    private async changePreference(userId: string, actorId: string, change: (p: Preference) => void, action: string) {
        if (userId !== actorId) await this.requireStaff(actorId);
        await this.requireParrain(userId);
        await this.preference(userId);
        await this.bot.db.getEm().transactional(async em => {
            const p = await em.findOneOrFail(Preference, { guildId: this.bot.guild.id, userId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
            change(p); p.history.push({ actorId, at: new Date().toISOString(), action });
            await em.flush();
        });
    }
    /** `self` : le mentor s'engage lui-même (bouton du ticket Mentora) ; sinon l'acteur doit être RH ou administrateur. */
    async assign(demandeId: number, userId: string, actorId: string, expectedId: number, reason = '', self = false) {
        if (self) { if (actorId !== userId) throw new Error('Un mentor ne peut s’affecter que lui-même'); }
        else await this.requireStaff(actorId);
        await this.requireParrain(userId);
        await this.preference(userId);
        let fromAwaitingMentor = false;
        await this.bot.db.getEm().transactional(async em => {
            const d = await this.request(demandeId, em, true);
            if (self && (d.status !== 'awaiting_mentor' || d.pendingStatus)) throw new Error('Ce dossier n’attend plus de mentor : un mentor est déjà engagé');
            if ((d.status !== 'candidate' && d.status !== 'awaiting_mentor') || d.pendingStatus || d.mentorship?.closedAt || d.mentorship?.needsSync) throw new Error('Le dossier ne permet plus une attribution');
            if (d.applicantId === userId) throw new Error('Auto-parrainage impossible');
            const candidate = await this.member(d.applicantId);
            if (!candidate || (this.bot.roleMember && candidate.roles.cache.has(this.bot.roleMember.id))) throw new Error('Le candidat est absent ou déjà membre officiel');
            const current = await this.active(d.id, em);
            if ((current?.id ?? 0) !== expectedId) throw new Error('L’attribution a changé : actualisez la fiche');
            if (current?.parrainId === userId) throw new Error('Ce parrain accompagne déjà le candidat');
            const p = await em.findOneOrFail(Preference, { guildId: d.guildId, userId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
            await this.requireParrain(userId);
            const activeRows = await em.find(Attribution, { parrainId: userId, endedAt: null, demande: { guildId: d.guildId } }, { lockMode: LockMode.PESSIMISTIC_WRITE });
            if (p.paused || activeRows.length >= Math.min(p.capacity, await this.maxCapacity())) {
                throw new Error(self ? 'Vous êtes en pause ou à pleine capacité : reprenez vos attributions ou libérez une place depuis /parrain' : 'Ce parrain n’est plus disponible');
            }
            if (current) { current.endedAt = new Date(); current.details = { ...current.details, endActorId: actorId, endReason: reason || 'Remplacement' }; }
            const a = Object.assign(new Attribution(), { demande: d, parrainId: userId, details: { actorId, reason } });
            em.persist(a);
            d.mentorship = { ...d.mentorship, needsSync: true };
            if (self) d.mentorship.rhNotice = `<@${userId}> s’est affecté comme mentor de <@${d.applicantId}>.\n${this.staffLink(d)}`;
            if (d.status === 'awaiting_mentor') {
                // Même transaction : l'accompagnement et l'intention de passage Candidat sont enregistrés ensemble.
                fromAwaitingMentor = true;
                d.pendingStatus = 'candidate';
                d.needsSync = true;
                d.decisions.push({ from: 'awaiting_mentor', to: 'candidate', actorId, at: new Date().toISOString(), reason: self ? 'Mentor volontaire' : 'Mentor affecté' });
            }
            await em.flush();
        });
        if (fromAwaitingMentor) {
            // Rôles et pseudo d'abord ; la synchronisation des permissions est tentée même si la reprise échoue.
            let resumeError: unknown;
            try { await this.bot.recrutementManager.resume(demandeId); } catch (err) { resumeError = err; }
            await this.sync(demandeId);
            if (resumeError) throw resumeError;
            return;
        }
        await this.sync(demandeId);
    }
    /** Clôture le suivi de parrainage d'un dossier (rejet depuis le site, par exemple), sans passer par le panneau RH. */
    async closeForRequest(demandeId: number, actorId: string, reason: string) {
        await this.finish(demandeId, actorId, reason, true);
    }
    private async finish(demandeId: number, actorId: string, reason: string, close: boolean, expectedId?: number) {
        await this.bot.db.getEm().transactional(async em => {
            const d = await this.request(demandeId, em, true), a = await this.active(d.id, em);
            if (expectedId !== undefined && (a?.id ?? 0) !== expectedId) throw new Error('L’attribution a changé : actualisez la fiche');
            if (d.status === 'awaiting_mentor') throw new Error('Le dossier attend un mentor : aucun parrain à retirer ni suivi à clôturer');
            if (d.mentorship?.closedAt) return;
            if (a) { a.endedAt = new Date(); a.details = { ...a.details, endActorId: actorId, endReason: reason }; }
            // Les clés existantes sont conservées ; seul le rappel d'attente repart de zéro lors d'une réattribution.
            d.mentorship = close
                ? { ...d.mentorship, closedAt: new Date().toISOString(), closedBy: actorId, closedReason: reason, needsSync: true }
                : { ...d.mentorship, waitingSince: new Date().toISOString(), remindedAt: undefined, needsSync: true };
            d.mentorship.ticketNotice = close ? 'Le suivi de parrainage est clôturé. Les RH restent votre point de contact.' : 'Votre parrainage est en attente de réattribution par les RH.';
            if (!close) d.mentorship.rhNotice = `Le candidat <@${d.applicantId}> attend un nouveau parrain. Motif : ${reason}`;
            await em.flush();
        });
        await this.sync(demandeId);
    }
    /** Période de candidat terminée selon le paramètre courant (affichage des boutons Prolonger / Réaffecter). */
    async periodEnded(d: Demande) { return candidatePeriodEnded(d, Date.now(), await candidatePeriodDays()); }
    /** Vérifications communes des actions RH de fin de période (dossier verrouillé par l'appelant). */
    private assertPeriodAction(d: Demande) {
        if (d.status !== 'candidate' || d.pendingStatus || d.mentorship?.closedAt) throw new Error('Le dossier ne permet plus cette action');
    }
    /** Prolonger la période (RH) : jours cumulés sans limite, relances réinitialisées, décision enregistrée. Aucun appel Discord. */
    async extendPeriod(demandeId: number, days: number, actorId: string) {
        await this.requireStaff(actorId);
        const total = await this.bot.db.getEm().transactional(async em => {
            const d = await this.request(demandeId, em, true);
            this.assertPeriodAction(d);
            d.mentorship = extendedMentorship(d.mentorship, days);
            d.decisions.push({ from: 'candidate', to: 'candidate', actorId, at: new Date().toISOString(), reason: `Période prolongée de ${formatDays(days)}` });
            d.needsSync = true;
            await em.flush();
            return d.mentorship.periodExtraDays!;
        });
        return total;
    }
    /**
     * Bouton « Valider » (RH) : le site fait l'acceptation. Le bot ne change PAS le statut du dossier : il attend le retour du site
     * (`applySiteDecision`). Rien n'est enregistré si le site échoue ; sinon la décision est ajoutée à `decisions` avec l'avis du mentor.
     */
    async validateCandidate(demandeId: number, actorId: string): Promise<SiteAcceptance> {
        await this.requireStaff(actorId);
        const d = await this.request(demandeId);
        this.assertPeriodAction(d);
        const result = await requestSiteAcceptance(d.applicantId, actorId);
        if (!result.ok) return result;
        const review = (await this.active(d.id))?.details?.reviews?.at(-1);
        const opinion = review ? `Avis du mentor : ${AVIS[review.avis]} — ${review.comment}` : 'Avis du mentor : aucun bilan déposé';
        try {
            await this.bot.db.getEm().transactional(async em => {
                const locked = await this.request(demandeId, em, true);
                locked.decisions.push({ from: 'candidate', to: 'candidate', actorId, at: new Date().toISOString(), reason: `Acceptation envoyée au site. ${opinion}`.slice(0, 1000) });
                await em.flush();
            });
        } catch (err) {
            await this.logger.error({ err, demandeId }, 'Acceptation envoyée au site mais décision non enregistrée');
        }
        return result;
    }
    /** Après une réaffectation : « le mois continue » ou « le mois repart ». Le choix n'est enregistré qu'une fois par attribution. */
    async choosePeriod(demandeId: number, attributionId: number, restart: boolean, actorId: string) {
        await this.requireStaff(actorId);
        await this.bot.db.getEm().transactional(async em => {
            const d = await this.request(demandeId, em, true);
            this.assertPeriodAction(d);
            const a = await this.active(d.id, em);
            if (!a || a.id !== attributionId) throw new Error('L’attribution a changé : actualisez la fiche');
            if (a.details?.periodChoiceAt) throw new Error('Le choix a déjà été enregistré');
            const now = new Date();
            a.details = { ...a.details, periodChoiceAt: now.toISOString() };
            d.mentorship = reassignedMentorship(d.mentorship, restart, now);
            d.decisions.push({ from: 'candidate', to: 'candidate', actorId, at: now.toISOString(), reason: `Parrain réaffecté (<@${a.parrainId}>) : ${restart ? 'le mois repart' : 'le mois continue'}` });
            d.needsSync = true;
            await em.flush();
        });
    }
    private async candidatePanel(i: ComponentInteraction, attributionId: number) {
        const a = await this.owned(attributionId, i.user.id);
        const latest = a.details?.reviews?.at(-1);
        await this.display(i, `**Candidat <@${a.demande.applicantId}>**\nAccompagné depuis le ${a.startedAt.toLocaleDateString('fr-FR')}\n${await this.periodLabel(a.demande)}\n${a.details?.relay ? 'Relais demandé aux RH.\n' : ''}${latest ? `Avis : ${AVIS[latest.avis]}\n${latest.comment}` : 'Aucun bilan déposé.'}`, [
            select('review', AVIS_PROPOSES.map(value => ({ label: AVIS[value], value }))),
            button('relay', 'Demander un relais'), button('mine', 'Retour aux candidats'), button('home', 'Mon espace'),
            ...(a.demande.channelId ? [{ type: T.Button as const, customId: 'parrain_ticket', label: 'Ouvrir le ticket', style: 'Link' as const, url: `https://discord.com/channels/${this.bot.guild.id}/${a.demande.channelId}` }] : []),
        ], { attributionId: a.id, userId: a.parrainId });
    }
    private async owned(id: number, actorId: string, em = this.bot.db.getEm()) {
        const a = await em.findOneOrFail(Attribution, { id, endedAt: null, demande: { guildId: this.bot.guild.id } }, { populate: ['demande'] });
        if (a.parrainId !== actorId) await this.requireStaff(actorId);
        else await this.requireParrain(actorId);
        return a;
    }
    private async reviewOrRelay(id: number, actorId: string, comment: string, avis?: ParrainAvis) {
        const initial = await this.owned(id, actorId);
        await this.preference(initial.parrainId);
        await this.bot.db.getEm().transactional(async em => {
            const d = await this.request(initial.demande.id, em, true);
            const a = await this.owned(id, actorId, em);
            if (d.mentorship?.closedAt) throw new Error('Suivi clôturé');
            a.details ??= {};
            if (avis) {
                if (a.parrainId !== actorId) throw new Error('Seul le parrain peut rédiger son bilan');
                if (!Object.prototype.hasOwnProperty.call(AVIS, avis) || !comment.trim()) throw new Error('Avis et commentaire requis');
                (a.details.reviews ??= []).push({ avis, comment, actorId, at: new Date().toISOString(), notified: false });
            } else {
                a.details.relay = { at: new Date().toISOString(), reason: comment };
                const p = await em.findOneOrFail(Preference, { guildId: d.guildId, userId: a.parrainId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
                p.paused = true;
                p.history.push({ actorId, at: new Date().toISOString(), action: 'Pause et demande de relais' });
            }
            d.mentorship = { ...d.mentorship, needsSync: true };
            await em.flush();
        });
        await this.sync(initial.demande.id);
    }
    async handler(i: ComponentInteraction, data: Context) {
        try {
            if (data.guildId !== this.bot.guild.id || (i.guildId && i.guildId !== this.bot.guild.id)) throw new Error('Serveur invalide');
            if (data.actorId && data.actorId !== i.user.id) throw new Error('Ce panneau ne vous appartient pas');
            const action = i.isChatInputCommand() ? 'dm' : i.customId.replace(/^parrain_/, '');
            const userId = String(data.userId || i.user.id);
            const reasonField: ModalField = { customId: 'reason', label: 'Motif (facultatif)', style: 'Paragraph', maxLength: 1000 };
            if (['pause', 'capacity', 'remove', 'close', 'relay', 'review', 'extend'].includes(action) || (action === 'selection' && data.mode === 'choose')) {
                if (['remove', 'close', 'extend'].includes(action) || data.mode === 'choose') await this.requireStaff(i.user.id);
                if (action === 'extend') return await this.form(i, data, 'save_extend', 'Prolonger la période', [
                    { customId: 'days', label: 'Nombre de jours à ajouter', style: 'Short', required: true, maxLength: 3, default: String(await extensionDays()) },
                ]);
                else if (['review', 'relay'].includes(action)) await this.owned(Number(data.attributionId), i.user.id);
                else { if (userId !== i.user.id) await this.requireStaff(i.user.id); await this.requireParrain(userId); }
                if (action === 'pause') return await this.form(i, data, 'save_pause', 'Mettre en pause', [
                    { customId: 'return', label: 'Retour prévu (JJ/MM/AAAA), facultatif', style: 'Short', maxLength: 10 }, reasonField,
                ]);
                if (action === 'capacity') return await this.form(i, data, 'save_capacity', 'Ma capacité', [
                    { customId: 'capacity', label: `Nombre de candidats (1 à ${await this.maxCapacity()})`, style: 'Short', required: true, maxLength: 3 },
                ]);
                if (action === 'selection' && i.isStringSelectMenu()) return await this.form(i, { ...data, selectedId: i.values[0] }, 'save_assign', 'Attribuer ce parrain', [reasonField]);
                if (action === 'review' && i.isStringSelectMenu()) {
                    const a = await this.owned(Number(data.attributionId), i.user.id);
                    return await this.form(i, { ...data, avis: i.values[0] }, 'save_review', 'Bilan confidentiel aux RH', [
                        { customId: 'reason', label: 'Intégration, esprit et découverte du corps', style: 'Paragraph', required: true, maxLength: 1000, default: a.details?.reviews?.at(-1)?.comment },
                    ]);
                }
                return await this.form(i, data, `save_${action}`, action === 'close' ? 'Clôturer le suivi' : action === 'relay' ? 'Demander un relais' : 'Retirer le parrain', [
                    { ...reasonField, required: action === 'close', label: action === 'close' ? 'Motif de clôture' : reasonField.label },
                ]);
            }
            if (action === 'selection' && data.mode === 'relay_list' && i.isStringSelectMenu()) {
                for (const id of i.values) await this.owned(Number(id), i.user.id);
                return await this.form(i, { ...data, attributionIds: i.values.map(Number) }, 'save_relays', 'Demander un relais', [reasonField]);
            }
            if (!i.deferred && !i.replied) {
                // Ne jamais modifier la fiche RH partagée : seulement le panneau privé de son propriétaire.
                const message = 'message' in i ? i.message : null;
                const privateSource = data.privatePanel === true && data.actorId === i.user.id && message
                    && (!i.inGuild() || message.flags.has(MessageFlags.Ephemeral));
                if (privateSource && (i.isButton() || i.isStringSelectMenu() || (i.isModalSubmit() && i.isFromMessage()))) {
                    await i.deferUpdate();
                } else await i.deferReply(i.inGuild() ? { flags: MessageFlags.Ephemeral } : {});
            }
            if (action === 'self_assign') { await this.selfAssign(i, data); return; }
            if (action.startsWith('save_')) {
                if (!i.isModalSubmit()) throw new Error('Formulaire invalide');
                if (action === 'save_pause') {
                    const returnAt = parseParrainReturn(i.fields.getTextInputValue('return'));
                    const reason = i.fields.getTextInputValue('reason').trim();
                    await this.changePreference(userId, i.user.id, p => { p.paused = true; p.returnAt = returnAt; p.reason = reason; p.remindedAt = undefined; }, `Pause : ${reason}`);
                    await this.profile(i, userId); return;
                }
                if (action === 'save_capacity') {
                    const raw = i.fields.getTextInputValue('capacity').trim(), capacity = Number(raw);
                    if (!/^\d+$/.test(raw) || capacity < 1 || capacity > await this.maxCapacity()) throw new Error('Capacité hors limites');
                    await this.changePreference(userId, i.user.id, p => { p.capacity = capacity; }, `Capacité : ${capacity}`);
                    await this.profile(i, userId); return;
                }
                if (action === 'save_extend') {
                    await this.requireStaff(i.user.id);
                    const total = await this.extendPeriod(Number(data.demandeId), parseExtensionDays(i.fields.getTextInputValue('days')), i.user.id);
                    await this.display(i, `Période prolongée : ${formatDays(total)} de prolongation au total. Les relances repartent à la prochaine échéance.`, []); return;
                }
                const reason = i.fields.getTextInputValue('reason').trim();
                if (action === 'save_relays') {
                    const ids = data.attributionIds;
                    if (!Array.isArray(ids) || !ids.length || ids.length > 25) throw new Error('Sélection invalide');
                    for (const id of ids) await this.reviewOrRelay(Number(id), i.user.id, reason);
                    await this.profile(i, userId); return;
                }
                if (action === 'save_review' || action === 'save_relay') {
                    await this.reviewOrRelay(Number(data.attributionId), i.user.id, reason, action === 'save_review' ? data.avis as ParrainAvis : undefined);
                    await this.candidatePanel(i, Number(data.attributionId)); return;
                }
                await this.requireStaff(i.user.id);
                if (action === 'save_assign') {
                    await this.assign(Number(data.demandeId), String(data.selectedId), i.user.id, Number(data.expectedId), reason);
                    const reassigned = data.reassign === true ? await this.active(Number(data.demandeId)) : null;
                    if (reassigned) {
                        await this.display(i, `Parrain réaffecté : <@${reassigned.parrainId}>. Le mois de candidat continue-t-il ou repart-il ?`, [
                            button('period_continue', 'Le mois continue'), button('period_restart', 'Le mois repart'),
                        ], { demandeId: Number(data.demandeId), attributionId: reassigned.id });
                        return;
                    }
                } else if (action === 'save_remove' || action === 'save_close') {
                    if (action === 'save_close' && !reason) throw new Error('Motif requis');
                    await this.finish(Number(data.demandeId), i.user.id, reason || 'Retrait du parrain', action === 'save_close', Number(data.expectedId));
                } else throw new Error('Action inconnue');
                await this.staffPanel(i, Number(data.demandeId)); return;
            }
            switch (action) {
                case 'home': await this.profile(i, userId); break;
                case 'candidate': await this.candidatePanel(i, Number(data.attributionId)); break;
                case 'staff': await this.staffPanel(i, Number(data.demandeId)); break;
                case 'later':
                    await this.requireStaff(i.user.id);
                    await this.display(i, 'Le candidat reste accepté. Le parrain pourra être attribué depuis sa fiche RH.', []); break;
                case 'reassign': {
                    await this.requireStaff(i.user.id);
                    const d = await this.request(Number(data.demandeId));
                    if (d.status !== 'candidate' || d.pendingStatus || d.mentorship?.closedAt) throw new Error('Le dossier ne permet plus cette action');
                    await this.listing(i, 'choose', { ...data, reassign: true, expectedId: (await this.active(d.id))?.id ?? 0 }); break;
                }
                case 'validate': {
                    const result = await this.validateCandidate(Number(data.demandeId), i.user.id);
                    await this.display(i, result.ok ? 'Acceptation envoyée. Le site traite la demande puis rappelle le bot : le statut du dossier changera à son retour.' : `Acceptation non envoyée : ${result.message}`, []); break;
                }
                case 'period_continue': case 'period_restart': {
                    const restart = action === 'period_restart';
                    await this.choosePeriod(Number(data.demandeId), Number(data.attributionId), restart, i.user.id);
                    await this.display(i, restart ? 'Le mois de candidat repart d’aujourd’hui. Les relances sont réinitialisées.' : 'Le mois de candidat continue. Les relances sont réinitialisées.', []); break;
                }
                case 'choose': case 'directory': case 'mine': case 'relay_list': await this.listing(i, action, data); break;
                case 'prev': case 'next': await this.listing(i, String(data.mode), data, Number(data.page) + (action === 'next' ? 1 : -1)); break;
                case 'selection':
                    if (!i.isStringSelectMenu()) throw new Error('Sélection invalide');
                    if (data.mode === 'directory') { await this.requireStaff(i.user.id); await this.profile(i, i.values[0]); }
                    else if (data.mode === 'mine' || data.mode === 'relay_list') await this.candidatePanel(i, Number(i.values[0]));
                    else throw new Error('Sélection périmée');
                    break;
                case 'resume':
                    await this.changePreference(userId, i.user.id, p => { p.paused = false; p.reason = undefined; p.returnAt = undefined; p.remindedAt = undefined; }, 'Reprise');
                    await this.profile(i, userId); break;
                case 'dm': {
                    await this.requireParrain(i.user.id);
                    try {
                        await this.profile(i, i.user.id, true);
                    } catch (err) {
                        await this.display(i, 'Envoi en MP impossible. Vous pouvez continuer ici.', [button('home', 'Mon espace')]); return;
                    }
                    await this.display(i, 'Votre espace parrain a été envoyé en MP.', [button('home', 'Continuer ici')]); break;
                }
                case 'history': case 'history_prev': case 'history_next':
                    await this.historyPage(i, data, action === 'history_next' ? 1 : action === 'history_prev' ? -1 : 0); break;
                default: throw new Error('Action inconnue');
            }
        } catch (err) {
            await this.logger.error({ err }, 'Action de parrainage impossible');
            const content = `Action non terminée : ${err instanceof Error ? err.message : 'erreur interne'}. Si le changement est déjà enregistré, sa synchronisation sera reprise automatiquement.`;
            if (i.deferred || i.replied) await i.editReply({ content, components: [] });
            else await i.reply({ content, ...(i.inGuild() ? { flags: MessageFlags.Ephemeral } : {}) });
        }
    }
    /** Bouton « Je m'affecte » du ticket Mentora : même chemin que l'affectation RH (verrou, expectedId = 0), acteur = mentor. */
    private async selfAssign(i: ComponentInteraction, data: Context) {
        const demandeId = Number(data.demandeId);
        // Engagement déjà présent avant ce clic (ex. second clic) : une erreur n'est alors pas une reprise de synchronisation.
        const alreadyEngaged = await this.bot.db.getEm().findOne(Attribution, { demande: demandeId, parrainId: i.user.id, endedAt: null });
        try {
            const d = await this.request(demandeId);
            if (d.mentorship?.mentoraChannelId && i.channelId !== d.mentorship.mentoraChannelId) throw new Error('Ce bouton ne correspond pas à ce dossier');
            await this.assign(demandeId, i.user.id, i.user.id, 0, '', true);
        } catch (err) {
            // Refus avant enregistrement : message clair. Si l'engagement est déjà enregistré, la reprise de synchronisation s'applique.
            const engaged = await this.bot.db.getEm().findOne(Attribution, { demande: demandeId, parrainId: i.user.id, endedAt: null });
            if (engaged && !alreadyEngaged) throw err;
            await this.logger.warn({ err, demandeId, userId: i.user.id }, 'Auto-affectation refusée');
            await i.editReply({ content: `Affectation impossible : ${err instanceof Error ? err.message : 'erreur interne'}.`, components: [] });
            return;
        }
        const d = await this.request(demandeId);
        await i.editReply({ content: `Vous êtes engagé comme mentor de <@${d.applicantId}>. Le ticket Mentora vous est réservé.`, components: [], allowedMentions: { parse: [] } });
    }
    private async historyPage(i: ComponentInteraction, data: Context, delta: number) {
        await this.requireStaff(i.user.id);
        const rows = await this.bot.db.getEm().find(Attribution, { demande: { id: Number(data.demandeId), guildId: this.bot.guild.id } }, { orderBy: { startedAt: 'DESC' } });
        const lines = rows.flatMap(a => [`${a.startedAt.toISOString()} — <@${a.parrainId}> — ${a.endedAt ? `terminé : ${a.details?.endReason || ''}` : 'en cours'}`, ...(a.details?.reviews ?? []).map(r => `${r.at} — ${AVIS[r.avis]} : ${r.comment}`)]);
        const pages: string[] = []; let current = '';
        for (const line of lines) { if ((current + line).length > 3500) { pages.push(current); current = ''; } current += `${line}\n`; }
        if (current) pages.push(current);
        const page = Math.max(0, Math.min(Number(data.historyPage || 0) + delta, Math.max(0, pages.length - 1)));
        await this.display(i, pages[page] || 'Aucun accompagnement enregistré.', [button('history_prev', 'Précédent', page === 0), button('history_next', 'Suivant', page + 1 >= pages.length)], { ...data, historyPage: page });
    }
    private staffLink(d: Demande): string { return staffLink(d); }
    private async periodLabel(d: Demande): Promise<string> {
        const days = await candidatePeriodDays();
        if (d.status === 'awaiting_mentor') return `En attente d’un mentor : la période de ${formatDays(days)} démarre à son engagement.`;
        const endDate = candidatePeriodEnd(d, days);
        if (!endDate) return 'Date de passage Candidat non renseignée.';
        const end = Math.floor(endDate.getTime() / 1000), total = formatDays(days + (d.mentorship?.periodExtraDays && d.mentorship.periodExtraDays > 0 ? d.mentorship.periodExtraDays : 0));
        return candidatePeriodEnded(d, Date.now(), days)
            ? `Période de ${total} terminée depuis <t:${end}:D>. Décision RH en attente.`
            : `Fin des ${total} : <t:${end}:D> (<t:${end}:R>).`;
    }
    /** MP au mentor actif avec un bouton vers le bilan ; MP fermés : repli dans le canal RH. */
    private async remindMentor(d: Demande, a: Attribution) {
        const text = `La période de candidat de <@${d.applicantId}> est terminée. Donne ta décision : favorable ou défavorable, avec un commentaire.`;
        const member = await this.member(a.parrainId);
        if (!member) return false;
        try {
            const dm = await member.createDM();
            const view = new View(this.bot, { guildId: d.guildId, actorId: a.parrainId, privatePanel: true, attributionId: a.id, userId: a.parrainId }, [button('candidate', 'Donner ma décision')]);
            await view.send(dm, { content: text, allowedMentions: { parse: [] } });
        } catch (err: any) {
            if (err.code !== 50007) throw err;
            await this.notifyRH(d, `${text}\n<@${a.parrainId}> n’a pas pu être prévenu en MP (messages privés fermés) : il peut déposer son bilan avec /parrain.\n${this.staffLink(d)}`);
        }
        return true;
    }
    private notifyRH(d: Demande, content: string) { return notifyRH(this.bot.guild, d, content); }
    async sync(demandeId: number) {
        // Sauvegarde durable AVANT toute permission Discord, même en cas d’arrêt brutal.
        await this.bot.db.getEm().transactional(async em => {
            const d = await this.request(demandeId, em, true);
            const a = await this.active(d.id, em);
            if (!a || a.details?.access) return;
            const channel = d.channelId ? await this.bot.guild.channels.fetch(d.channelId) : null;
            if (channel?.type !== ChannelType.GuildText) throw new Error('Ticket du candidat inaccessible');
            const old = channel.permissionOverwrites.cache.get(a.parrainId);
            a.details = { ...a.details, access: { channelId: channel.id, hadOverwrite: !!old, permissions: Object.fromEntries(PERMISSIONS.map(name => [name, old?.allow.has(P[name]) ? true : old?.deny.has(P[name]) ? false : null])) } };
            await em.flush();
        });
        await this.bot.db.getEm().transactional(async em => {
            const d = await this.request(demandeId, em, true);
            const rows = await em.find(Attribution, { demande: d.id }, { orderBy: { startedAt: 'ASC', id: 'ASC' } });
            for (const a of rows) {
                a.details ??= {};
                for (const [index, review] of (a.details.reviews ?? []).entries()) {
                    if (review.notified !== false) continue;
                    await this.notifyRH(d, `**Bilan ${index === 0 ? 'déposé' : 'mis à jour'}** par <@${review.actorId}> pour <@${d.applicantId}> — **${AVIS[review.avis]}**\n${review.comment}\n${this.staffLink(d)}`);
                    review.notified = true;
                    await em.flush();
                }
                if (a.endedAt) {
                    const access = a.details.access;
                    if (access && !a.details.accessRestored) {
                        const oldChannel = await this.bot.guild.channels.fetch(access.channelId);
                        if (oldChannel?.type === ChannelType.GuildText) {
                            await oldChannel.permissionOverwrites.edit(a.parrainId, access.permissions);
                            const overwrite = oldChannel.permissionOverwrites.cache.get(a.parrainId);
                            if (!access.hadOverwrite && overwrite && overwrite.allow.bitfield === 0n && overwrite.deny.bitfield === 0n) await oldChannel.permissionOverwrites.delete(a.parrainId);
                        }
                        a.details.accessRestored = true;
                        await em.flush();
                    }
                    continue;
                }
                if (!d.channelId) throw new Error('Ticket du candidat absent');
                const channel = await this.bot.guild.channels.fetch(d.channelId);
                if (channel?.type !== ChannelType.GuildText) throw new Error('Ticket du candidat inaccessible');
                if (!a.details.access) throw new Error('Attribution modifiée pendant la synchronisation ; nouvelle tentative nécessaire');
                await channel.permissionOverwrites.edit(a.parrainId, Object.fromEntries(PERMISSIONS.map(name => [name, true])));
                if (!a.details.announced) {
                    await channel.send({ content: `**Ton parrain : <@${a.parrainId}>**\nIl t’accompagne pour découvrir l’ensemble du 1CC, son organisation et son esprit.`, allowedMentions: { users: [a.parrainId, d.applicantId], parse: [] } });
                    a.details.announced = true;
                    await em.flush();
                }
                if (a.details.relay && !a.details.relay.notified) {
                    await this.notifyRH(d, `Relais demandé par <@${a.parrainId}> pour <@${d.applicantId}>.\n${a.details.relay.reason}`);
                    a.details.relay.notified = true;
                    await em.flush();
                }
            }
            await this.syncMentora(d, rows, em);
            if (d.mentorship?.ticketNotice && d.channelId) {
                const channel = await this.bot.guild.channels.fetch(d.channelId);
                if (channel?.type === ChannelType.GuildText) await channel.send({ content: d.mentorship.ticketNotice, allowedMentions: { parse: [] } });
                d.mentorship.ticketNotice = undefined;
            }
            if (d.mentorship?.rhNotice) {
                await this.notifyRH(d, d.mentorship.rhNotice);
                d.mentorship.rhNotice = undefined;
            }
            d.mentorship = { ...d.mentorship, needsSync: false };
            d.needsSync = true;
            await em.flush();
        });
    }
    /**
     * Ticket Mentora : une fois un mentor engagé, le rôle Parrain n'y a plus accès et seul le mentor affecté y garde un droit
     * individuel ; en cas de remplacement, l'ancien mentor est retiré. Rien n'est supprimé (ticket #41).
     */
    private async syncMentora(d: Demande, rows: Attribution[], em: EntityManager) {
        const mentoraId = d.mentorship?.mentoraChannelId;
        if (!mentoraId) return;
        const channel = await this.bot.guild.channels.fetch(mentoraId).catch((err: { code?: number }) => {
            if (err.code === 10003) return null;
            throw err;
        });
        if (channel?.type !== ChannelType.GuildText) return;
        const current = rows.find(a => !a.endedAt);
        if (current) {
            const parrainRole = await settingsService.getString(SettingKeys.bot.recrutement.roleParrain);
            if (parrainRole && channel.permissionOverwrites.cache.has(parrainRole)) await channel.permissionOverwrites.delete(parrainRole);
        }
        for (const a of rows) {
            a.details ??= {};
            if (a.endedAt) {
                if (a.details.mentoraGranted && !a.details.mentoraRevoked) {
                    await channel.permissionOverwrites.delete(a.parrainId);
                    a.details.mentoraRevoked = true;
                    await em.flush();
                }
                continue;
            }
            if (!a.details.mentoraGranted) {
                await this.updateMentoraWelcome(d, channel, a.parrainId);
                await channel.permissionOverwrites.edit(a.parrainId, Object.fromEntries(PERMISSIONS.map(name => [name, true])));
                await channel.send({ content: `**Mentor affecté : <@${a.parrainId}>**\nLes autres parrains n’ont plus accès à ce ticket.`, allowedMentions: { users: [a.parrainId], parse: [] } });
                a.details.mentoraGranted = true;
                await em.flush();
            }
        }
    }
    /** Désactive « Je m'affecte » et indique le mentor dans le message d'accueil ; message supprimé = rien à faire. */
    private async updateMentoraWelcome(d: Demande, channel: TextChannel, mentorId: string) {
        const messageId = d.mentorship?.mentoraMessageId;
        if (!messageId) return;
        const message = await channel.messages.fetch(messageId).catch((err: { code?: number }) => {
            if (err.code === 10008) return null;
            throw err;
        });
        if (!message) return;
        const view = View.mentora(this.bot, d, mentorId);
        await message.edit({ embeds: [mentoraEmbed(d, mentorId)], components: view.rows as unknown as any[], allowedMentions: { parse: [] } });
        await view.remember(message.id, channel.id);
    }
    private async remindMentorWait(d: Demande) {
        d.mentorship ??= {};
        d.mentorship.waitingSince ??= new Date().toISOString();
        const waitDays = await mentorWaitDays();
        if (!d.mentorship.remindedAt && Date.now() - Date.parse(d.mentorship.waitingSince) >= daysToMs(waitDays)) {
            await this.notifyRH(d, d.status === 'awaiting_mentor'
                ? `Le candidat <@${d.applicantId}> attend un mentor depuis plus de ${formatDays(waitDays)}.\n${this.staffLink(d)}`
                : `Le candidat <@${d.applicantId}> attend un parrain depuis plus de ${formatDays(waitDays)}.`);
            d.mentorship.remindedAt = new Date().toISOString();
        }
    }
    async check() {
        if (this.checking) return;
        this.checking = true;
        try {
            const roleId = await settingsService.getString(SettingKeys.bot.recrutement.roleParrain);
            const validRole = roleId ? await this.bot.guild.roles.fetch(roleId) : null;
            const requests = await this.bot.db.getEm().find(Demande, { guildId: this.bot.guild.id, status: 'candidate' });
            for (const request of requests) {
                try {
                    if (request.mentorship?.needsSync) await this.sync(request.id);
                    if (request.mentorship?.closedAt) continue;
                    const member = await this.member(request.applicantId);
                    const a = await this.active(request.id);
                    if (!member || (this.bot.roleMember && member.roles.cache.has(this.bot.roleMember.id))) {
                        await this.finish(request.id, this.bot.user!.id, member ? 'Passage membre officiel' : 'Départ du candidat', true); continue;
                    }
                    if (a) {
                        const parrain = await this.member(a.parrainId);
                        // Une configuration temporairement absente ne termine pas tous les accompagnements.
                        if (!parrain || (validRole && !parrain.roles.cache.has(validRole.id))) {
                            await this.finish(request.id, this.bot.user!.id, 'Parrain indisponible : départ ou perte du rôle', false, a.id);
                        }
                    }
                    await this.bot.db.getEm().transactional(async em => {
                        const d = await this.request(request.id, em, true);
                        if (d.mentorship?.closedAt) return;
                        d.mentorship ??= {};
                        const periodDays = await candidatePeriodDays(), now = Date.now();
                        const end = candidatePeriodEnd(d, periodDays);
                        if (end && candidatePeriodEnded(d, now, periodDays)) {
                            const interval = await mentorReminderDays();
                            const current = await this.active(d.id, em);
                            const review = current?.details?.reviews?.filter(r => Date.parse(r.at) >= end.getTime()).at(-1);
                            if (reminderDue(d.mentorship.periodRemindedAt, end, now, interval)) {
                                const avis = review ? `Avis du mentor : **${AVIS[review.avis]}** — ${review.comment}` : current ? `Le mentor <@${current.parrainId}> n’a pas encore donné sa décision.` : 'Aucun mentor n’est affecté.';
                                await this.notifyRH(d, `**Période Candidat de ${formatDays(periodDays + (d.mentorship.periodExtraDays ?? 0))} terminée** pour <@${d.applicantId}>.\n${avis}\nLe dossier est à examiner par les RH ; aucun passage Citoyen automatique.\n${this.staffLink(d)}`);
                                d.mentorship.periodRemindedAt = new Date(now).toISOString();
                                d.needsSync = true;
                                await em.flush();
                            }
                            if (current && !review && reminderDue(d.mentorship.mentorRemindedAt, end, now, interval)) {
                                try {
                                    // Un échec d'envoi n'annule pas la relance RH déjà faite : nouvel essai à la passe suivante.
                                    if (await this.remindMentor(d, current)) { d.mentorship.mentorRemindedAt = new Date(now).toISOString(); await em.flush(); }
                                } catch (err) { await this.logger.error({ err, demandeId: d.id }, 'Relance du mentor impossible'); }
                            }
                        }
                        if (await this.active(d.id, em)) return;
                        await this.remindMentorWait(d);
                        await em.flush();
                    });
                } catch (err) { await this.logger.error({ err, demandeId: request.id }, 'Reprise du parrainage impossible'); }
            }
            // Dossiers en attente de mentor : seul le rappel aux RH s'applique (le rôle Membre est géré par le scheduler RH).
            const waiting = await this.bot.db.getEm().find(Demande, { guildId: this.bot.guild.id, status: 'awaiting_mentor' });
            for (const request of waiting) {
                try {
                    await this.bot.db.getEm().transactional(async em => {
                        const d = await this.request(request.id, em, true);
                        if (d.status !== 'awaiting_mentor' || d.pendingStatus) return;
                        await this.remindMentorWait(d);
                        await em.flush();
                    });
                } catch (err) { await this.logger.error({ err, demandeId: request.id }, 'Rappel d’attente de mentor impossible'); }
            }
            const prefs = await this.bot.db.getEm().find(Preference, { guildId: this.bot.guild.id, paused: true, remindedAt: null, returnAt: { $lte: new Date() } });
            for (const pref of prefs) {
                try {
                    if (!validRole) continue;
                    const member = await this.member(pref.userId);
                    if (!member?.roles.cache.has(validRole.id)) continue;
                    await this.bot.db.getEm().transactional(async em => {
                        const p = await em.findOneOrFail(Preference, pref.id, { lockMode: LockMode.PESSIMISTIC_WRITE });
                        if (!p.paused || p.remindedAt || !p.returnAt || p.returnAt > new Date()) return;
                        try {
                            await member.send('Votre retour de pause est prévu. Utilisez /parrain sur le serveur pour confirmer votre reprise. Vous restez en pause jusque-là.');
                        } catch (err: any) {
                            if (err.code !== 50007) throw err;
                            const rh = await this.bot.guild.channels.fetch(await settingsService.getString(SettingKeys.bot.channels.rh));
                            if (rh?.type !== ChannelType.GuildText) throw new Error('Impossible de transmettre le rappel de retour aux RH');
                            await rh.send({ content: `Retour de pause prévu pour <@${p.userId}> ; MP fermés. La reprise doit être confirmée dans /parrain.`, allowedMentions: { parse: [] } });
                        }
                        p.remindedAt = new Date(); await em.flush();
                    });
                } catch (err) { await this.logger.error({ err, parrainId: pref.userId }, 'Rappel de retour impossible'); }
            }
        } finally { this.checking = false; }
    }
}
