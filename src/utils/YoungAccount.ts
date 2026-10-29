const DAY_MS = 24 * 60 * 60 * 1000;

/** Âge minimal par défaut d'un compte Discord (3 mois). */
export const DEFAULT_YOUNG_ACCOUNT_MIN_DAYS = 90;

/** Convertit le paramètre en nombre de jours valide, sinon revient à la valeur par défaut. */
export function normalizeYoungAccountMinDays(days: number): number {
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_YOUNG_ACCOUNT_MIN_DAYS;
}

/** Vrai si le compte avait moins de `minDays` jours à la date `at`. */
export function isYoungAccount(createdTimestamp: number, at: number, minDays: number): boolean {
  return at - createdTimestamp < normalizeYoungAccountMinDays(minDays) * DAY_MS;
}

/**
 * Un compte jeune est refusé, sauf s'il s'agit d'un bot ou d'un identifiant exempté.
 * Un compte exempté n'est simplement pas soumis à la règle de l'âge minimal.
 */
export function shouldRejectYoungAccount(opts: {
  createdTimestamp: number;
  at: number;
  minDays: number;
  isBot: boolean;
  userId: string;
  exemptIds: readonly string[];
}): boolean {
  if (opts.isBot || opts.exemptIds.includes(opts.userId)) return false;
  return isYoungAccount(opts.createdTimestamp, opts.at, opts.minDays);
}
