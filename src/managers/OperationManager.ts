// src/managers/OperationManager.ts
import {
  ChannelType,
  PermissionFlagsBits,
  CategoryChannel,
  TextChannel,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  TextBasedChannel,
  Message,
  AttachmentBuilder,
  EmbedBuilder,
  Colors,
} from 'discord.js';

/** Interactions possibles dans handlerForm — exclut ChatInputCommandInteraction (pas de customId) */
type FormInteraction = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;
import type { PendingLink } from '../types/operation.js';
import type { InteractionData } from '../types/interaction.js';
import fs from 'fs';
import path from 'path';
import { BotManager } from '../BotManager.js';
import { CreationOperationView, OperationState, OperationView } from '../view/OperationView.js';
import { JSONConfigManager } from '../utils/JSONConfigManager.js';
import { getManagerLogger } from '../logger.js';
import { StarSystem } from '../entities/operations/StarSystem.js';
import { CelestialBody, CelestialBodyType } from '../entities/operations/CelestialBody.js';
import { TempLink } from '../entities/operations/TempLink.js';
import { OperationRoleManager } from './OperationRoleManager.js';
import { MiningSession } from '../entities/mining/MiningSession.js';

const CATEGORY_NAME = 'Opérations';
const FOLDER_NAME = "Operations";
const BASE = path.resolve('config');
const PENDING_LINKS_PATH = path.join(BASE, 'pendingLinks.json');
const MAX_START_DELAY_MINUTES = 24 * 60;
const PENDING_LINK_RETRY_INTERVAL_MS = 15 * 60 * 1000;

interface OperationAuthor {
  id: string;
  username: string;
  displayName: string;
}

export interface WebOperationCreateInput extends OperationState {
  userId: string;
}

export interface OperationCreateResult {
  messageId: string;
  channelId: string;
  threadId: string;
  jumpUrl: string;
  startAt: string;
  tempUrl: string | null;
  tempUrlExpiresAt: string | null;
  roleId: string;
  roleName: string;
  typeSpe: string | null;
  autoCreated: boolean;
  miningSessionUrl: string | null;
}

export class OperationModule {
  public roleConfig: JSONConfigManager<Record<string,string>>;
  public gameConfig: JSONConfigManager<Record<string,string>>;
  public opeConfig: JSONConfigManager<Record<string,string>>;
  public roleManager: OperationRoleManager;
  private creationView: CreationOperationView;
  private fcategory: CategoryChannel | undefined;
  private pendingLinkTimers = new Map<string, NodeJS.Timeout>();
  private logger = getManagerLogger('OperationModule');

  constructor(private bot: BotManager) {
    this.roleConfig = new JSONConfigManager<Record<string,string>>(path.join(BASE, 'roles.json'));
    this.gameConfig = new JSONConfigManager<Record<string,string>>(path.join(BASE, 'games.json'));
    this.opeConfig = new JSONConfigManager<Record<string,string>>(path.join(BASE, 'typeOp.json'));

    this.roleManager = new OperationRoleManager(bot, this);
    this.creationView = new CreationOperationView(bot);

    this.roleConfig.on('change', () => this.roleManager.updateRoles());
    this.bot.excludeCategory.push(CATEGORY_NAME);
  }

  public async init(): Promise<void> {
    await this.logger.debug('Initialisation des opérations');
    const channel = await this.ensureCreationChannel();
    const fetched = await channel.messages.fetch({ limit: 50 });
    const existing = fetched.find(m => m.author.id === this.bot.user!.id && m.components.length > 0) || null;
    await this.creationView.render(channel, existing);

    await this.roleManager.updateRoles();
    this.roleConfig.watch();
    this.gameConfig.watch();
    this.opeConfig.watch();

    await this.ensureCreationOperationsChannels();
    this.resumePendingLinks();
  }

