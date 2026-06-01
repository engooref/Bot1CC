import {
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  StringSelectMenuInteraction,
} from 'discord.js';
import { BotManager } from '../BotManager.js';
import { getManagerLogger } from '../logger.js';
import { ComponentType, InteractionContext } from '../entities/ui/ViewContext.js';
import { ViewHandlers } from '../view/BaseView.js';
import { AM_IDS, ALL_AM_IDS, AutoMessageView } from '../view/AutoMessageView.js';
import { ScheduledMessageConfig } from './schedulers/ScheduledMessage.js';
import { buildLiveEmbed, buildButtonRow, ResponseMap } from '../utils/ScheduledMessageBuilder.js';
import type { InteractionData } from '../types/interaction.js';
import path from 'path';
import fs from 'fs';

const RESPONSES_PATH = path.resolve('./config', 'scheduledMessageResponses.json');

const CFG_PATH = path.resolve('./config', 'scheduledMessages.json');

export type AutoMessageState = {
  step: 'list' | 'edit';
  editingId: string | null;
};

type AnyFormInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ChannelSelectMenuInteraction
  | ModalSubmitInteraction;

export class AutoMessageManager {
  private logger = getManagerLogger('AutoMessageManager');

  constructor(private bot: BotManager) {}

  public getSlashHandlers() {
    return {
      scheduledMessageHandler: this.handleCommand.bind(this),
    } as Record<string, (interaction: ChatInputCommandInteraction) => Promise<void>>;
  }

