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