  public async ensureCategory(): Promise<CategoryChannel> {
    if (!this.fcategory) {
      const guild = this.bot.guild;
      this.fcategory = guild.channels.cache.find(
        c => c.type === ChannelType.GuildCategory && c.name === CATEGORY_NAME
      ) as CategoryChannel | undefined;

      if (!this.fcategory) {
        this.fcategory = await guild.channels.create({
          name: CATEGORY_NAME,
          type: ChannelType.GuildCategory,
          permissionOverwrites: [{
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
          },
          {
            id: this.bot.roleMember!.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
          }],
        });
      }
    }

    return this.fcategory;
  }


  /** Crée ou récupère la catégorie "Opérations" et le salon "création-opération" */
  private async ensureCreationChannel(): Promise<TextChannel> {
    const guild = this.bot.guild;
    const category = await this.ensureCategory();

    // Salon création-opération
    let creationChannel = guild.channels.cache.find(
      c =>
        c.parentId === category.id &&
        c.type === ChannelType.GuildText &&
        c.name === 'création-opération'
    ) as TextChannel;
    if (!creationChannel) {
      creationChannel = await guild.channels.create({
        name: 'création-opération',
        type: ChannelType.GuildText,
        parent: category.id,
      });
    }
    return creationChannel;
  }

  private async ensureCreationOperationsChannels(): Promise<void> {
    const category = await this.ensureCategory();
    const guild = this.bot.guild;

    for (const [key, val] of Object.entries(this.roleConfig.getAll())) {
      const role = guild.roles.cache.get(val);
      if(!role) continue;

      const channel = guild.channels.cache.find(
        c =>
          c.parentId === category.id &&
          c.type === ChannelType.GuildText &&
          c.name === role.name.replace(' ', '-').toLowerCase()
      ) as TextChannel;
      if (!channel) {
        await guild.channels.create({
          name: role.name.replace(' ', '-').toLowerCase(),
          type: ChannelType.GuildText,
          parent: category.id,
        });
      }
    }
  }

  private normalizeOptionalString(value: unknown): string | undefined {
    const normalized = String(value ?? '').trim();
    return normalized || undefined;
  }

  private normalizeOperationState(state: OperationState): OperationState {
    return {
      type: this.normalizeOptionalString(state.type),
      startAt: this.normalizeOptionalString(state.startAt),
      location: this.normalizeOptionalString(state.location) ?? '0.0.0',
      games: this.normalizeOptionalString(state.games),
      description: this.normalizeOptionalString(state.description),
      equip: this.normalizeOptionalString(state.equip),
      reward: this.normalizeOptionalString(state.reward),
      url: this.normalizeOptionalString(state.url),
      miningSessionUrl: this.normalizeOptionalString(state.miningSessionUrl),
      typeSpe: this.normalizeOptionalString(state.typeSpe),
      autoCreated: state.autoCreated === true,
    };
  }

  private async assertValidLocation(location: string): Promise<void> {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(location);
    if (!match) {
      throw new Error('location invalide, format attendu: etoile.planete.lune');
    }

    const [starId, planetId, moonId] = match.slice(1).map((value) => Number.parseInt(value, 10));
    if (starId === 0) {
      throw new Error('location invalide, une étoile est requise');
    }
    if (planetId === 0 && moonId !== 0) {
      throw new Error('location invalide, une lune nécessite une planète');
    }

    const em = this.bot.db.getEm();
    const star = await em.findOne(StarSystem, { id: starId });
    if (!star) {
      throw new Error('étoile invalide');
    }

    if (planetId === 0) {
      return;
    }

    const planet = await em.findOne(CelestialBody, {
      id: planetId,
      system: star,
      parent: null,
      type: CelestialBodyType.PLANET,
    });
    if (!planet) {
      throw new Error('planète invalide pour cette étoile');
    }

    if (moonId === 0) {
      return;
    }

    const moon = await em.findOne(CelestialBody, {
      id: moonId,
      system: star,
      parent: planet,
      type: CelestialBodyType.MOON,
    });
    if (!moon) {
      throw new Error('lune invalide pour cette planète');
    }
  }

