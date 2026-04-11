import { BotManager } from '../../BotManager.js';
import { Event, EventStatus, EventVisibility } from '../../entities/event/Event.js';
import { addDays, startOfDay, endOfDay } from 'date-fns';
import { SafeMethod } from '../../exception/Safe.js';
import { getManagerLogger } from '../../logger.js';

const DAY_NAMES = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];

export class SchedulerAppEvent {
  private intervalId?: ReturnType<typeof setInterval>;
  private readonly hourMinute: string;
  private readonly dayIndex: number;
  private logger = getManagerLogger('SchedulerAppEvent');

  private programmedTasks = new Map<number, NodeJS.Timeout>();

  constructor(private bot: BotManager) {
    // lit DAY_EVENT (0=lundi) et HOURS_EVENT ("HH:mm")
    this.dayIndex    = parseInt(process.env.DAY_EVENT || '1', 10);  // défaut lundi
    this.hourMinute  = process.env.HOURS_EVENT || '09:00';

    this.startScheduler();
    this.scheduleProgrammedEvents();
    this.logger.debug(`✔ Scheduled weekly send: ${DAY_NAMES[this.dayIndex]} at ${this.hourMinute}`);
  }

  private startScheduler(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    // toutes les 60s on vérifie l'heure & le jour
    this.intervalId = setInterval(() => this.checkDate(), 60_000);
  }

  public resetScheduler(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.startScheduler();
  }

  private checkDate(): void {
    const now = new Date();
    const [h, m] = this.hourMinute.split(':').map(s => parseInt(s, 10));
    if (now.getDay() === (this.dayIndex % 7) &&
        now.getHours() === h && now.getMinutes() === m) {
      // lance l'envoi en tâche asynchrone
      this.sendEventsWeek().catch(async err => await this.logger.error({ msg: 'Erreur dans sendEventsWeek:', err }));
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

    for (const day of DAY_NAMES) {
      const id = this.bot.getParameter("CHANNEL_" + day.toUpperCase()) as string;
      const channel = this.bot.guild.channels.cache.get(id);
      if (channel?.name.endsWith('📅'))
        await channel?.setName(channel?.name.slice(0, -1));
    }

    const countTraining = await this.countEventsByType('ENTRAINEMENT COMPÉTITION');
    let channel = this.bot.guild.channels.cache.get(this.bot.getParameter("CHANNEL_TRAINING") as string);
    if (channel?.name.endsWith('📅') && countTraining === 0)
      await channel.setName(channel.name.slice(0, -1));

    const countEvent = await this.countEventsByType('GROS EVENT');
    channel = this.bot.guild.channels.cache.get(this.bot.getParameter("CHANNEL_GROS_EVENT") as string);
    if (channel?.name.endsWith('📅') && countEvent === 0)
      await channel.setName(channel.name.slice(0, -1));

    for (const ev of events) {
      await this.bot.eventManager.setEvent(ev);
      this.bot.eventManager.em.persist(ev);
    }

    await this.bot.eventManager.em.flush();
  }

  private async countEventsByType(typeLike: string): Promise<number> {
    return await this.bot.eventManager.em.getRepository(Event).count({
      start: { $gte: startOfDay(new Date()) },
      type: { name: { $like: `%${typeLike}%` } }
    });
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
