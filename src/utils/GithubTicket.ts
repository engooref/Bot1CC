/**
 * Calculs purs utilisés par `/github issue` pour décrire le ticket Discord dans l'issue.
 * Aucune dépendance à Discord ni à la base : ces fonctions se testent seules.
 */

/** Longueur maximale d'un titre d'issue GitHub. Au-delà, l'API refuse la création. */
export const ISSUE_TITLE_MAX = 256;

/**
 * Numéro de ticket lu dans le nom du salon, en dernier recours seulement.
 *
 * Les salons créés par le bot s'appellent `tickets-<pseudo>` : le pseudo peut contenir des chiffres
 * (`tickets-bob2000`), qui ne sont pas un numéro de ticket. Seuls `ticket`, `assistance` et `support`
 * suivis d'un nombre sont donc reconnus, et jamais « n'importe quel nombre » du nom.
 */
export function ticketNumberFromChannelName(channelName: string): string | null {
    const match = channelName.match(/(?:ticket|assistance|support)[-_ ]?(\d+)/i);
    return match ? match[1] : null;
}

/**
 * Titre envoyé à GitHub : préfixe (numéro du ticket, sinon nom du salon) puis titre saisi,
 * le tout tronqué à {@link ISSUE_TITLE_MAX} caractères.
 */
export function buildIssueTitle(ticketNumber: string | null, channelName: string, title: string): string {
    const prefix = ticketNumber ? `[Ticket #${ticketNumber}] ` : `[${channelName}] `;
    const full = `${prefix}${title.trim()}`;
    if (full.length <= ISSUE_TITLE_MAX) return full;

    // Le préfixe est conservé (c'est lui qui relie l'issue au ticket) ; c'est le titre saisi qui est coupé.
    const room = ISSUE_TITLE_MAX - prefix.length - 1;
    if (room < 1) return full.slice(0, ISSUE_TITLE_MAX - 1).trimEnd() + '…';
    return `${prefix}${title.trim().slice(0, room).trimEnd()}…`;
}