  private async validateOperationState(state: OperationState): Promise<OperationState> {
    const normalized = this.normalizeOperationState(state);
    const roleIds = Object.values(this.roleConfig.getAll());
    const gameRoleId = this.roleConfig.get('🎮');

    if (!normalized.type) {
      throw new Error('type manquant');
    }
    if (!roleIds.includes(normalized.type)) {
      throw new Error('type invalide');
    }

    if (!normalized.startAt) {
      throw new Error('date/heure de départ manquante');
    }

    if (!normalized.description) {
      throw new Error('description manquante');
    }
    if (normalized.description.length > 200) {
      throw new Error('description trop longue (200 caractères max)');
    }

    const operationTypes = this.opeConfig.get(normalized.type) as Record<string, string> | undefined;
    const typeSpe = normalized.typeSpe ?? 'GE';
    if (operationTypes) {
      if (typeSpe !== 'GE' && !operationTypes[typeSpe]) {
        throw new Error('typeSpe invalide pour ce type');
      }
      normalized.typeSpe = typeSpe;
    } else if (typeSpe !== 'GE') {
      throw new Error('typeSpe non autorisé pour ce type');
    } else {
      delete normalized.typeSpe;
    }

    if (normalized.type === gameRoleId) {
      if (!normalized.games) {
        throw new Error('games manquant pour une opération multigaming');
      }
      if (!this.gameConfig.get(normalized.games)) {
        throw new Error('games invalide');
      }
      normalized.location = '0.0.0';
      delete normalized.equip;
      delete normalized.reward;
    } else {
      await this.assertValidLocation(normalized.location);
      delete normalized.games;
    }

    return normalized;
  }

  private async getOperationAuthor(discordId: string): Promise<OperationAuthor> {
    const member = await this.bot.guild.members.fetch(discordId);
    return {
      id: member.id,
      username: member.user.username,
      displayName: member.displayName,
    };
  }

  private parseCustomStartAt(value: string): Date | null {
    const frMatch = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/.exec(value);
    if (frMatch) {
      const [, day, month, year, hour, minute] = frMatch;
      const date = new Date(
        Number.parseInt(year, 10),
        Number.parseInt(month, 10) - 1,
        Number.parseInt(day, 10),
        Number.parseInt(hour, 10),
        Number.parseInt(minute, 10),
        0,
        0,
      );

      const valid = date.getFullYear() === Number.parseInt(year, 10)
        && date.getMonth() === (Number.parseInt(month, 10) - 1)
        && date.getDate() === Number.parseInt(day, 10)
        && date.getHours() === Number.parseInt(hour, 10)
        && date.getMinutes() === Number.parseInt(minute, 10);

      return valid ? date : null;
    }

    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value);
    if (isoMatch) {
      const [, year, month, day, hour, minute] = isoMatch;
      const date = new Date(
        Number.parseInt(year, 10),
        Number.parseInt(month, 10) - 1,
        Number.parseInt(day, 10),
        Number.parseInt(hour, 10),
        Number.parseInt(minute, 10),
        0,
        0,
      );

      const valid = date.getFullYear() === Number.parseInt(year, 10)
        && date.getMonth() === (Number.parseInt(month, 10) - 1)
        && date.getDate() === Number.parseInt(day, 10)
        && date.getHours() === Number.parseInt(hour, 10)
        && date.getMinutes() === Number.parseInt(minute, 10);

      return valid ? date : null;
    }

