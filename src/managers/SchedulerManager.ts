// src/managers/SchedulerManager.ts
import  BotManager  from '../BotManager.js';
import { Event }      from '../entities/Event.js';
import { Response }   from '../entities/Response.js';
import { addDays, startOfDay, endOfDay } from 'date-fns';
import { AttachmentBuilder, ChannelType, EmbedBuilder, GuildMember, TextChannel, ThreadAutoArchiveDuration, ThreadChannel } from 'discord.js';
import { FilterQuery } from '@mikro-orm/core';
import { SafeMethod } from '../exception/Safe.js';
import logger from '../logger.js';
import cron from 'node-cron';
import { defaultConfig } from './ScreenManager.js';
import path from 'path';
import fs from 'fs';

const DAY_NAMES = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];

// Mapping JS cron days (0–6) to names
const cronDays: Record<string, number> = {
  SUNDAY:    0,
  MONDAY:    1,
  TUESDAY:   2,
  WEDNESDAY: 3,
  THURSDAY:  4,
  FRIDAY:    5,
  SATURDAY:  6,
};

type ActiveContest = {
  threadId: string;
  startTimestamp: number;
};

export default class SchedulerManager {
  public appEvent: SchedulerAppEvent;
  public event:   SchedulerEvent;
  public screen: SchedulerScreen;

  constructor(bot: BotManager) {
    this.appEvent = new SchedulerAppEvent(bot);
    this.event    = new SchedulerEvent(bot);
    this.screen = new SchedulerScreen(bot);
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


    for (const day of DAY_NAMES) {
      const id = this.bot.getParameter("CHANNEL_" + day.toUpperCase()) as string;
      const channel = this.bot.guild.channels.cache.get(id);
      if (channel?.name.endsWith('📅'))
        await channel?.setName(channel?.name.slice(0, -1))

    }

    let channel = this.bot.guild.channels.cache.get(this.bot.getParameter("CHANNEL_TRAINING") as string);
    if (channel?.name.endsWith('📅'))
      await channel?.setName(channel?.name.slice(0, -1))
    
    channel = this.bot.guild.channels.cache.get(this.bot.getParameter("CHANNEL_GROS_EVENT") as string);
    if (channel?.name.endsWith('📅'))
      await channel?.setName(channel?.name.slice(0, -1))


    for (const ev of events) {
      await this.bot.evMgr.setEvent(ev);
      this.bot.evMgr.em.persist(ev);
    }

    await this.bot.evMgr.em.flush()
  }
}

export class SchedulerEvent {
  private pendingTasks = new Map<number, NodeJS.Timeout>();
  // Map pour stocker l'ID du channel vocal parent par event
  private voiceParentChannels = new Map<number, string>();
  private voiceParentCleanup = new Map<number, NodeJS.Timeout>();

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
    const thread = msg.hasThread ? msg.thread! : await msg.startThread({
      name: `Rappel : ${ev.name}`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      reason: 'Rappel des participants',
    });
    await thread.send(`${ev.name}\n\n${line}`);
    ev.appelMsgDiscord = true;
    await this.bot.evMgr.em.persistAndFlush(ev);

    // --- Création du channel vocal parent ---
    // On crée le channel vocal parent dans la même catégorie que le channel textuel de l'event
    const parentCategory = channel.parentId;
    const voiceParent = await this.bot.guild.channels.create({
      name: `Créer un vocal d'équipe - ${ev.name}`,
      type: ChannelType.GuildVoice,
      parent: parentCategory ?? undefined,
      userLimit: 99,
      reason: `Préparation event ${ev.name}`
    });
    ev.vocalParentId = voiceParent.id;
    await this.bot.evMgr.em.persistAndFlush(ev);

