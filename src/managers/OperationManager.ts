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
import { SVGManager } from '../utils/SVGManager.js';
import { lookup } from 'mime-types';
import { OperationRoleManager } from './OperationRoleManager.js';

const CATEGORY_NAME = 'Opérations';
const FOLDER_NAME = "Operations";
const BASE = path.resolve('config');
const PENDING_LINKS_PATH = path.join(BASE, 'pendingLinks.json');
const ALLOWED_START_DELAYS = ['0', '15', '30', '45', '60', '90', '120', '150', '180'];

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
      minutes: String(state.minutes ?? '').trim(),
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

    if (!ALLOWED_START_DELAYS.includes(normalized.minutes)) {
      throw new Error(`minutes invalide, valeurs autorisées: ${ALLOWED_START_DELAYS.join(', ')}`);
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

  private async getOperationAuthor(userId: string): Promise<OperationAuthor> {
    const member = await this.bot.guild.members.fetch(userId);
    return {
      id: member.id,
      username: member.user.username,
      displayName: member.displayName,
    };
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

    const name = (validatedState.typeSpe && validatedState.typeSpe !== 'GE') ? path.join('MP', validatedState.typeSpe) : role.name;
    const config = {
      svgTemplatePath: path.join('Data', FOLDER_NAME, `${name}.svg`),
      xsltPath: path.join('Data', FOLDER_NAME, 'template.xslt'),
      outputSvgPath: path.join('Data', FOLDER_NAME, 'operation.svg'),
      outputPngPath: path.join('Data', FOLDER_NAME, `${author.username}_${role.name}.png`),
      baseDir: path.join('Data', FOLDER_NAME)
    };

    const mins = Number(validatedState.minutes) || 0;
    const futureDate = new Date(Date.now() + mins * 60_000);
    const timeString = new Intl.DateTimeFormat('fr-FR', {
      hour12: false,
      hour:   '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Paris'
    }).format(futureDate);
    const dateString = new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long',
      day:     '2-digit',
      month:   '2-digit',
      year:    'numeric',
      timeZone: 'Europe/Paris'
    }).format(futureDate).toUpperCase();

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
    const entete = `[${timeString}] OPÉRATION ${role.name.toUpperCase().split('-')[1]} - RESPONSABLE: ${author.displayName}`;
    const operationInfo = validatedState.autoCreated ? `${entete} - AUTOMATIQUE` : entete;

    let dataUri: string | null = null;

    if (validatedState.type === this.bot.operationManager.roleConfig.get('🎮')) {
      const imgPath = path.join(config.baseDir, 'MG', `${validatedState.games}.png`);
      const fileBuffer = fs.readFileSync(imgPath);

      const contentType =
        lookup(imgPath) || 'application/octet-stream';

      const base64 = fileBuffer.toString('base64');

      dataUri = `data:${contentType};base64,${base64}`;
    }

    const materiel = (validatedState.type === this.bot.operationManager.roleConfig.get('🎮')) ? this.gameConfig.get(validatedState.games!) : (validatedState.equip ? `Equipement: ${validatedState.equip}` : '');
    const data = {
      description: validatedState.description ? validatedState.description : '',
      materiel: materiel,
      prime: validatedState.reward ? `Prime: ${validatedState.reward}` : '',
      localisation: names.join(' >> '),
      info: operationInfo,
      date: dateString,
      imgMG: (validatedState.type === this.bot.operationManager.roleConfig.get('🎮')) ? dataUri : ''
    };

    const SVGMgr = new SVGManager(data, config);
    await SVGMgr.generateImage();

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

    const attachment = new AttachmentBuilder(config.outputPngPath);
    const emoji = this.bot.guild.emojis.cache.get('1213915551210930306') ?? '👍';

    const message = await channel.send({
      content: `${role}\nPour valider votre présence interagissez avec l'emoji ${emoji}`,
      files: [attachment]
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
        if (response.ok) {
          let json;
          try {
            json = await response.json();
          } catch (jsonErr) {
            const text = await response.text();
            await this.logger.error({ msg: 'Réponse non JSON du site:', text });
            throw jsonErr;
          }
          tempUrl = json.temp_url;
          tempUrlExpiresAt = json.expires_at;
        } else {
          const text = await response.text();
          await this.logger.warn('Erreur lors de la génération du lien temporaire: ' + response.statusText + ' Body: ' + text);
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
        sendAt: now + delay
      });

      setTimeout(async () => {
        try {
          const reaction = message.reactions.cache.get(typeof emoji === 'string' ? emoji : emoji.id);
          if (reaction && reaction.count > 2) {
            const member = await this.bot.guild.members.fetch(author.id);
            const dm = await member.createDM();
            await dm.send(`Le rapport d'opération est prêt, voici le lien temporaire valable 2 jours ⬇️\n${tempUrl}\n\nPensez à bien le valider afin d'attribuer l'XP correspondante ⚠️`);
            this.removePendingLink(message.id);
          }
        } catch (err) {
          await this.logger.warn({ msg: 'Impossible d\'envoyer le lien temporaire en DM:', err });
        }
      }, delay);
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

  public async createOperationFromWeb(input: WebOperationCreateInput): Promise<OperationCreateResult> {
    const userId = String(input.userId ?? '').trim();
    if (!userId) {
      throw new Error('userId manquant');
    }

    const author = await this.getOperationAuthor(userId);
    return this.createOperationForAuthor(author, { ...input, autoCreated: true });
  }

  /** Gestion des liens temporaires en attente */
  public loadPendingLinks(): any[] {
    try {
      return JSON.parse(fs.readFileSync(PENDING_LINKS_PATH, 'utf-8'));
    } catch {
      return [];
    }
  }

  public savePendingLinks(links: any[]) {
    fs.writeFileSync(PENDING_LINKS_PATH, JSON.stringify(links, null, 2));
  }

  public addPendingLink(link: any) {
    const links = this.loadPendingLinks();
    links.push(link);
    this.savePendingLinks(links);
  }

  public removePendingLink(id: string) {
    let links = this.loadPendingLinks();
    links = links.filter(l => l.id !== id);
    this.savePendingLinks(links);
  }

  public resumePendingLinks() {
    const links = this.loadPendingLinks();
    for (const link of links) {
      const delay = Math.max(0, link.sendAt - Date.now());
      setTimeout(async () => {
        try {
          const user = await this.bot.guild.members.fetch(link.userId);
          const dm = await user.createDM();
          await dm.send(`Voici ton lien temporaire d'accès au rapport d'opération :\n${link.tempUrl}`);
          this.removePendingLink(link.id);
        } catch (err) {
          await this.logger.warn({ msg: "Impossible d'envoyer le lien temporaire en DM:", err });
        }
      }, delay);
    }
  }
}
