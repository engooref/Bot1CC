import type { RecrutementDemande, RecrutementStatus } from '../entities/recrutement/RecrutementDemande.js';
import { DAY_MS } from './RecruitmentDelays.js';

type ClosedTicketFields = Pick<RecrutementDemande, 'status' | 'decisions' | 'channelId' | 'mentorship'>;

const CLOSED_STATUSES: RecrutementStatus[] = ['refused', 'expired', 'integrated'];

function validTime(iso: unknown): number | null {
    if (typeof iso !== 'string') return null;
    const time = Date.parse(iso);
    return Number.isNaN(time) ? null : time;
}

/** Date de clôture du dossier (ms), ou null si le dossier est ouvert ou si elle est inconnue (on n'invente rien). */
export function closedAtOf(demande: ClosedTicketFields): number | null {
    if (CLOSED_STATUSES.includes(demande.status)) {
        for (let i = (demande.decisions ?? []).length - 1; i >= 0; i--) {
            const decision = demande.decisions[i];
            if (CLOSED_STATUSES.includes(decision.to)) return validTime(decision.at);
        }
        return null;
    }
    // Candidat devenu membre : le statut reste « candidate », la clôture est celle du parrainage.
    if (demande.status === 'candidate') return validTime(demande.mentorship?.closedAt);
    return null;
}

/** Marqueur placé dans le sujet du salon d'admission : seul un salon portant exactement ce sujet peut être supprimé. */
export function ticketMarker(demande: Pick<RecrutementDemande, 'guildId' | 'id'>): string {
    return `recrutement:${demande.guildId}:${demande.id}`;
}

/** Nombre maximal de tickets clos supprimés à chaque passage du scheduler. */
export const MAX_TICKET_DELETIONS_PER_RUN = 5;

/**
 * Phrase annonçant la suppression du ticket (date Discord `<t:UNIX:D>`), ou null si la suppression est désactivée
 * (`days` ≤ 0), si le dossier n'est pas clos, si sa clôture est inconnue ou si le ticket est déjà supprimé.
 */
export function closedTicketNotice(demande: ClosedTicketFields, days: number): string | null {
    if (!Number.isFinite(days) || days <= 0 || ticketDeleted(demande)) return null;
    const closedAt = closedAtOf(demande);
    if (closedAt === null) return null;
    const unix = Math.floor((closedAt + days * DAY_MS) / 1000);
    return `Ce ticket sera supprimé le <t:${unix}:D>, ${days} jour${days > 1 ? 's' : ''} après la clôture du dossier.`;
}

/** Le salon d'admission d'un dossier clos a été supprimé : aucune reprise ne doit le recréer. */
export function ticketDeleted(demande: ClosedTicketFields): boolean {
    return closedAtOf(demande) !== null && !!demande.mentorship?.ticketDeletedAt;
}

/**
 * Le ticket d'un dossier clos doit-il être supprimé ? Oui si la clôture date d'au moins `days` jours, si un salon
 * existe et s'il n'a pas déjà été supprimé. `days` ≤ 0 (ou non entier) : suppression désactivée.
 */
export function closedTicketDue(demande: ClosedTicketFields, now: Date | number, days: number): boolean {
    if (!Number.isFinite(days) || days <= 0) return false;
    if (!demande.channelId || demande.mentorship?.ticketDeletedAt) return false;
    const closedAt = closedAtOf(demande);
    if (closedAt === null) return false;
    return (typeof now === 'number' ? now : now.getTime()) >= closedAt + days * DAY_MS;
}
