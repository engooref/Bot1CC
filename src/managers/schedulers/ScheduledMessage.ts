import { BotManager } from '../../BotManager.js';
import { TextChannel } from 'discord.js';
import { SafeMethod } from '../../exception/Safe.js';
import { getManagerLogger } from '../../logger.js';
import { InteractionContext, ComponentType } from '../../entities/ui/ViewContext.js';
import { ViewHandlers } from '../../view/BaseView.js';
import { buildLiveEmbed, buildButtonRow } from '../../utils/ScheduledMessageBuilder.js';
import path from 'path';
import fs from 'fs';

export type ScheduledResponseButton = {
  customId: string;
  label: string;
  style: 'Success' | 'Danger' | 'Primary' | 'Secondary';
};

export type ScheduledMessageConfig = {
  id: string;
  label: string;
  enabled: boolean;
  channelId: string | null;
  /** Texte brut (peut être vide si embed seul) */
  message: string;
  /** JSON Discord APIEmbed sérialisé, ou null */
  embed: string | null;
  /** Boutons de réponse interactifs (optionnel) */
  buttons: ScheduledResponseButton[] | null;
  /** Premier message du thread (null/vide = pas de thread) */
  threadMessage: string | null;
  /** ID du dernier message Discord envoyé (pour nettoyage des contextes) */
  lastSentMessageId: string | null;
  lastSentChannelId: string | null;
  /** 0 = dimanche, 1 = lundi, …, 6 = samedi */
  dayOfWeek: number;
  hour: number;
  minute: number;
  timezone: string;
  lastRunKey: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string | null;
};

type ZonedParts = {
  year: number; month: number; day: number;
  dayOfWeek: number; hour: number; minute: number;
};

const WEEKDAY_SHORT: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

const CFG_PATH = path.resolve('./config', 'scheduledMessages.json');

export class SchedulerMessage {
  private intervalId?: NodeJS.Timeout;
  private readonly intervalMs = 60 * 1000;
  private logger = getManagerLogger('SchedulerMessage');

  constructor(private bot: BotManager) {
    this.start();
  }