  // ─── Slash command entry ────────────────────────────────────────────────────
  private async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.editReply({ content: '🚫 Accès réservé aux administrateurs.' });
      return;
    }

    const messages = this.loadMessages();
    const state: AutoMessageState = { step: 'list', editingId: null };
    const { embed, rows } = AutoMessageView.buildListView(messages);

    // SlashCommandManager already called deferReply({ ephemeral: true })
    const msg = await interaction.editReply({ embeds: [embed], components: rows as any[] });
    await this.persistContexts(msg.id, msg.channelId, state);
  }

  // ─── Component interactions (button, select, modal) ──────────────────────────
  public async handlerForm(interaction: AnyFormInteraction, data: InteractionData): Promise<void> {
    const state: AutoMessageState = {
      step: (data as any)?.step ?? 'list',
      editingId: (data as any)?.editingId ?? null,
    };

    try {
      if (interaction.isModalSubmit()) {
        await this.handleModalSubmit(interaction as ModalSubmitInteraction, state);
        return;
      }

      const cid = (interaction as ButtonInteraction).customId;

      // BTN_MSG opens a modal — showModal() IS the ack, skip deferUpdate
      if (cid !== AM_IDS.BTN_MSG) {
        if (!(interaction as ButtonInteraction).replied && !(interaction as ButtonInteraction).deferred) {
          await (interaction as ButtonInteraction).deferUpdate();
        }
      }

      switch (cid) {
        // ── List view ──────────────────────────────────────────────────────────

        case AM_IDS.SELECT_MSG: {
          const id = (interaction as StringSelectMenuInteraction).values[0];
          const cfg = this.findMessage(id);
          if (!cfg) break;
          state.step = 'edit';
          state.editingId = id;
          await this.renderEdit(interaction, cfg, state);
          break;
        }

        case AM_IDS.BTN_NEW: {
          const cfg = this.createMessage();
          state.step = 'edit';
          state.editingId = cfg.id;
          await this.renderEdit(interaction, cfg, state);
          break;
        }

        case AM_IDS.BTN_CLOSE: {
          if ((interaction as ButtonInteraction).replied || (interaction as ButtonInteraction).deferred) {
            await (interaction as ButtonInteraction).message?.edit({ content: '✅ Fermé.', embeds: [], components: [] });
          } else {
            await (interaction as ButtonInteraction).update({ content: '✅ Fermé.', embeds: [], components: [] });
          }
          const em = this.bot.db.getEm();
          await em.nativeDelete(InteractionContext, {
            messageId: (interaction as ButtonInteraction).message.id,
          });
          break;
        }

        // ── Edit view ──────────────────────────────────────────────────────────

        case AM_IDS.SELECT_CHANNEL: {
          const channelId = (interaction as ChannelSelectMenuInteraction).values[0];
          await this.patchAndRender(interaction, state, cfg => { cfg.channelId = channelId; });
          break;
        }

        case AM_IDS.SELECT_DAY: {
          const day = parseInt((interaction as StringSelectMenuInteraction).values[0], 10);
          await this.patchAndRender(interaction, state, cfg => { cfg.dayOfWeek = day; });
          break;
        }

        case AM_IDS.SELECT_HOUR: {
          const hour = parseInt((interaction as StringSelectMenuInteraction).values[0], 10);
          await this.patchAndRender(interaction, state, cfg => { cfg.hour = hour; });
          break;
        }

        case AM_IDS.SELECT_MINUTE: {
          const minute = parseInt((interaction as StringSelectMenuInteraction).values[0], 10);
          await this.patchAndRender(interaction, state, cfg => { cfg.minute = minute; });
          break;
        }

        case AM_IDS.BTN_MSG: {
          if (!state.editingId) {
            await (interaction as ButtonInteraction).deferUpdate();
            break;
          }
          const cfg = this.findMessage(state.editingId);
          if (!cfg) { await (interaction as ButtonInteraction).deferUpdate(); break; }
          // Persist modal context BEFORE showing modal (uses same messageId)
          await this.persistContexts(
            (interaction as ButtonInteraction).message.id,
            interaction.channelId,
            state,
            [AM_IDS.MODAL_MSG]
          );
          await (interaction as ButtonInteraction).showModal(AutoMessageView.buildMessageModal(cfg));
          break;
        }

        case AM_IDS.BTN_TOGGLE: {
          await this.patchAndRender(interaction, state, cfg => { cfg.enabled = !cfg.enabled; });
          break;
        }

        case AM_IDS.BTN_DELETE: {
          if (!state.editingId) break;
          const messages = this.loadMessages();
          const filtered = messages.filter(m => m.id !== state.editingId);
          this.saveMessages(filtered);
          state.step = 'edit';
          state.editingId = null;
          await this.renderList(interaction, state);
          break;
        }

        case AM_IDS.BTN_BACK: {
          state.step = 'list';
          state.editingId = null;
          await this.renderList(interaction, state);
          break;
        }

        case AM_IDS.BTN_PREVIEW: {
          if (!state.editingId) break;
          const cfg = this.findMessage(state.editingId);
          if (!cfg) break;

          const hasContent = !!cfg.message?.trim() || !!cfg.embed || !!cfg.buttons?.length;
          if (!hasContent) {
            await (interaction as ButtonInteraction).followUp({ content: '⚠️ Rien à prévisualiser : aucun texte, embed ni boutons configurés.', ephemeral: true });
            break;
          }

          const previewPayload: Record<string, unknown> = {};
          if (cfg.message?.trim()) previewPayload.content = cfg.message;
          if (cfg.embed || cfg.buttons?.length) {
            previewPayload.embeds = [await buildLiveEmbed(cfg, {}, this.bot) as any];
          }
          const btnRows = buildButtonRow(cfg);
          if (btnRows.length) previewPayload.components = btnRows as any[];

          await (interaction as ButtonInteraction).followUp({ ...previewPayload as any, ephemeral: true });
          break;
        }
      }
    } catch (err) {
      this.logger.error({ msg: 'AutoMessageManager.handlerForm error', err });
    }
  }

  // ─── RSVP response handler ───────────────────────────────────────────────────
  public async handlerResponse(interaction: ButtonInteraction, data: InteractionData): Promise<void> {
    const configId = (data as any)?.configId as string;
    if (!configId) return;

    const cfg = this.findMessage(configId);
    if (!cfg?.buttons?.length) return;

    const allResponses = this.loadResponses();
    const responses: ResponseMap = allResponses[configId] ?? {};

    // Exclusive selection: remove user from all buttons, then toggle the clicked one
    const userId = interaction.user.id;
    const wasPresent = (responses[interaction.customId] ?? []).includes(userId);
    for (const btn of cfg.buttons) {
      responses[btn.customId] = (responses[btn.customId] ?? []).filter(id => id !== userId);
    }
    if (!wasPresent) {
      responses[interaction.customId] = [...(responses[interaction.customId] ?? []), userId];
    }

    allResponses[configId] = responses;
    this.saveResponses(allResponses);

    const embed = await buildLiveEmbed(cfg, responses, this.bot);
    const btnRows = buildButtonRow(cfg);
    await interaction.update({ embeds: [embed as any], components: btnRows as any[] });
  }

  // ─── Modal submit ────────────────────────────────────────────────────────────
  private async handleModalSubmit(interaction: ModalSubmitInteraction, state: AutoMessageState): Promise<void> {
    // deferUpdate inherits the component context → editReply updates the ephemeral message
    await interaction.deferUpdate();

    const label        = interaction.fields.getTextInputValue('am_input_label').trim();
    const message      = interaction.fields.getTextInputValue('am_input_message').trim();
    const embedInput   = interaction.fields.getTextInputValue('am_input_embed').trim();
    const buttonsInput = interaction.fields.getTextInputValue('am_input_buttons').trim();
    const threadInput  = interaction.fields.getTextInputValue('am_input_thread').trim();

    // Embed JSON validation
    let embed: string | null = null;
    let warning: string | undefined;
    if (embedInput) {
      try {
        JSON.parse(embedInput);
        embed = embedInput;
      } catch {
        warning = 'Le JSON de l\'embed est invalide et a été ignoré. Vérifiez la syntaxe.';
        this.logger.warn(`AutoMessageManager: embed JSON invalide pour "${label}"`);
      }
    }

    // Parse RSVP buttons — accepts JSON array or `label|style` lines (one per line or comma-separated)
    const buttons = buttonsInput ? this.parseButtons(buttonsInput, state.editingId ?? '') : null;

    if (!state.editingId) return;

    const messages = this.loadMessages();
    const cfg = messages.find(m => m.id === state.editingId);
    if (!cfg) return;

    cfg.label         = label;
    cfg.message       = message;
    cfg.embed         = embed;
    cfg.buttons       = buttons?.length ? buttons : null;
    cfg.threadMessage = threadInput || null;
    cfg.updatedAt     = new Date().toISOString();
    this.saveMessages(messages);

    const { embed: viewEmbed, rows } = AutoMessageView.buildEditView(cfg, warning);
    const msg = await interaction.editReply({ embeds: [viewEmbed], components: rows as any[] });
    await this.persistContexts(msg.id, msg.channelId, state);
  }

  // ─── Render helpers ──────────────────────────────────────────────────────────
  private async renderList(interaction: AnyFormInteraction, state: AutoMessageState): Promise<void> {
    const messages = this.loadMessages();
    const { embed, rows } = AutoMessageView.buildListView(messages);
    const msg = await (interaction as ButtonInteraction).editReply({ embeds: [embed], components: rows as any[] });
    await this.persistContexts(msg.id, msg.channelId, state);
  }

  private async renderEdit(
    interaction: AnyFormInteraction,
    cfg: ScheduledMessageConfig,
    state: AutoMessageState
  ): Promise<void> {
    const { embed, rows } = AutoMessageView.buildEditView(cfg);
    const msg = await (interaction as ButtonInteraction).editReply({ embeds: [embed], components: rows as any[] });
    await this.persistContexts(msg.id, msg.channelId, state);
  }

  private async patchAndRender(
    interaction: AnyFormInteraction,
    state: AutoMessageState,
    patch: (cfg: ScheduledMessageConfig) => void
  ): Promise<void> {
    if (!state.editingId) return;
    const messages = this.loadMessages();
    const cfg = messages.find(m => m.id === state.editingId);
    if (!cfg) return;
    patch(cfg);
    cfg.updatedAt = new Date().toISOString();
    this.saveMessages(messages);
    await this.renderEdit(interaction, cfg, state);
  }

  // ─── DB context persistence ──────────────────────────────────────────────────
  private async persistContexts(
    messageId: string,
    channelId: string,
    state: AutoMessageState,
    customIds: string[] = ALL_AM_IDS,
  ): Promise<void> {
    const em = this.bot.db.getEm();
    const data = state as unknown as Record<string, unknown>;

    for (const customId of customIds) {
      const existing = await em.findOne(InteractionContext, {
        messageId, channelId, customId,
        handlerKey: ViewHandlers.AutoMessageHandler,
      });
      if (existing) {
        existing.data = data;
        em.persist(existing);
      } else {
        em.persist(em.create(InteractionContext, {
          messageId, channelId, customId,
          handlerKey: ViewHandlers.AutoMessageHandler,
          componentType: ComponentType.Button,
          data,
        }));
      }
    }
    await em.flush();
  }

  // ─── Config file ─────────────────────────────────────────────────────────────
  private ensureConfigDir(): void {
    const dir = path.dirname(CFG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(CFG_PATH)) fs.writeFileSync(CFG_PATH, '[]');
  }

  private loadMessages(): ScheduledMessageConfig[] {
    this.ensureConfigDir();
    try {
      return JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')) as ScheduledMessageConfig[];
    } catch {
      return [];
    }
  }

  private saveMessages(messages: ScheduledMessageConfig[]): void {
    this.ensureConfigDir();
    fs.writeFileSync(CFG_PATH, JSON.stringify(messages, null, 2));
  }

  private parseButtons(input: string, configId: string): ScheduledMessageConfig['buttons'] {
    type BtnStyle = 'Success' | 'Danger' | 'Primary' | 'Secondary';
    const VALID_STYLES = new Set<string>(['Success', 'Danger', 'Primary', 'Secondary']);
    const AUTO_STYLES: BtnStyle[] = ['Success', 'Danger', 'Primary', 'Secondary'];

    // Try JSON array first
    const trimmed = input.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as Array<{ label: string; style?: string }>;
        if (Array.isArray(parsed)) {
          return parsed
            .map((b, i) => ({
              customId: `am_resp_${configId}_${i}`,
              label: String(b.label ?? '').trim().slice(0, 80),
              style: (VALID_STYLES.has(b.style ?? '') ? b.style : AUTO_STYLES[Math.min(i, 3)]) as BtnStyle,
            }))
            .filter(b => b.label.length > 0);
        }
      } catch {
        this.logger.warn(`AutoMessageManager: boutons JSON invalide pour "${configId}"`);
        return null;
      }
    }

    // Simple format: `label|style` per line (or comma-separated)
    const separator = trimmed.includes('\n') ? '\n' : ',';
    return trimmed
      .split(separator)
      .map((raw, i) => {
        const [labelPart, stylePart] = raw.split('|').map(s => s.trim());
        const label = (labelPart ?? '').slice(0, 80);
        const style: BtnStyle = VALID_STYLES.has(stylePart ?? '')
          ? (stylePart as BtnStyle)
          : AUTO_STYLES[Math.min(i, 3)];
        return { customId: `am_resp_${configId}_${i}`, label, style };
      })
      .filter(b => b.label.length > 0);
  }

  private loadResponses(): Record<string, ResponseMap> {
    try {
      if (!fs.existsSync(RESPONSES_PATH)) return {};
      return JSON.parse(fs.readFileSync(RESPONSES_PATH, 'utf8')) as Record<string, ResponseMap>;
    } catch { return {}; }
  }

  private saveResponses(data: Record<string, ResponseMap>): void {
    this.ensureConfigDir();
    fs.writeFileSync(RESPONSES_PATH, JSON.stringify(data, null, 2));
  }

  private findMessage(id: string): ScheduledMessageConfig | undefined {
    return this.loadMessages().find(m => m.id === id);
  }

  private createMessage(): ScheduledMessageConfig {
    const cfg: ScheduledMessageConfig = {
      id: `msg_${Date.now()}`,
      label: 'Nouveau message',
      enabled: false,
      channelId: null,
      message: '📢 Message automatique.',
      embed: null,
      buttons: null,
      threadMessage: null,
      lastSentMessageId: null,
      lastSentChannelId: null,
      dayOfWeek: 5,
      hour: 12,
      minute: 0,
      timezone: 'Europe/Paris',
      lastRunKey: null,
      lastRunAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    const messages = this.loadMessages();
    messages.push(cfg);
    this.saveMessages(messages);
    return cfg;
  }
}
