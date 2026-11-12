// Fonction pure : quels canaux d'événements doivent porter l'icône 📅.
// Aucune dépendance à Discord, testable sans serveur.

export interface EventIconCandidate {
  /** Canal Discord où l'événement est publié. */
  channelId: string;
  /** Canal « persistant » (training, gros event) : l'icône reste tant qu'un événement non terminé s'y trouve. */
  persistent: boolean;
  start: Date;
  end?: Date | null;
}

/** Lundi 00:00 (heure locale) de la semaine contenant `now`. */
export function startOfWeek(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/**
 * Canaux qui doivent porter 📅 :
 * - canal d'un jour (lundi…dimanche) : au moins un événement dans la semaine en cours ;
 * - canal persistant (training, gros event) : au moins un événement non terminé, quelle que soit la semaine.
 */
export function channelsWithActiveEvents(events: EventIconCandidate[], now: Date = new Date()): Set<string> {
  const weekStart = startOfWeek(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const result = new Set<string>();
  for (const ev of events) {
    if (ev.persistent) {
      const end = ev.end ?? ev.start;
      if (end.getTime() > now.getTime()) result.add(ev.channelId);
    } else if (ev.start >= weekStart && ev.start < weekEnd) {
      result.add(ev.channelId);
    }
  }
  return result;
}