  public start(): void {
    if (this.intervalId) return;
    this.ensureConfigFile();
    void this.task().catch(err =>
      this.logger.error({ msg: 'SchedulerMessage initial task error:', err })
    );
    this.intervalId = setInterval(() => {
      void this.task().catch(err =>
        this.logger.error({ msg: 'SchedulerMessage task error:', err })
      );
    }, this.intervalMs);
    this.logger.debug(`SchedulerMessage: started, interval ${this.intervalMs}ms`);
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  @SafeMethod
  private async task(): Promise<void> {
    const messages = this.loadMessages();
    if (!messages.length) return;

    const now = new Date();
    let dirty = false;

    for (const cfg of messages) {
      try {
        if (!cfg.enabled)   continue;
        if (!cfg.channelId) { this.logger.warn(`SchedulerMessage [${cfg.id}]: no channelId`); continue; }

        const hasContent = !!cfg.message?.trim() || !!cfg.embed || !!cfg.buttons?.length;
        if (!hasContent)    { this.logger.warn(`SchedulerMessage [${cfg.id}]: nothing to send`); continue; }

        if (!this.isValidSchedule(cfg)) {
          this.logger.warn({ msg: `SchedulerMessage [${cfg.id}]: invalid schedule`, cfg });
          continue;
        }

        const zoned = this.getZonedParts(now, cfg.timezone);
        const match =
          zoned.dayOfWeek === cfg.dayOfWeek &&
          zoned.hour      === cfg.hour      &&
          zoned.minute    === cfg.minute;

        if (!match) continue;

        const runKey = this.buildRunKey(zoned);
        if (cfg.lastRunKey === runKey) continue;

        const ch = await this.bot.channels.fetch(cfg.channelId).catch(() => null);
        if (!ch || !(ch as TextChannel).send) {
          this.logger.warn(`SchedulerMessage [${cfg.id}]: channel not found or not sendable`);
          continue;
        }

        // ── Build payload ────────────────────────────────────────────────────
        const payload: Parameters<TextChannel['send']>[0] = {};
        if (cfg.message?.trim()) payload.content = cfg.message;

        if (cfg.embed || cfg.buttons?.length) {
          payload.embeds = [await buildLiveEmbed(cfg, {}, this.bot) as any];
        }

        const btnRows = buildButtonRow(cfg);
        if (btnRows.length) payload.components = btnRows as any[];

        const sentMsg = await (ch as TextChannel).send(payload);

        // ── Register InteractionContext for buttons ───────────────────────────
        if (cfg.buttons?.length) {
          const em = this.bot.db.getEm();

          if (cfg.lastSentMessageId) {
            await em.nativeDelete(InteractionContext, {
              messageId: cfg.lastSentMessageId,
              handlerKey: ViewHandlers.ScheduledResponseHandler,
            });
          }

          for (const btn of cfg.buttons) {
            em.persist(em.create(InteractionContext, {
              messageId:     sentMsg.id,
              channelId:     cfg.channelId,
              customId:      btn.customId,
              handlerKey:    ViewHandlers.ScheduledResponseHandler,
              componentType: ComponentType.Button,
              data:          { configId: cfg.id },
            }));
          }
          await em.flush();

          cfg.lastSentMessageId = sentMsg.id;
          cfg.lastSentChannelId = cfg.channelId;

          // Wipe responses for this config so the new message starts fresh
          this.clearResponses(cfg.id);
        }

        // ── Create thread if requested ───────────────────────────────────────
        if (cfg.threadMessage?.trim()) {
          const thread = await sentMsg.startThread({ name: cfg.label, autoArchiveDuration: 1440 });
          if (cfg.threadMessage?.trim()) await thread.send(cfg.threadMessage);
        }

        cfg.lastRunKey = runKey;
        cfg.lastRunAt  = now.toISOString();
        dirty = true;

        this.logger.debug(`SchedulerMessage [${cfg.id}]: sent to ${cfg.channelId} (runKey ${runKey})`);
      } catch (err) {
        this.logger.error({ msg: `SchedulerMessage [${cfg.id}]: error`, err });
      }
    }

    if (dirty) this.saveMessages(messages);
  }

  // ─── Schedule validation ─────────────────────────────────────────────────────
  private isValidSchedule(cfg: ScheduledMessageConfig): boolean {
    if (!Number.isInteger(cfg.dayOfWeek) || cfg.dayOfWeek < 0 || cfg.dayOfWeek > 6) return false;
    if (!Number.isInteger(cfg.hour)      || cfg.hour < 0      || cfg.hour > 23)      return false;
    if (!Number.isInteger(cfg.minute)    || cfg.minute < 0    || cfg.minute > 59)    return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: cfg.timezone }).format(new Date());
      return true;
    } catch { return false; }
  }

  // ─── Timezone helpers ────────────────────────────────────────────────────────
  private getZonedParts(date: Date, timezone: string): ZonedParts {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    const parts = fmt.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, {});
    const dow = WEEKDAY_SHORT[(parts.weekday ?? '').toLowerCase()];
    if (dow === undefined) throw new Error(`Invalid weekday: ${parts.weekday}`);
    return {
      year:      parseInt(parts.year   ?? '0', 10),
      month:     parseInt(parts.month  ?? '0', 10),
      day:       parseInt(parts.day    ?? '0', 10),
      dayOfWeek: dow,
      hour:      parseInt(parts.hour   ?? '0', 10),
      minute:    parseInt(parts.minute ?? '0', 10),
    };
  }

  private buildRunKey(p: ZonedParts): string {
    return [
      String(p.year).padStart(4, '0'),
      String(p.month).padStart(2, '0'),
      String(p.day).padStart(2, '0'),
      String(p.hour).padStart(2, '0'),
      String(p.minute).padStart(2, '0'),
    ].join('-');
  }

  // ─── Config file ─────────────────────────────────────────────────────────────
  private ensureConfigFile(): void {
    const dir = path.dirname(CFG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(CFG_PATH)) fs.writeFileSync(CFG_PATH, '[]');
  }

  private loadMessages(): ScheduledMessageConfig[] {
    try {
      return JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')) as ScheduledMessageConfig[];
    } catch { return []; }
  }

  private saveMessages(messages: ScheduledMessageConfig[]): void {
    fs.writeFileSync(CFG_PATH, JSON.stringify(messages, null, 2));
  }

  private clearResponses(configId: string): void {
    const responsesPath = path.resolve('./config', 'scheduledMessageResponses.json');
    try {
      if (!fs.existsSync(responsesPath)) return;
      const all = JSON.parse(fs.readFileSync(responsesPath, 'utf8')) as Record<string, unknown>;
      delete all[configId];
      fs.writeFileSync(responsesPath, JSON.stringify(all, null, 2));
    } catch { /* ignore */ }
  }
}
