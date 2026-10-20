import type { SettingKey } from '../constants/SettingKeys.js';
import { 
    EntityClass,
    EntityKey,
    EntityManager
 } from "@mikro-orm/core";

type SettingsData = Record<string, unknown>;

interface SettingsCache {
  data: SettingsData;
  loadedAt: number;
}

export class SettingsService {
  private readonly baseUrl: string;
  private readonly botToken: string;

  /**
   * Durée du cache en millisecondes.
   * Par défaut : 5 minutes.
   */
  private readonly cacheTtlMs: number;

  private cache: SettingsCache | null = null;

  /**
   * Permet d'éviter plusieurs fetch simultanés
   * si plusieurs parties du bot demandent les paramètres
   * au même moment.
   */
  private loadingPromise: Promise<SettingsData> | null = null;

  constructor(cacheTtlMs: number = 5 * 60 * 1000) {
    const baseUrl = process.env.URL_SITE;
    const botToken = process.env.BOT_TOKEN;

    if (!baseUrl) {
      throw new Error(
        "[SettingsService] La variable d'environnement URL_SITE est manquante."
      );
    }

    if (!botToken) {
      throw new Error(
        "[SettingsService] La variable d'environnement BOT_TOKEN est manquante."
      );
    }

    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.botToken = botToken;
    this.cacheTtlMs = cacheTtlMs;
  }

  /**
   * Charge les paramètres depuis le site.
   *
   * Si le cache est encore valide, il est utilisé.
   * Utiliser force = true pour forcer un rechargement.
   */
  public async load(force: boolean = false): Promise<SettingsData> {
    if (!force && this.isCacheValid()) {
      return this.cache!.data;
    }

    /**
     * Si un chargement est déjà en cours,
     * on retourne la même Promise.
     */
    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = this.fetchSettings();

    try {
      return await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }

  /**
   * Force le rechargement depuis le site.
   */
  public async reload(): Promise<SettingsData> {
    return this.load(true);
  }

  /**
   * Récupère une valeur.
   *
   * Exemple :
   * settings.get(SettingKeys.bot.roles.postulant)
   */
  public async get<T = unknown>(
    key: SettingKey,
    defaultValue?: T
  ): Promise<T | undefined> {
    const settings = await this.load();

    const value = settings[key];

    if (value === undefined || value === null) {
      return defaultValue;
    }

    return value as T;
  }

  /**
   * Récupère une string.
   */
  public async getString(
    key: SettingKey,
    defaultValue: string = ""
  ): Promise<string> {
    const value = await this.get<unknown>(key);

    if (value === undefined || value === null) {
      return defaultValue;
    }

    return String(value);
  }

  /**
   * Récupère un entier.
   */
  public async getInt(
    key: SettingKey,
    defaultValue: number = 0
  ): Promise<number> {
    const value = await this.get<unknown>(key);

    if (value === undefined || value === null) {
      return defaultValue;
    }

    const parsed = Number.parseInt(String(value), 10);

    return Number.isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Récupère un nombre décimal.
   */
  public async getFloat(
    key: SettingKey,
    defaultValue: number = 0
  ): Promise<number> {
    const value = await this.get<unknown>(key);

    if (value === undefined || value === null) {
      return defaultValue;
    }

    const parsed = Number.parseFloat(String(value));

    return Number.isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Récupère un booléen.
   */
  public async getBool(
    key: SettingKey,
    defaultValue: boolean = false
  ): Promise<boolean> {
    const value = await this.get<unknown>(key);

    if (value === undefined || value === null) {
      return defaultValue;
    }

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number") {
      return value !== 0;
    }

    if (typeof value === "string") {
      switch (value.toLowerCase().trim()) {
        case "true":
        case "1":
        case "yes":
        case "on":
          return true;

        case "false":
        case "0":
        case "no":
        case "off":
          return false;
      }
    }

    return defaultValue;
  }

  /** Lit une sélection multiple sans convertir ni tronquer les IDs Discord. */
  public async getList(key: SettingKey): Promise<string[]> {
    const value = await this.get<unknown>(key);
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || !value.every(item => typeof item === "string")) {
      throw new Error(`[SettingsService] ${key} doit être un tableau de chaînes.`);
    }
    return [...new Set(value)];
  }

  public async getEntity<T extends object>(
    settingKey: SettingKey,
    entityClass: EntityClass<T>,
    property: EntityKey<T>,
    em: EntityManager
  ): Promise<T | null> {
    const value = await this.get<unknown>(settingKey);

    if (value === undefined || value === null || value === "") {
      return null;
    }

    return em.findOne(entityClass, {
      [property]: value,
    } as any);
  }

  /**
   * Indique si un paramètre existe.
   */
  public async has(key: SettingKey): Promise<boolean> {
    const settings = await this.load();

    return settings[key] !== undefined;
  }

  /**
   * Retourne tous les paramètres actuellement en cache.
   *
   * Charge les paramètres si nécessaire.
   */
  public async getAll(): Promise<SettingsData> {
    return this.load();
  }

  /**
   * Supprime le cache local.
   *
   * Aucun appel HTTP n'est effectué ici.
   */
  public clearCache(): void {
    this.cache = null;
  }

  /**
   * Retourne true si le cache est encore valide.
   */
  public isCacheValid(): boolean {
    if (!this.cache) {
      return false;
    }

    return Date.now() - this.cache.loadedAt < this.cacheTtlMs;
  }

  /**
   * Retourne l'âge actuel du cache en millisecondes.
   */
  public getCacheAge(): number | null {
    if (!this.cache) {
      return null;
    }

    return Date.now() - this.cache.loadedAt;
  }
  

  /**
   * Effectue réellement la requête HTTP.
   */
  private async fetchSettings(): Promise<SettingsData> {
    const url = `${this.baseUrl}/api/internal/bot/settings`;

    try {
      const response = await fetch(url, {
        method: "GET",

        headers: {
          Accept: "application/json",
          "X-BOT-TOKEN": this.botToken,
        },

        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} ${response.statusText}`
        );
      }

      const data = (await response.json()) as unknown;

      if (!this.isValidSettingsData(data)) {
        throw new Error(
          "La réponse de l'API des paramètres est invalide."
        );
      }

      this.cache = {
        data,
        loadedAt: Date.now(),
      };

      return data;
    } catch (error) {
      /**
       * Si le site ne répond plus mais qu'on possède déjà
       * un ancien cache, on préfère continuer avec celui-ci
       * plutôt que faire planter le bot.
       */
      if (this.cache) {
        console.warn(
          "[SettingsService] Impossible de récupérer les paramètres. Utilisation du cache existant.",
          error
        );

        return this.cache.data;
      }

      throw new Error(
        `[SettingsService] Impossible de récupérer les paramètres depuis ${url}.`
      );
    }
  }

  /**
   * Validation minimale de la réponse API.
   */
  private isValidSettingsData(
    data: unknown
  ): data is SettingsData {
    return (
      data !== null &&
      typeof data === "object" &&
      !Array.isArray(data)
    );
  }
}

/**
 * Instance globale utilisée par le bot.
 */
export const settingsService = new SettingsService();