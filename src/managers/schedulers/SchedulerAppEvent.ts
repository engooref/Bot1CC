import { SettingKeys } from '../../constants/SettingKeys.js';
import { settingsService } from '../../services/SettingsService.js';
import { BotManager } from '../../BotManager.js';
import { Event, EventStatus, EventVisibility } from '../../entities/event/Event.js';
import { addDays, startOfDay, endOfDay } from 'date-fns';
import { SafeMethod } from '../../exception/Safe.js';
import { getManagerLogger } from '../../logger.js';


export class SchedulerAppEvent {
  private intervalId?: ReturnType<typeof setInterval>;
  private logger = getManagerLogger('SchedulerAppEvent');

  private programmedTasks = new Map<number, NodeJS.Timeout>();

  constructor(private bot: BotManager) {
    this.startScheduler();
    this.scheduleProgrammedEvents();
  }

  private startScheduler(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    // toutes les 60s on vérifie l'heure & le jour
    this.intervalId = setInterval(() => {
      void this.checkDate().catch(err => this.logger.error({ msg: 'Erreur dans le scheduler hebdomadaire', err }));
    }, 60_000);
  }

  public resetScheduler(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.startScheduler();
  }

  private async checkDate(): Promise<void> {
    const [day, time] = await Promise.all([
      settingsService.getString(SettingKeys.bot.events.publicationDay),
      settingsService.getString(SettingKeys.bot.events.publicationTime),
    ]);
    if (!/^[0-6]$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      throw new Error('Paramètres bot.events.publication_day ou bot.events.publication_time invalides.');
    }
    const now = new Date();
    const [hour, minute] = time.split(':').map(Number);
    if (now.getDay() === Number(day) && now.getHours() === hour && now.getMinutes() === minute) {
      await this.sendEventsWeek();
    }
  }

  @SafeMethod
  public async sendEventsWeek(): Promise<void> {
    await this.logger.debug('→ sendEventsWeek');
    const today = new Date();
    // trouve le prochain lundi
    const daysUntilMonday = (8 - today.getDay()) % 7;
    const monday = addDays(startOfDay(today), daysUntilMonday);
    const sunday = endOfDay(addDays(monday, 6));

    // version $between
    const events = await this.bot.eventManager.em.getRepository(Event).find({
      start: {
        $gte: monday,
        $lte: sunday,
      },
      status: { $ne: EventStatus.PROGRAMMED },
      visibility: EventVisibility.PUBLIC,
    }, {
      populate: ['*', 'responses.users'],
    });

    for (const ev of events) {
      await this.bot.eventManager.setEvent(ev);
      this.bot.eventManager.em.persist(ev);
    }

    await this.bot.eventManager.em.flush();
  }


  /** Planifie tous les events PROGRAMMED à leur date publishAt */
  public async scheduleProgrammedEvents(): Promise<void> {
    const events = await this.bot.eventManager.em.getRepository(Event).find({
      status: EventStatus.PROGRAMMED,
      publishAt: { $ne: null }
    });

    for (const ev of events) {
      if (!ev.publishAt) continue;
      const now = Date.now();
      const publishTime = new Date(ev.publishAt).getTime();
      const delay = publishTime - now;
      if (delay <= 0) {
        // Si la date est passée, lance tout de suite
        await this.bot.eventManager.setEvent(ev);
        continue;
      }
      // Si déjà planifié, skip
      if (this.programmedTasks.has(ev.id)) continue;
      const timeout = setTimeout(async () => {
        await this.bot.eventManager.setEvent(ev);
        this.programmedTasks.delete(ev.id);
      }, delay);
      this.programmedTasks.set(ev.id, timeout);
    }
  }

  /**
   * Met à jour ou annule la tâche programmée pour un event.
   * À appeler quand un event est modifié ou supprimé.
   */
  public async updateOrCancelProgrammedEvent(ev: Event): Promise<void> {
    // Annule la tâche si elle existe
    if (this.programmedTasks.has(ev.id)) {
      clearTimeout(this.programmedTasks.get(ev.id));
      this.programmedTasks.delete(ev.id);
    }

    // Si l'event est supprimé ou n'est plus PROGRAMMED, on ne reprogramme pas
    if (!ev || ev.status !== EventStatus.PROGRAMMED || !ev.publishAt) return;

    // Reprogramme si la date est dans le futur
    const now = Date.now();
    const publishTime = new Date(ev.publishAt).getTime();
    const delay = publishTime - now;
    if (delay <= 0) {
      await this.bot.eventManager.setEvent(ev);
      return;
    }
    const timeout = setTimeout(async () => {
      await this.bot.eventManager.setEvent(ev);
      this.programmedTasks.delete(ev.id);
    }, delay);
    this.programmedTasks.set(ev.id, timeout);
  }
}
