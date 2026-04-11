import type { Interaction } from 'discord.js';

export type InteractionData = Record<string, unknown>;

export type ComponentHandlerFn = (
  interaction: Interaction,
  data: InteractionData,
) => Promise<void>;
