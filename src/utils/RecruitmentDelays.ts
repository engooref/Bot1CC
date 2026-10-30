import { SettingKeys } from '../constants/SettingKeys.js';
import { getManagerLogger } from '../logger.js';
import { settingsService } from '../services/SettingsService.js';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_ARRIVAL_DAYS = 7;
export const DEFAULT_TICKET_INACTIVITY_DAYS = 7;
export const DEFAULT_MENTOR_WAIT_DAYS = 2;

const logger = getManagerLogger('RecrutementDelais');

/** Un délai valide est un entier d'au moins 1 jour ; sinon on retombe sur le défaut. */
export function validDays(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : fallback;
}

export function daysToMs(days: number): number {
    return days * DAY_MS;
}

/** « 1 jour », « 7 jours ». */
export function formatDays(days: number): string {
    return `${days} jour${days > 1 ? 's' : ''}`;
}

type DelayKey = typeof SettingKeys.bot.recrutement.arrivalDays
    | typeof SettingKeys.bot.recrutement.ticketInactivityDays
    | typeof SettingKeys.bot.recrutement.mentorWaitDays;

/** Lit un délai en jours ; valeur absente, nulle, négative ou illisible : défaut, journalisé, sans erreur. */
export async function readDelayDays(key: DelayKey, fallback: number): Promise<number> {
    let raw: number;
    try {
        raw = await settingsService.getInt(key, fallback);
    } catch (err) {
        logger.warn({ err, key }, `Paramètre ${key} illisible : ${fallback} jour(s) par défaut`);
        return fallback;
    }
    const days = validDays(raw, fallback);
    if (days !== raw) logger.warn({ key, value: raw }, `Paramètre ${key} invalide : ${fallback} jour(s) par défaut`);
    return days;
}

export const arrivalDelayMs = async () => daysToMs(await readDelayDays(SettingKeys.bot.recrutement.arrivalDays, DEFAULT_ARRIVAL_DAYS));
export const ticketInactivityDays = () => readDelayDays(SettingKeys.bot.recrutement.ticketInactivityDays, DEFAULT_TICKET_INACTIVITY_DAYS);
export const mentorWaitDays = () => readDelayDays(SettingKeys.bot.recrutement.mentorWaitDays, DEFAULT_MENTOR_WAIT_DAYS);