    // Planifie la suppression du channel vocal parent à la fin de l'event
    const now = Date.now();
    const end = new Date(ev.end).getTime();
    const delay = Math.max(0, end - now);
    if (this.voiceParentCleanup.has(ev.id)) {
      clearTimeout(this.voiceParentCleanup.get(ev.id));
    }
    const cleanupTimeout = setTimeout(async () => {
      try {
        if (ev.vocalParentId) {
          const ch = await this.bot.guild.channels.fetch(ev.vocalParentId).catch(() => null);
          if (ch) await ch.delete('Fin de l\'event');
          ev.vocalParentId = undefined;
          await this.bot.evMgr.em.persistAndFlush(ev);
        }
      } catch {}
      this.voiceParentChannels.delete(ev.id);
      this.voiceParentCleanup.delete(ev.id);
    }, delay);
    this.voiceParentCleanup.set(ev.id, cleanupTimeout);
  }

  // Méthode utilitaire pour récupérer l'ID du channel vocal parent d'un event
  public getVoiceParentChannelId(eventId: number): string | undefined {
    return this.voiceParentChannels.get(eventId);
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

export class SchedulerScreen { 
  private storePath = path.resolve('./config', 'contests.json');
  private contestStore: ActiveContest[] = [];

  constructor(private bot: BotManager) {

    
    // Merge configFile with defaults
    for (const key of Object.keys(defaultConfig)) {
      const val = this.bot.scrMgr.configFile.get(key);
      if (val == null) this.bot.scrMgr.configFile.add(key, defaultConfig[key]);
    }

    
    this.ensureStore();
    this.loadStore();
    this.resumeContests();

    // Réagencer le job cron si la config change
    this.bot.scrMgr.configFile.on('change', () => this.scheduleWeekly());
    this.scheduleWeekly();

  }

  @SafeMethod
  private ensureStore() {
    if (!fs.existsSync(this.storePath)) {
      fs.writeFileSync(this.storePath, JSON.stringify([]));
    }
  }

  /** Charge les concours actifs depuis le fichier */
  @SafeMethod
  private loadStore() {
    try {
      const data = fs.readFileSync(this.storePath, 'utf-8');
      this.contestStore = JSON.parse(data) as ActiveContest[];
    } catch {
      this.contestStore = [];
    }
  }

  /** Sauvegarde l’état actuel des concours */
  @SafeMethod
  private saveStore() {
    fs.writeFileSync(this.storePath, JSON.stringify(this.contestStore));
  }

  @SafeMethod
  private resumeContests() {
    if (this.bot.scrMgr.configFile.get('start_schedule')! !== 'O') return;
    const now = Date.now();
    const cfg = this.bot.scrMgr.configFile;
    const contestDuration = 7 * 24 * 60 * 60 * 1000 // ou 7d en prod
    const cfgreminder: string = this.bot.scrMgr.configFile.get('reminder_hours_before')!;
    const reminderOffset  = parseFloat(String(cfgreminder).replace(',', '.').trim()) * 3600 * 1000

    this.contestStore.forEach(contest => {
      const elapsed = now - contest.startTimestamp;
      const toEnd        = contestDuration - elapsed;
      const toReminder   = contestDuration - reminderOffset - elapsed;
      const threadFetch  = this.bot.channels
          .fetch(cfg.get('channel_screen')!)
          .then(ch => (ch as TextChannel).threads.fetch(contest.threadId));

      // 1) Si on doit encore envoyer le rappel
      if (toReminder > 0) {
        setTimeout(() => threadFetch.then(t => this.sendReminder(t as ThreadChannel)), toReminder);
      }

      // 2) Si le concours n'est pas encore clos
      if (toEnd > 0) {
        setTimeout(() => threadFetch.then(t => this.endContest(t as ThreadChannel)), toEnd);
      }
      // 3) Sinon (on redémarre APRES la clôture) -> on nettoie sans renvoyer
      else {
        this.contestStore = this.contestStore.filter(c => c.threadId !== contest.threadId);
        this.saveStore();
      }
    });
  }
  
  @SafeMethod
  private scheduleWeekly() {
    if (this.bot.scrMgr.configFile.get('start_schedule')! !== 'O') return;

    // Ex. schedule_hour = '10:00'
    const [hour, minute] = this.bot.scrMgr.configFile.get('schedule_hour')!.split(':').map(Number);
    const dayOfWeek = cronDays[this.bot.scrMgr.configFile.get('schedule_day')!];

    // Cron: minute hour * * dayOfWeek
    const cronExpr = `${minute} ${hour} * * ${dayOfWeek}`;
    cron.schedule(cronExpr, () => this.startContest());
    logger.info(`Screen: Création du thread le ${this.bot.scrMgr.configFile.get('schedule_day')!} à ${this.bot.scrMgr.configFile.get('schedule_hour')!}`);
  }

  @SafeMethod
  private async startContest() {
    if (this.bot.scrMgr.configFile.get('start_schedule')! !== 'O') return;

    // 1. Récupérer le channel
    const ch = await this.bot.channels.fetch(this.bot.scrMgr.configFile.get('channel_screen')!) as TextChannel;
    
    // 2. Créer le thread
    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
    const thread = await ch.threads.create({
      name: this.bot.scrMgr.configFile.get('thread_name_template')!.replace('{date}', dateStr),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek, // 7 days
      reason: 'Concours hebdomadaire screenshots',
    });

    // Enregistrer le concours
    this.contestStore.push({ threadId: thread.id, startTimestamp: Date.now() });
    this.saveStore();

    // Durées en ms
    const contestDuration = 7 * 24 * 60 * 60 * 1000;

    const cfgreminder: string = this.bot.scrMgr.configFile.get('reminder_hours_before')!;
    const reminderOffset  = parseFloat(String(cfgreminder).replace(',', '.').trim()) * 3600 * 1000
    const reminderDelay = contestDuration - reminderOffset;

    // Calcul des dates
    const endDate      = new Date(now.getTime() + contestDuration);

    // Format FR
    const opts: Intl.DateTimeFormatOptions = {
      timeZone: 'Europe/Paris',
      weekday:  'long',
      year:     'numeric',
      month:    '2-digit',
      day:      '2-digit',
      hour:     '2-digit',
      minute:   '2-digit'
    };

    const endStr      = endDate.toLocaleDateString('fr-FR', opts);

    // Message enrichi
    const welcomeText = [
      this.bot.scrMgr.configFile.get('welcome_message')!,
      this.bot.scrMgr.configFile.get('theme_default')! ? `Thème de la semaine: ${this.bot.scrMgr.configFile.get('theme_default')!}` : "Pas de thème imposé, surprenez-nous avec vos plus beaux screens !",
      `📅 **Fin du concours :** ${endStr}`,
    ].join('\n');

    // 3. Envoyer le message de bienvenue + réaction
    await thread.send(welcomeText);

 
    setTimeout(() => this.sendReminder(thread), reminderDelay);
    setTimeout(() => this.endContest(thread), contestDuration);
  }

  
  @SafeMethod
  private async sendReminder(thread: ThreadChannel) {
    if (this.bot.scrMgr.configFile.get('start_schedule')! !== 'O') return;

    try {
      if (this.bot.scrMgr.configFile.get('reminder_text_before')!)
        await thread.send(this.bot.scrMgr.configFile.get('reminder_text_before')!);
    } catch (err) {
      console.error('Erreur envoi reminder:', err);
    }
  }

  @SafeMethod
  private async endContest(thread: ThreadChannel) {
    if (this.bot.scrMgr.configFile.get('start_schedule')! !== 'O') return;

    try {
      // Fermer le thread
      await thread.setArchived(true);

      await thread.send('Le concours est terminé ! Merci à tous pour vos participations. Les résultats seront annoncés sous peu.');
      
      // Récupérer tous les messages
      const msgs = await thread.messages.fetch();     // Filtrer les images et compter les réactions
      type Entry = { url: string; votes: number };
      const entries: Entry[] = [];
      const emojiVoteName = this.bot.scrMgr.configFile.get('emoji_vote')!; // ex: ":1cc:" ou "👍"
      let emojiVoteKey = emojiVoteName;

      // Si c'est un emoji custom (format :nom:), on cherche son ID dans le cache
      const match = emojiVoteName.match(/^:?(?<name>\w+):?$/);
      if (match && this.bot.guild.emojis.cache.size) {
        const found = this.bot.guild.emojis.cache.find(e => e.name?.toLowerCase() === match.groups!.name.toLowerCase());
        if (found) emojiVoteKey = found.id!; // .identifier pour custom, sinon garde le caractère
      }

      msgs.forEach(msg => {
        const attachments = msg.attachments.filter(att =>
          ['image/png','image/jpeg'].includes(att.contentType || '')
        );
        attachments.forEach(att => {
          const votes = msg.reactions.cache.get(emojiVoteKey)?.count ?? 0;
          // retirer 1 si le bot a lui-même réagi
          entries.push({ url: att.url, votes: Math.max(0, votes - 1) });
        });
      });

      // Top 3
      const top3 = entries
        .sort((a,b) => b.votes - a.votes)
        .slice(0, 3);

      // Poster dans channel_result
      
      const resCh = await this.bot.channels
        .fetch(this.bot.scrMgr.configFile.get('channel_result')!) as TextChannel;

      const threadName = 'Resultat screenof the week';

      // 1. S'assurer que les threads sont chargés en cache
      await resCh.threads.fetch();

      // 2. Chercher le thread existant
      let threadr = resCh.threads.cache.find(
        t => t.name === threadName 
      ) as ThreadChannel | undefined;

      // 3. S'il n'existe pas, le créer
      if (!threadr) {
        threadr = await resCh.threads.create({
          name: threadName,
          autoArchiveDuration: 1440,           // archivage automatique après 24 h d’inactivité
          type: ChannelType.PublicThread,      // ou GuildPublicThread selon ta version
          reason: 'Création du thread pour les résultats weekly'
        });
      }

      if (top3.length) {
        const attachments = await Promise.all(
          top3.map(async (e, i) =>
            new AttachmentBuilder(
              await this.fetchBuffer(e.url),
              { name: `top${i + 1}.png` }
            )
          )
        );

        // 2) Construis un embed plus riche
        const summary = new EmbedBuilder()
          .setTitle(`🏆 Résultats du concours ${thread.name}`)
          .setColor(0x7289DA) // Discord blurple
          .addFields(
            { name: '🥇 1er', value: `Votes : **${top3[0]?.votes ?? 0}**`, inline: true },
            { name: '🥈 2e', value: `Votes : **${top3[1]?.votes ?? 0}**`, inline: true },
            { name: '🥉 3e', value: `Votes : **${top3[2]?.votes ?? 0}**`, inline: true },
          )
          .setDescription(
            `Résultat du Screen of the Week ! Voici les 3 captures ayant reçu le plus de réactions **${this.bot.scrMgr.configFile.get('emoji_vote')}**.`
          )
          
          .setTimestamp(); // date de publication automatique

        // 1) Envoi d’abord de l’embed seul
        await threadr.send({ embeds: [summary] });

        // 2) Puis envoi des fichiers seuls, qui apparaîtront juste en dessous
        await threadr.send({ files: attachments });
              
      } else {
        await threadr.send('Aucune participation détectée cette semaine. ');
      }

      this.contestStore = this.contestStore.filter(c => c.threadId !== thread.id);
    } catch (err) {
      console.error('Erreur endContest:', err);
    }
  }

  

  async fetchBuffer(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Échec du téléchargement de ${url}: ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}