import { SettingKeys } from '../constants/SettingKeys.js';
import { getManagerLogger } from '../logger.js';
import { settingsService } from '../services/SettingsService.js';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_ARRIVAL_DAYS = 7;
export const DEFAULT_TICKET_INACTIVITY_DAYS = 7;
export const DEFAULT_MENTOR_WAIT_DAYS = 2;
export const DEFAULT_CANDIDATE_PERIOD_DAYS = 30;
export const DEFAULT_EXTENSION_DAYS = 14;
export const DEFAULT_MENTOR_REMINDER_DAYS = 3;

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
    | typeof SettingKeys.bot.recrutement.mentorWaitDays
    | typeof SettingKeys.bot.recrutement.candidatePeriodDays
    | typeof SettingKeys.bot.recrutement.extensionDays
    | typeof SettingKeys.bot.recrutement.mentorReminderDays;

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

export const DEFAULT_CLOSED_TICKET_RETENTION_DAYS = 30;

/**
 * Délai de conservation d'un ticket clos. 0 ou négatif = suppression désactivée (interrupteur de sécurité) ;
 * valeur absente, non numérique ou non entière : défaut, journalisé.
 */
export async function closedTicketRetentionDays(): Promise<number> {
    const key = SettingKeys.bot.recrutement.closedTicketRetentionDays;
    const fallback = DEFAULT_CLOSED_TICKET_RETENTION_DAYS;
    let raw: number;
    try {
        raw = await settingsService.getInt(key, fallback);
    } catch (err) {
        logger.warn({ err, key }, `Paramètre ${key} illisible : ${fallback} jour(s) par défaut`);
        return fallback;
    }
    if (typeof raw !== 'number' || !Number.isInteger(raw)) {
        logger.warn({ key, value: raw }, `Paramètre ${key} invalide : ${fallback} jour(s) par défaut`);
        return fallback;
    }
    return raw;
}

export const arrivalDelayMs = async () => daysToMs(await readDelayDays(SettingKeys.bot.recrutement.arrivalDays, DEFAULT_ARRIVAL_DAYS));
export const ticketInactivityDays = () => readDelayDays(SettingKeys.bot.recrutement.ticketInactivityDays, DEFAULT_TICKET_INACTIVITY_DAYS);
export const mentorWaitDays = () => readDelayDays(SettingKeys.bot.recrutement.mentorWaitDays, DEFAULT_MENTOR_WAIT_DAYS);
export const candidatePeriodDays = () => readDelayDays(SettingKeys.bot.recrutement.candidatePeriodDays, DEFAULT_CANDIDATE_PERIOD_DAYS);
export const extensionDays = () => readDelayDays(SettingKeys.bot.recrutement.extensionDays, DEFAULT_EXTENSION_DAYS);
export const mentorReminderDays = () => readDelayDays(SettingKeys.bot.recrutement.mentorReminderDays, DEFAULT_MENTOR_REMINDER_DAYS);
