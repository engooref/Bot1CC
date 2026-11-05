// Fonctions pures pour l'icône calendrier des canaux d'opérations et le rappel avant le départ.
// Aucune dépendance à Discord : tout ce qui peut se tester sans serveur est ici.

/** Icône ajoutée à la fin du nom d'un canal qui porte une opération (comme pour les événements). */
export const OPERATION_CALENDAR_ICON = '📅';

/** Délai entre le rappel et le départ de l'opération (défini ici, pas dans les paramètres). */
export const OPERATION_REMINDER_DELAY_MS = 30 * 60 * 1000;

/** Début du message de rappel : sert aussi de marqueur pour ne jamais envoyer deux rappels. */
export const OPERATION_REMINDER_MARKER = '⏰ **Rappel de départ**';

/** Textes de pied d'embed posés par le bot sur un message d'opération. */
export const OPERATION_FOOTER_TEXTS: readonly string[] = [
  'Interstellar Companion | 1er Corps Colonial',
  'Création automatique depuis le web',
];

/** Nombre maximal de mentions dans un rappel (limite de 2000 caractères par message). */
const MAX_REMINDER_MENTIONS = 60;

export function hasCalendarIcon(name: string): boolean {
  return name.endsWith(OPERATION_CALENDAR_ICON);
}

export function withCalendarIcon(name: string): string {
  return hasCalendarIcon(name) ? name : name + OPERATION_CALENDAR_ICON;
}

export function withoutCalendarIcon(name: string): string {
  return hasCalendarIcon(name) ? name.slice(0, -OPERATION_CALENDAR_ICON.length) : name;
}

/** Vrai si le nom du canal est `expected`, avec ou sans l'icône calendrier (un canal d'opération peut porter 📅). */
export function channelNameMatches(channelName: string, expected: string): boolean {
  return withoutCalendarIcon(channelName) === expected;
}

/**
 * Un rappel n'est prévu que si l'opération a été créée au moins 30 minutes avant son départ.
 * `createdAt` est l'heure de création du message de l'opération.
 */
export function shouldPlanReminder(startAt: Date, createdAt: Date): boolean {
  return startAt.getTime() - createdAt.getTime() >= OPERATION_REMINDER_DELAY_MS;
}

/** Le rappel est dû quand le départ est dans le futur et dans moins de 30 minutes. */
export function isReminderDue(startAt: Date, now: Date): boolean {
  const remaining = startAt.getTime() - now.getTime();
  return remaining > 0 && remaining <= OPERATION_REMINDER_DELAY_MS;
}

/** Délai avant le moment du rappel (jamais négatif). */
export function reminderDelayMs(startAt: Date, now: Date): number {
  return Math.max(0, startAt.getTime() - OPERATION_REMINDER_DELAY_MS - now.getTime());
}

export interface OperationMessageLike {
  authorId: string;
  botId: string;
  footerText?: string | null;
  embedTimestamp?: string | null;
}

/** Un message d'opération est un message du bot dont l'embed porte un pied connu et une date de départ. */
export function isOperationMessage(msg: OperationMessageLike): boolean {
  if (msg.authorId !== msg.botId) return false;
  if (!msg.embedTimestamp || Number.isNaN(Date.parse(msg.embedTimestamp))) return false;
  return !!msg.footerText && OPERATION_FOOTER_TEXTS.includes(msg.footerText);
}

/** Texte du rappel posté dans le fil. Seules des mentions de membres (jamais de rôle ni de @everyone). */
export function buildReminderMessage(userIds: string[], startAt: Date): string {
  const ts = Math.floor(startAt.getTime() / 1000);
  const unique = [...new Set(userIds)];
  const shown = unique.slice(0, MAX_REMINDER_MENTIONS);
  const hidden = unique.length - shown.length;
  const mentions = shown.map((id) => `<@${id}>`).join(' ');
  const more = hidden > 0 ? ` et ${hidden} autre${hidden > 1 ? 's' : ''}` : '';
  return `${OPERATION_REMINDER_MARKER} : l'opération part <t:${ts}:R> (<t:${ts}:t>).\n${mentions}${more}`;
}
