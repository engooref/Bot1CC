/**
 * Utilitaires partagés entre SchedulerMessage (envoi) et AutoMessageManager (handler réponses).
 * Séparé pour éviter les imports circulaires.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { ScheduledMessageConfig } from '../managers/schedulers/ScheduledMessage.js';
import { BotManager } from '../BotManager.js';

const STYLE_MAP: Record<string, ButtonStyle> = {
  Success:   ButtonStyle.Success,
  Danger:    ButtonStyle.Danger,
  Primary:   ButtonStyle.Primary,
  Secondary: ButtonStyle.Secondary,
};

/** responseMap : buttonCustomId → tableau de userId Discord */
export type ResponseMap = Record<string, string[]>;

/**
 * Construit l'objet embed Discord (APIEmbed) en fusionnant le JSON de base
 * et les colonnes de réponses dynamiques (ajoutées en fin de fields).
 * Si cfg.embed est null, crée un embed minimaliste avec le label.
 */
export async function buildLiveEmbed(cfg: ScheduledMessageConfig, responses: ResponseMap = {}, bot: BotManager): Promise<object> {
  let base: Record<string, unknown>;
  try {
    base = cfg.embed ? (JSON.parse(cfg.embed) as Record<string, unknown>) : {};
  } catch {
    base = {};
  }

  if (!base.title && !base.description) base.title = cfg.label;
  if (!base.color) base.color = 0x5865f2;

  if (!cfg.buttons?.length) return base;

  const responseFields = await Promise.all(cfg.buttons.map(async btn => {
    const userIds = responses[btn.customId] ?? [];
    const names = await Promise.all(
      userIds.map(async id => {
        try {
          const member = await bot.guild.members.fetch(id);
          return member.displayName;
        } catch {
          return 'Utilisateur inconnu';
        }
      })
    );
    return {
      name:   `${btn.label} (${names.length})`,
      value:  names.length > 0 ? names.join('\n') : '—',
      inline: true,
    };
  }));

  return {
    ...base,
    fields:    [...((base.fields as unknown[]) ?? []), ...responseFields],
    timestamp: new Date().toISOString(),
  };
}

/** Construit la ligne de boutons Discord à attacher au message. */
export function buildButtonRow(cfg: ScheduledMessageConfig): ActionRowBuilder<ButtonBuilder>[] {
  if (!cfg.buttons?.length) return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      cfg.buttons.map(btn =>
        new ButtonBuilder()
          .setCustomId(btn.customId)
          .setLabel(btn.label)
          .setStyle(STYLE_MAP[btn.style] ?? ButtonStyle.Primary)
      )
    ),
  ];
}
