import { BotManager } from '../../BotManager.js';
import { AttachmentBuilder, ChannelType, EmbedBuilder, TextChannel, ThreadAutoArchiveDuration, ThreadChannel } from 'discord.js';
import { SafeMethod } from '../../exception/Safe.js';
import { getManagerLogger } from '../../logger.js';
import { defaultConfig } from '../ScreenManager.js';
import cron from 'node-cron';
import path from 'path';
import fs from 'fs';

type ActiveContest = {
  threadId: string;
  startTimestamp: number;
};

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

export class SchedulerScreen {
  private storePath = path.resolve('./config', 'contests.json');
  private contestStore: ActiveContest[] = [];
  private logger = getManagerLogger('SchedulerScreen');

  constructor(private bot: BotManager) {
    // Merge configFile with defaults
    for (const key of Object.keys(defaultConfig)) {
      const val = this.bot.screenManager.configFile.get(key);
      if (val == null) this.bot.screenManager.configFile.add(key, defaultConfig[key]);
    }

    this.ensureStore();
    this.loadStore();
    this.resumeContests();

    // Réagencer le job cron si la config change
    this.bot.screenManager.configFile.on('change', () => this.scheduleWeekly());
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

  /** Sauvegarde l'état actuel des concours */
  @SafeMethod
  private saveStore() {
    fs.writeFileSync(this.storePath, JSON.stringify(this.contestStore));
  }

  @SafeMethod
  private resumeContests() {
    if (this.bot.screenManager.configFile.get('start_schedule')! !== 'O') return;
    const now = Date.now();
    const cfg = this.bot.screenManager.configFile;
    const contestDuration = 7 * 24 * 60 * 60 * 1000;
    const cfgreminder: string = this.bot.screenManager.configFile.get('reminder_hours_before')!;
    const reminderOffset  = parseFloat(String(cfgreminder).replace(',', '.').trim()) * 3600 * 1000;

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
    if (this.bot.screenManager.configFile.get('start_schedule')! !== 'O') return;

    // Ex. schedule_hour = '10:00'
    const [hour, minute] = this.bot.screenManager.configFile.get('schedule_hour')!.split(':').map(Number);
    const dayOfWeek = cronDays[this.bot.screenManager.configFile.get('schedule_day')!];

    // Cron: minute hour * * dayOfWeek
    const cronExpr = `${minute} ${hour} * * ${dayOfWeek}`;
    cron.schedule(cronExpr, () => this.startContest());
    this.logger.debug(`Screen: Création du thread le ${this.bot.screenManager.configFile.get('schedule_day')!} à ${this.bot.screenManager.configFile.get('schedule_hour')!}`);
  }

  @SafeMethod
  private async startContest() {
    if (this.bot.screenManager.configFile.get('start_schedule')! !== 'O') return;

    // 1. Récupérer le channel
    const ch = await this.bot.channels.fetch(this.bot.screenManager.configFile.get('channel_screen')!) as TextChannel;

    // 2. Créer le thread
    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
    const thread = await ch.threads.create({
      name: this.bot.screenManager.configFile.get('thread_name_template')!.replace('{date}', dateStr),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek, // 7 days
      reason: 'Concours hebdomadaire screenshots',
    });

    // Enregistrer le concours
    this.contestStore.push({ threadId: thread.id, startTimestamp: Date.now() });
    this.saveStore();

    // Durées en ms
    const contestDuration = 7 * 24 * 60 * 60 * 1000;

    const cfgreminder: string = this.bot.screenManager.configFile.get('reminder_hours_before')!;
    const reminderOffset  = parseFloat(String(cfgreminder).replace(',', '.').trim()) * 3600 * 1000;
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
      this.bot.screenManager.configFile.get('welcome_message')!,
      this.bot.screenManager.configFile.get('theme_default')! ? `Thème de la semaine: ${this.bot.screenManager.configFile.get('theme_default')!}` : "Pas de thème imposé, surprenez-nous avec vos plus beaux screens !",
      `📅 **Fin du concours :** ${endStr}`,
    ].join('\n');

    // 3. Envoyer le message de bienvenue + réaction
    await thread.send(welcomeText);

    setTimeout(() => this.sendReminder(thread), reminderDelay);
    setTimeout(() => this.endContest(thread), contestDuration);
  }

  @SafeMethod
  private async sendReminder(thread: ThreadChannel) {
    if (this.bot.screenManager.configFile.get('start_schedule')! !== 'O') return;

    try {
      if (this.bot.screenManager.configFile.get('reminder_text_before')!)
        await thread.send(this.bot.screenManager.configFile.get('reminder_text_before')!);
    } catch (err) {
      this.logger.error({ err }, 'Erreur envoi reminder');
    }
  }

  @SafeMethod
  private async endContest(thread: ThreadChannel) {
    if (this.bot.screenManager.configFile.get('start_schedule')! !== 'O') return;

    try {
      // Fermer le thread
      await thread.setArchived(true);

      await thread.send('Le concours est terminé ! Merci à tous pour vos participations. Les résultats seront annoncés sous peu.');

      // Récupérer tous les messages
      const msgs = await thread.messages.fetch();     // Filtrer les images et compter les réactions
      type Entry = { url: string; votes: number };
      const entries: Entry[] = [];
      const emojiVoteName = this.bot.screenManager.configFile.get('emoji_vote')!; // ex: ":1cc:" ou "👍"
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
        .fetch(this.bot.screenManager.configFile.get('channel_result')!) as TextChannel;

      const threadName = 'Resultat screen of the week';

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
          autoArchiveDuration: 1440,           // archivage automatique après 24 h d'inactivité
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
            `Résultat du Screen of the Week ! Voici les 3 captures ayant reçu le plus de réactions **${this.bot.screenManager.configFile.get('emoji_vote')}**.`
          )
          .setTimestamp(); // date de publication automatique

        // 1) Envoi d'abord de l'embed seul
        await threadr.send({ embeds: [summary] });

        // 2) Puis envoi des fichiers seuls, qui apparaîtront juste en dessous
        await threadr.send({ files: attachments });

      } else {
        await threadr.send('Aucune participation détectée cette semaine. ');
      }

      this.contestStore = this.contestStore.filter(c => c.threadId !== thread.id);
    } catch (err) {
      this.logger.error({ err }, 'Erreur endContest');
    }
  }

  async fetchBuffer(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Échec du téléchargement de ${url}: ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