    return null;
  }

  private resolveOperationStartDate(state: OperationState): Date {
    const now = Date.now();

    const rawStartAt = String(state.startAt ?? '').trim();
    const parsed = this.parseCustomStartAt(rawStartAt);
    if (!parsed) {
      throw new Error('date/heure invalide, formats attendus: JJ/MM/AAAA HH:mm ou YYYY-MM-DD HH:mm');
    }
    let startDate = parsed;

    // Si l'heure saisie est déjà passée, on bascule en départ immédiat.
    if (startDate.getTime() < now) {
      startDate = new Date(now);
    }

    const startAt = startDate.getTime();
    const maxStartAt = now + MAX_START_DELAY_MINUTES * 60_000;

    if (startAt > maxStartAt) {
      throw new Error('date/heure de départ trop éloignée (maximum 24h)');
    }

    return startDate;
  }

  private formatStartAt(date: Date): string {
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  private normalizeHttpUrl(value: string | null | undefined): string | null {
    const raw = String(value ?? '').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }
      return parsed.toString();
    } catch {
      return null;
    }
  }

  private resolveOperationVisualPath(state: OperationState, roleName: string): string | null {
    const baseDir = path.join('Data', FOLDER_NAME);

    if (state.type === this.bot.operationManager.roleConfig.get('🎮') && state.games) {
      const mgPng = path.join(baseDir, 'MG', `${state.games}.png`);
      if (fs.existsSync(mgPng)) {
        return mgPng;
      }
    }

    if (state.typeSpe && state.typeSpe !== 'GE') {
      const mpPng = path.join(baseDir, 'MP', `${state.typeSpe}.png`);
      if (fs.existsSync(mpPng)) {
        return mpPng;
      }
    }

    const rootPng = path.join(baseDir, `${roleName}.png`);
    if (fs.existsSync(rootPng)) {
      return rootPng;
    }

    return null;
  }

  private async createOperationForAuthor(
    author: OperationAuthor,
    state: OperationState,
  ): Promise<OperationCreateResult> {
    const validatedState = await this.validateOperationState(state);
    const role = this.bot.guild.roles.cache.get(validatedState.type!);
    if (!role) {
      throw new Error('role introuvable');
    }

    const futureDate = this.resolveOperationStartDate(validatedState);
    const startTimestamp = Math.floor(futureDate.getTime() / 1000);

    const [starId, planetId, moonId] = validatedState.location.split('.').map((n: string) => parseInt(n, 10));
    const names: string[] = [];
    if (starId > 0) {
      const star = await this.bot.db.getEm().findOne(StarSystem, { id: starId });
      if (star) {
        names.push(star.name);
      }
    }
    if (planetId > 0) {
      const planet = await this.bot.db.getEm().findOne(CelestialBody, { id: planetId });
      if (planet) {
        names.push(planet.name);
      }
    }
    if (moonId > 0) {
      const moon = await this.bot.db.getEm().findOne(CelestialBody, { id: moonId });
      if (moon) {
        names.push(moon.name);
      }
    }

    const locationText = names.length > 0 ? names.join(' > ') : 'Non renseignee';
    const subtitle = locationText !== 'Non renseignee' ? ` - ${locationText}` : '';

    const embed = new EmbedBuilder()
      .setColor(role.color || Colors.Blue)
      .setTitle(`${role.name}${subtitle}`)
      .setDescription(
        `> ${validatedState.description ?? 'Aucune description fournie.'}\n\n` +
        `Preparez votre equipement et confirmez votre presence avant le depart.`
      )
      .addFields(
        { name: '🕒 Depart', value: `<t:${startTimestamp}:F>\n<t:${startTimestamp}:R>`, inline: true },
        { name: '👤 Responsable', value: `<@${author.id}>`, inline: true },
      )
      .setFooter({ text: 'Interstellar Companion | 1er Corps Colonial' })
      .setTimestamp(futureDate);

    if (validatedState.typeSpe && validatedState.typeSpe !== 'GE') {
      embed.addFields({ name: '🧭 Specialisation', value: validatedState.typeSpe, inline: true });
    }

    if (validatedState.type === this.bot.operationManager.roleConfig.get('🎮') && validatedState.games) {
      embed.addFields({ name: 'Jeu', value: this.gameConfig.get(validatedState.games) ?? validatedState.games, inline: true });
    }

    embed.addFields({ name: '📍 Localisation', value: locationText, inline: true });

    if (validatedState.equip) {
      embed.addFields({ name: '🎒 Equipement', value: validatedState.equip, inline: true });
    }

    if (validatedState.reward) {
      embed.addFields({ name: '💰 Recompense', value: validatedState.reward, inline: true });
    }

    const visualPath = this.resolveOperationVisualPath(validatedState, role.name);
    const files: AttachmentBuilder[] = [];
    if (visualPath) {
      const imageName = path.basename(visualPath);
      files.push(new AttachmentBuilder(visualPath, { name: imageName }));
    }

    if (validatedState.autoCreated) {
      embed.setFooter({ text: 'Création automatique depuis le web' });
    }

    let channel = this.bot.guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === role.name.replace(' ', '-').toLowerCase()
    ) as TextChannel | undefined;
    if (!channel) {
      await this.ensureCreationOperationsChannels();
      const allChannels = await this.bot.guild.channels.fetch();
      channel = allChannels.find(
        (c) => c!.type === ChannelType.GuildText && c!.name === role.name.replace(' ', '-').toLowerCase()
      ) as TextChannel | undefined;
    }
    if (!channel) {
      throw new Error('channel introuvable pour ce type d\'opération');
    }

    const emoji = this.bot.guild.emojis.cache.get('1213915551210930306') ?? '👍';

    const message = await channel.send({
      content: `${role}\nPour valider votre présence interagissez avec l'emoji ${emoji}`,
      embeds: [embed],
      files,
    });
    await message.react(emoji);
    const thread = await message.startThread({
      name: `Discussion - ${role.name.toUpperCase().split('-')[1]}`,
      autoArchiveDuration: 1440,
    });
    const threadMessages = [
      '👋 **Bienvenue dans le fil de discussion de cette opération !**',
      '📌 Discutez des stratégies, rôles et détails ici.',
    ];

    if (validatedState.autoCreated) {
      threadMessages.push('🤖 Cette opération a été créée automatiquement depuis le web.');
    }

    if (validatedState.miningSessionUrl) {
      threadMessages.push(`⛏️ Une session de minage a été créée pour cette opération : ${validatedState.miningSessionUrl}`);
    } else if (validatedState.url) {
      threadMessages.push(`🔗 Une URL a été partagée pour cette opération : ${validatedState.url}`);
    }

    await thread.send({
      content: threadMessages.join('\n')
    });

    let tempUrl: string | null = null;
    let tempUrlExpiresAt: string | null = null;

    if (validatedState.type !== this.bot.operationManager.roleConfig.get('🎮')) {
      try {
        const siteUrl = 'https://www.1ercorpscolonial.fr/bot/operation/generate-temp-url';
        const params = new URLSearchParams({
          user_id: author.id,
          operation_id: message.id,
          responsable: author.displayName,
          start_at: futureDate.toISOString(),
          channel_id: channel.id,
          thread_id: thread.id,
        });

        const response = await fetch(`${siteUrl}?${params.toString()}`);
        const rawBody = await response.text();

        if (response.ok) {
          let json: Record<string, unknown>;
          try {
            json = JSON.parse(rawBody) as Record<string, unknown>;
          } catch (jsonErr) {
            await this.logger.error({ msg: 'Réponse non JSON du site:', text: rawBody });
            throw jsonErr;
          }

          tempUrl = typeof json.temp_url === 'string' ? json.temp_url : null;
          tempUrlExpiresAt = typeof json.expires_at === 'string' ? json.expires_at : null;
        } else {
          await this.logger.warn('Erreur lors de la génération du lien temporaire: ' + response.statusText + ' Body: ' + rawBody);
        }
      } catch (err) {
        await this.logger.error({ msg: 'Erreur lors de la requête vers le site Symfony:', err });
      }
    }

    if (tempUrl) {
      const now = Date.now();
      const startAt = futureDate.getTime();
      const delay = Math.max(0, startAt + 60 * 60 * 1000 - now);

      this.addPendingLink({
        id: message.id,
        userId: author.id,
        tempUrl,
        sendAt: now + delay,
        channelId: channel.id,
      });
    }

    await this.logger.debug(`Envoi de l'opération créer par ${author.displayName}`);

    return {
      messageId: message.id,
      channelId: channel.id,
      threadId: thread.id,
      jumpUrl: message.url,
      startAt: futureDate.toISOString(),
      tempUrl,
      tempUrlExpiresAt,
      roleId: role.id,
      roleName: role.name,
      typeSpe: validatedState.typeSpe ?? null,
      autoCreated: validatedState.autoCreated === true,
      miningSessionUrl: validatedState.miningSessionUrl ?? null,
    };
  }

  public async sendForm(interaction: ButtonInteraction): Promise<void> {
    const user = interaction.user;
    const dmChannel = await user.createDM();

    await interaction.deferUpdate();

    const view = new OperationView(this.bot);
    await view.render(dmChannel as TextBasedChannel, null, '');

    await interaction.followUp({
      content: 'Formulaire Opération envoyé en DM.',
      ephemeral: true,
    });

    await this.logger.debug(`Envoi du formulaire d'opération à ${user.tag}`);
  }

  public async handlerForm(interaction: FormInteraction, data: InteractionData) {
    const view = new OperationView(this.bot);

    // OperationView.handleInteraction expects its own data shape; cast at the boundary
    await view.handleInteraction(interaction, data as unknown as Parameters<typeof view.handleInteraction>[1]);

    let dmChannel = interaction.channel;
    if (!dmChannel) {
      dmChannel = await this.bot.channels.fetch(interaction.channelId!) as TextBasedChannel;
    }
    const existingMessage = 'message' in interaction ? interaction.message : null;

    if (!view.isSupp(interaction.customId)) {
      await view.render(dmChannel as TextBasedChannel, existingMessage as Message, interaction.customId);
    }
  }

  public async createOperation(interaction: FormInteraction, state: OperationState) {
    const author = await this.getOperationAuthor(interaction.user.id);
    const result = await this.createOperationForAuthor(author, state);

    await interaction.followUp({
      content: '✅ Opération créée ! Vous pouvez la retrouver dans le salon <#' + result.channelId + '>.',
      ephemeral: true,
    });

    return result;
  }

  public async createOperationFromWeb(session: MiningSession): Promise<OperationCreateResult> {
    const author = await this.getOperationAuthor(session.createdBy?.discordId);

    const body = session.defaultBody;

    if (!body) throw new Error('Corps par défaut obligatoire pour l\'opération');

    const readEntityId = (value: unknown): number => {
      const id = Number((value as { id?: number } | null | undefined)?.id ?? 0);
      return Number.isFinite(id) ? id : 0;
    };

    let planetId = 0;
    let moonId = 0;
    let systemId = 0;

    if (body.type === CelestialBodyType.PLANET) {
      planetId = body.id;
      systemId = readEntityId(body.system);
    }

    if (body.type === CelestialBodyType.MOON) {
      moonId = body.id;
      planetId = readEntityId(body.parent);
      systemId = readEntityId(body.system);
    }

    // If relations are not hydrated on the current entity, reload what we need from DB.
    if (
      (body.type === CelestialBodyType.PLANET && systemId === 0)
      || (body.type === CelestialBodyType.MOON && (planetId === 0 || systemId === 0))
    ) {
      const hydratedBody = await this.bot.db.getEm().findOne(
        CelestialBody,
        { id: body.id },
        { populate: ['system', 'parent'] },
      );

      if (!hydratedBody) {
        throw new Error('Corps céleste introuvable pour la création d\'opération');
      }

      if (hydratedBody.type === CelestialBodyType.PLANET) {
        planetId = hydratedBody.id;
        systemId = readEntityId(hydratedBody.system);
      }

      if (hydratedBody.type === CelestialBodyType.MOON) {
        moonId = hydratedBody.id;
        planetId = readEntityId(hydratedBody.parent);
        systemId = readEntityId(hydratedBody.system);
      }
    }

    if (systemId === 0 || (moonId !== 0 && planetId === 0)) {
      throw new Error('Impossible de déterminer la localisation de la session de minage');
    }

    const payload: OperationState  = {
      type: this.roleConfig.get('🚛')!,
      typeSpe: 'MN',
      startAt: this.formatStartAt(new Date()),
      location: `${systemId}.${planetId}.${moonId}`,
      description: `Session de minage ${session.name}`,
      equip: 'Équipement(s) de minage',
      miningSessionUrl: `https://www.1ercorpscolonial.fr/mining/session/${session.id}`,
      autoCreated: true,
    }
    return this.createOperationForAuthor(author, payload);
  }

  /** Gestion des liens temporaires en attente */
  public loadPendingLinks(): PendingLink[] {
    try {
      const raw = JSON.parse(fs.readFileSync(PENDING_LINKS_PATH, 'utf-8'));
      if (!Array.isArray(raw)) {
        return [];
      }

      return raw
        .map((link) => this.normalizePendingLink(link))
        .filter((link): link is PendingLink => link !== null);
    } catch {
      return [];
    }
  }

  public savePendingLinks(links: PendingLink[]) {
    fs.writeFileSync(PENDING_LINKS_PATH, JSON.stringify(links, null, 2));
  }

  private normalizePendingLink(raw: unknown): PendingLink | null {
    const link = raw as Record<string, unknown>;
    const id = String(link?.id ?? '').trim();
    const userId = String(link?.userId ?? '').trim();
    const tempUrl = String(link?.tempUrl ?? '').trim();
    const sendAtValue = Number(link?.sendAt ?? 0);

    if (!id || !userId || !tempUrl || !Number.isFinite(sendAtValue)) {
      return null;
    }

    const normalized: PendingLink = {
      id,
      userId,
      tempUrl,
      sendAt: Math.trunc(sendAtValue),
    };

    const channelId = String(link?.channelId ?? '').trim();
    if (channelId) {
      normalized.channelId = channelId;
    }

    const attempts = Number(link?.attempts);
    if (Number.isFinite(attempts) && attempts > 0) {
      normalized.attempts = Math.trunc(attempts);
    }

    const lastAttemptAt = Number(link?.lastAttemptAt);
    if (Number.isFinite(lastAttemptAt) && lastAttemptAt > 0) {
      normalized.lastAttemptAt = Math.trunc(lastAttemptAt);
    }

    const lastError = String(link?.lastError ?? '').trim();
    if (lastError) {
      normalized.lastError = lastError;
    }

    return normalized;
  }

  private clearPendingLinkTimer(id: string): void {
    const timer = this.pendingLinkTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.pendingLinkTimers.delete(id);
    }
  }

  private schedulePendingLink(link: PendingLink): void {
    this.clearPendingLinkTimer(link.id);

    const delay = Math.max(0, link.sendAt - Date.now());
    const timer = setTimeout(() => {
      void this.processPendingLink(link.id);
    }, delay);

    this.pendingLinkTimers.set(link.id, timer);
  }

  private async hasEnoughParticipants(link: PendingLink): Promise<boolean> {
    if (!link.channelId) {
      // Backward compatibility with older entries that do not persist channelId.
      return true;
    }

    try {
      // Vérifier si le TempLink est archivé (message supprimé après 4h)
      const em = this.bot.db.getEm();
      const tempLink = await em.findOne(TempLink, { operationId: link.id });
      if (tempLink?.isArchived()) {
        await this.logger.debug({ operationId: link.id }, 'TempLink archivé, considéré comme prêt');
        return true;
      }

      const fetchedChannel = await this.bot.guild.channels.fetch(link.channelId);
      if (!fetchedChannel || fetchedChannel.type !== ChannelType.GuildText) {
        return false;
      }

      const message = await (fetchedChannel as TextChannel).messages.fetch(link.id);
      return message.reactions.cache.some((reaction) => (reaction.count ?? 0) > 2);
    } catch (err: unknown) {
      // Si le message est introuvable (supprimé), on considère que c'est prêt
      if ((err as any)?.code === 10008) {
        await this.logger.debug({ operationId: link.id }, 'Message supprimé (après 4h), envoi du lien');
        return true;
      }

      await this.logger.warn({ msg: 'Impossible de vérifier les réactions de l\'opération:', operationId: link.id, err });
      return false;
    }
  }

  private async processPendingLink(id: string): Promise<void> {
    const links = this.loadPendingLinks();
    const link = links.find((entry) => entry.id === id);
    if (!link) {
      this.clearPendingLinkTimer(id);
      return;
    }

    // Vérifier si le lien a déjà été envoyé en DM
    const em = this.bot.db.getEm();
    const tempLink = await em.findOne(TempLink, { operationId: link.id });
    if (tempLink?.dmSent) {
      this.logger.debug({ operationId: link.id }, 'Lien déjà envoyé en DM, suppression');
      this.removePendingLink(link.id);
      return;
    }

    if (link.sendAt > Date.now()) {
      this.schedulePendingLink(link);
      return;
    }

    const isReady = await this.hasEnoughParticipants(link);
    if (!isReady) {
      link.sendAt = Date.now() + PENDING_LINK_RETRY_INTERVAL_MS;
      link.attempts = (link.attempts ?? 0) + 1;
      link.lastAttemptAt = Date.now();
      link.lastError = 'Participation insuffisante';
      this.savePendingLinks(links);
      this.schedulePendingLink(link);
      return;
    }

    try {
      const member = await this.bot.guild.members.fetch(link.userId);
      const dm = await member.createDM();
      await dm.send(`Le rapport d'opération est prêt, voici le lien temporaire valable 2 jours ⬇️\n${link.tempUrl}\n\nPensez à bien le valider afin d'attribuer l'XP correspondante ⚠️`);

      // Marquer le lien comme envoyé en DM dans la base de données
      if (tempLink) {
        tempLink.dmSent = true;
        await em.persistAndFlush(tempLink);
      }

      this.removePendingLink(link.id);
    } catch (err) {
      link.sendAt = Date.now() + PENDING_LINK_RETRY_INTERVAL_MS;
      link.attempts = (link.attempts ?? 0) + 1;
      link.lastAttemptAt = Date.now();
      link.lastError = err instanceof Error ? err.message : String(err);
      this.savePendingLinks(links);
      this.schedulePendingLink(link);
      await this.logger.warn({ msg: 'Impossible d\'envoyer le lien temporaire en DM:', operationId: link.id, err });
    }
  }

  public addPendingLink(link: PendingLink) {
    const links = this.loadPendingLinks();
    const existingIndex = links.findIndex((entry) => entry.id === link.id);
    if (existingIndex >= 0) {
      links[existingIndex] = link;
    } else {
      links.push(link);
    }

    this.savePendingLinks(links);
    this.schedulePendingLink(link);
  }

  public removePendingLink(id: string) {
    this.clearPendingLinkTimer(id);
    let links = this.loadPendingLinks();
    links = links.filter((l) => l.id !== id);
    this.savePendingLinks(links);
  }

  public resumePendingLinks() {
    const links = this.loadPendingLinks();
    for (const link of links) {
      this.schedulePendingLink(link);
    }
  }
}
