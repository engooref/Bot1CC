// src/utils/ComponentHandlerRegistry.ts
import { Interaction} from 'discord.js';
import type { InteractionData } from '../types/interaction.js';

/**
 * Type générique pour gérer interactions de composants (bouton ou select)
 */
export type ComponentHandler = (
  interaction: Interaction,
  data: InteractionData,
) => Promise<void>;

class ComponentHandlerRegistry {
  private handlers: Map<string, ComponentHandler> = new Map();

  /**
   * Enregistre un handler sous une clé unique
   */
  public register(key: string, fn: ComponentHandler) {
    if (this.handlers.has(key)) {
      throw new Error(`Handler déjà enregistré pour la clé ${key}`);
    }
    this.handlers.set(key, fn);
  }

  /**
   * Récupère le handler associé à une clé, ou `undefined`
   */
  public get(key: string): ComponentHandler | undefined {
    return this.handlers.get(key);
  }
}

export const componentHandlerRegistry = new ComponentHandlerRegistry();
