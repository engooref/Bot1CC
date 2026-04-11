import { BotManager } from '../../BotManager.js';
import { getManagerLogger } from '../../logger.js';

export class SchedulerRefinery {
  private intervalId?: ReturnType<typeof setInterval>;
  private logger = getManagerLogger('SchedulerRefinery');
  private readonly intervalMs: number = 60_000; // 1 min par défaut

  constructor(private bot: BotManager) {
    this.startScheduler();
  }

  private startScheduler(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => this.pollRefineries(), this.intervalMs);
    this.logger.debug(`✔ Polling raffineries toutes les ${this.intervalMs / 1000}s`);
  }

  public resetScheduler(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.startScheduler();
  }

  private async pollRefineries(): Promise<void> {
    try {
      await this.bot.refineryManager.pollAndNotify();
    } catch (err) {
      await this.logger.error({ msg: 'Erreur dans pollRefineries:', err });
    }
  }
}
