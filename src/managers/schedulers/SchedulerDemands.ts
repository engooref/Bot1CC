/**
 * @deprecated SchedulerDemands n'est jamais instancié (désactivé).
 * Conserver pour référence future.
 */
import { BotManager } from '../../BotManager.js';
import { TextChannel } from 'discord.js';
import { SafeMethod } from '../../exception/Safe.js';
import { getManagerLogger } from '../../logger.js';
import path from 'path';
import fs from 'fs';

export class SchedulerDemands {
  private intervalId?: NodeJS.Timeout;
  private readonly intervalMs = 3 * 24 * 60 * 60 * 1000; // 3 jours en ms
  private logger = getManagerLogger('SchedulerDemands');

  constructor(private bot: BotManager) {
    // démarre l'intervalle dès la construction du scheduler
    this.start();
  }

  /** Démarre l'intervalle si une tâche est enregistrée */
  public start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      void this.task().catch(err => this.logger.error({ msg: 'Erreur dans SchedulerDemands task:', err }));
    }, this.intervalMs);
    this.logger.debug(`SchedulerDemands: scheduled task every ${this.intervalMs}ms`);
  }

  /** Arrête l'intervalle */
  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  @SafeMethod
  private async task(): Promise<void> {
    try {
      const cfgPath = path.resolve('./config', 'demands.json');

      // Ensure config file exists
      if (!fs.existsSync(cfgPath)) {
        fs.writeFileSync(cfgPath, JSON.stringify({ lastRun: null, lastId: 0 }));
      }

      // Load config
      let cfgRaw = fs.readFileSync(cfgPath, 'utf8');
      let cfg: { lastRun: string | null; lastId: number } = { lastRun: null, lastId: 0 };
      try { cfg = JSON.parse(cfgRaw); } catch { /* keep defaults */ }

      const lastId = typeof cfg.lastId === 'number' ? cfg.lastId : 0;

      // Récupère les CertifRequest dont l'id est strictement supérieur à lastId
      const repo = this.bot.eventManager.em.getRepository<any>('CertifRequest' as any);
      const requests = await repo.find({
        id: { $gt: lastId }
      }, {
        populate: ['certification', 'certification.pole']
      });

      if (!requests || requests.length === 0) {
        // Met à jour uniquement la date d'exécution
        cfg.lastRun = new Date().toISOString();
        fs.writeFileSync(cfgPath, JSON.stringify(cfg));
        this.logger.debug('SchedulerDemands: no new certif requests found');
        return;
      }

      let maxId = lastId;

      for (const req of requests) {
        try {
          if (req.id > maxId) maxId = req.id;

          const cert = req.certification;
          const pole = cert?.pole;

          // Vérifie si le pole a bien un channel pour les demandes
          const channelId = pole?.channelDemand ?? pole?.channel_demand ?? null;
          if (!channelId) continue;

          // Compose un message simple avec mentions si possible
          const requesterDiscordId = req.user?.discordId;
          const mention = requesterDiscordId ? `<@${requesterDiscordId}>` : 'Demandeur inconnu';
          const certName = cert?.name ?? 'Certification inconnue';
          const msg = [
            `📣 Nouvelle demande de certification (#${req.id})`,
            `Demandeur : ${mention}`,
            `Certification : ${certName}`,
            req.note ? `Note : ${req.note}` : undefined
          ].filter(Boolean).join('\n');

          // Envoi dans le channel indiqué
          const ch = await this.bot.channels.fetch(channelId).catch(() => null);
          if (ch && (ch as TextChannel).send) {
            await (ch as TextChannel).send(msg);
            this.logger.debug(`SchedulerDemands: sent demand #${req.id} to channel ${channelId}`);
          } else {
            this.logger.warn(`SchedulerDemands: channel ${channelId} not found for demand #${req.id}`);
          }
        } catch (err) {
          this.logger.error({ msg: 'SchedulerDemands: error processing a certif request', err });
        }
      }

      // Met à jour la config avec la dernière id traitée et la date d'exécution
      cfg.lastId = maxId;
      cfg.lastRun = new Date().toISOString();
      fs.writeFileSync(cfgPath, JSON.stringify(cfg));
      this.logger.debug(`SchedulerDemands: processed ${requests.length} requests, lastId -> ${cfg.lastId}`);
    } catch (err) {
      this.logger.error({ msg: 'SchedulerDemands: unexpected error in task', err });
    }
  }
}
