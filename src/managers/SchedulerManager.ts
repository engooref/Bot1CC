// src/managers/SchedulerManager.ts
import  BotManager  from '../BotManager.js';
import { Event }      from '../entities/Event.js';
import { Response }   from '../entities/Response.js';
import { addDays, startOfDay, endOfDay } from 'date-fns';
import { GuildMember, ThreadAutoArchiveDuration } from 'discord.js';
import { FilterQuery } from '@mikro-orm/core';
import { SafeMethod } from '../exception/Safe.js';
import logger from '../logger.js';

const DAY_NAMES = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];

export default class SchedulerManager {
  public appEvent: SchedulerAppEvent;
  public event:   SchedulerEvent;

  constructor(bot: BotManager) {
    this.appEvent = new SchedulerAppEvent(bot);
    this.event    = new SchedulerEvent(bot);
  }
}

export class SchedulerAppEvent {
  private intervalId?: ReturnType<typeof setInterval>;
  private readonly hourMinute: string;
  private readonly dayIndex: number;

  constructor(private bot: BotManager) {
    // lit DAY_EVENT (0=lundi) et HOURS_EVENT ("HH:mm")
    this.dayIndex    = parseInt(process.env.DAY_EVENT || '1', 10);  // défaut lundi
    this.hourMinute  = process.env.HOURS_EVENT || '09:00';


    this.startScheduler();
    logger.info(`✔ Scheduled weekly send: ${DAY_NAMES[this.dayIndex]} at ${this.hourMinute}`);
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
      // lance l’envoi en tâche asynchrone
      this.sendEventsWeek().catch(err => logger.error('sendEventsWeek error', err));
    }
  }

  @SafeMethod
  private async sendEventsWeek(): Promise<void> {
    logger.info('→ sendEventsWeek');
    const today = new Date();
    // trouve le prochain lundi
    const daysUntilMonday = (8 - today.getDay()) % 7;
    const monday = addDays(startOfDay(today), daysUntilMonday);
    const sunday = endOfDay(addDays(monday, 6));

    // version $between
    const events = await this.bot.evMgr.em.getRepository(Event).find({
        start: { 
          $gte: monday,
          $lte: sunday, 
        },
    }, {
      populate: ['*', 'responses.users'],
    });

    for (const ev of events) {
      await this.bot.evMgr.setEvent(ev);
      this.bot.evMgr.em.persist(ev);
    }

    await this.bot.evMgr.em.flush()
  }
}

export class SchedulerEvent {
  private pendingTasks = new Map<number, NodeJS.Timeout>();

  constructor(private bot: BotManager) {
    // démarre la boucle toutes les 60s
    setInterval(() => this.checkEvents(), 60_000);
  }

  @SafeMethod
  private async checkEvents(): Promise<void> {
    const today = new Date();
    const start = startOfDay(today);
    const end   = endOfDay(today);

    const events = await this.bot.evMgr.em.getRepository(Event).find({
        start: { 
          $gte: start,
          $lte: end, 
        },
    }, );

    for (const ev of events) {
      const diffMs = ev.start.getTime() - today.getTime();
      const diffMin = diffMs / 60_000;

      // si dans les 15 premières minutes, envoie direct
      if (diffMin > 0 && diffMin <= 15) {
        await this.sendReminder(ev);
      }
      // sinon planifie à 15 min avant
      else if (diffMin > 15 && diffMin <= 24 * 60) {
        this.scheduleReminder(ev, diffMs - 15 * 60_000);
      }
    }
  }

  private scheduleReminder(ev: Event, delayMs: number): void {
    if (this.pendingTasks.has(ev.id)) return;
    const timeout = setTimeout(() => {
      this.sendReminder(ev).catch(logger.error);
      this.pendingTasks.delete(ev.id);
    }, delayMs);
    this.pendingTasks.set(ev.id, timeout);
  }

  @SafeMethod
  private async sendReminder(ev: Event): Promise<void> {
    // protège contre doublons
    if (ev.appelMsgDiscord) return;

    const channel = this.bot.evMgr.getChannel(ev);
    if (!ev.discordId) return;
    const msg = await channel.messages.fetch(ev.discordId).catch(() => null);
    if (!msg) return;
    
    const resps = await this.bot.evMgr.em.getRepository(Response).find({
        event: ev,
        typeRep: "accepted"
    } as FilterQuery<Response>);

    const mentions: Array<GuildMember | null> = await Promise.all(
      resps
        .map(r => r.users?.discordId)
        .filter((id): id is string => !!id)
        .map(id => this.bot.guild.members.fetch(id).catch(() => null))
    );
    const line = mentions
      .filter(m => m)
      .map(m => `<@${m!.id}>`)
      .join(' ');

    // Crée un thread sur le message d'origine
    const thread = await msg.startThread({
      name: `Rappel : ${ev.name}`,         // nom du thread
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,            // en minutes, ici 1h
      reason: 'Rappel des participants',
    });

    // Envoie le contenu dans le thread
    await thread.send(`${ev.name}\n\n${line}`);
    ev.appelMsgDiscord = true;
    await this.bot.evMgr.em.persistAndFlush(ev);
  }

  public cancelReminder(ev: Event): void {
    const to = this.pendingTasks.get(ev.id);
    if (to) {
      clearTimeout(to);
      this.pendingTasks.delete(ev.id);
    }
    ev.appelMsgDiscord = false;
  }

  public updateEvent(ev: Event): void {
    // 1) Annule l’éventuel rappel en attente
    this.cancelReminder(ev);

    // 2) Calcule le délai restant jusqu’au début
    const now = new Date();
    const diffMs = ev.start.getTime() - now.getTime();

    // 3) Si on a déjà envoyé le rappel Discord, on ne fait rien
    if (ev.appelMsgDiscord) {
      return;
    }

    // 4) Si on est dans les 15 minutes précédant l’event, envoie immédiatement
    if (diffMs > 0 && diffMs <= 15 * 60_000) {
      void this.sendReminder(ev);
    }
    // 5) Sinon, si l’event est dans les prochaines 24 heures, on re-schedule
    else if (diffMs > 15 * 60_000 && diffMs <= 24 * 60 * 60_000) {
      this.scheduleReminder(ev, diffMs - 15 * 60_000);
    }
    // Au-delà de 24h ou échéance passée, on n’en fait pas plus
  }

}
