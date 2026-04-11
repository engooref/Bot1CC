// src/BotManager.ts
import { 
  Client, GatewayIntentBits, Guild, Role, GuildChannel, GuildBasedChannel, 
  DMChannel, Collection, GuildMember, 
  PartialGuildMember,
  Interaction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  VoiceState,
  ChannelType,
  Message,
  TextChannel,
  ThreadChannel,
  Events,
  VoiceChannel,
  PermissionFlagsBits,
} from 'discord.js';
import { botLogger } from './logger.js';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import DatabaseManager from './managers/DatabaseManager.js';
import { Role as DBRole } from './entities/Role.js';
import { Parameter } from './entities/Parameter.js';
import EventManager  from './managers/EventManager.js';
import SchedulerManager from './managers/SchedulerManager.js';

import { Channel } from './entities/Channel.js';
import { User } from './entities/User.js';
import UserManager from './managers/UserManager.js';
import { Event } from './entities/Event.js';
import { Response } from './entities/Response.js';
import { componentHandlerRegistry } from './registry/ComponentHandlerRegistry.js';
import { ComponentInteraction, ViewHandlers } from './view/BaseView.js';
import { InteractionContext } from './entities/ViewContext.js';

import { SafeMethod } from './exception/Safe.js';
import WebServer from './web/WebServer.js';
import { OperationModule } from './managers/OperationManager.js';

import {Handlers} from './view/TicketsView.js'
import { TicketManager } from './managers/TicketsManager.js';
import { sendEnga, sendCandidatures } from './view/EngaView.js';
import SlashCommandManager, { CommandHandler } from './utils/SlashCommandManager.js';
import ScreenManager from './managers/ScreenManager.js';
import MusicManager from './managers/MusicManager.js';
import DuelManager from './managers/DuelManager.js';
import { GithubManager, GithubHandlers } from './managers/GithubManager.js';

import { VoicePresence } from './entities/VoicePresence.js';


export default class BotManager extends Client {
  public guildId: string;
  public guild!: Guild;
  public roleMember?: Role;
  public dbMgr: DatabaseManager;
  public evMgr!: EventManager;
  public usrMgr!: UserManager;

  // public ticketMgr: TicketManager;
  public opMgr!: OperationModule;
  public tkMgr!: TicketManager;
  public schedMgr!: SchedulerManager;
  private slhMgr!: SlashCommandManager;
  public scrMgr!: ScreenManager;
  public musicMgr!: MusicManager;
  public duelMgr!: DuelManager;
  public githubMgr!: GithubManager;

  private hasStarted = false;
  private parameters: Record<string, Parameter> = {};

  public excludeCategory: string[] = ['Cimetière des canaux'];

  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,

      ],
    });

    this.guildId   = process.env.GUILD_ID!;
    this.dbMgr = new DatabaseManager(this, ['Cimetière des canaux']);

    // Événements Discord.js
    this.once(Events.ClientReady, () => this._onReady());
    
    this.setHandlersDiscord();
    this.setHandlersButtons();
    this.login(process.env.DISCORD_TOKEN!);
  }

  private setHandlersDiscord() {
    // Bind des handlers
    this.on('roleCreate', this._onGuildRoleCreate.bind(this));
    this.on('roleDelete', this._onGuildRoleDelete.bind(this));
    this.on('roleUpdate', this._onGuildRoleUpdate.bind(this));
    this.on('channelCreate', this._onGuildChannelCreate.bind(this));
    this.on('channelDelete', this._onGuildChannelDelete.bind(this));
    this.on('channelUpdate', this._onGuildChannelUpdate.bind(this));

    this.on('guildMemberUpdate', this._onGuildMemberUpdate.bind(this));
    this.on('guildMemberRemove', this._onGuildMemberRemove.bind(this));

    this.on('interactionCreate', this._onInteraction.bind(this))
    this.on('voiceStateUpdate', this._onVoiceStateUpdate.bind(this));
    this.on('messageCreate', this._onMessageCreate.bind(this));
  }

  
  private setHandlersButtons() {
    // clés libres, tant qu’elles sont uniques
    componentHandlerRegistry.register(ViewHandlers.InviteViewHandler, async (interaction, data) => {
      await (interaction as ButtonInteraction).deferUpdate();

      await this.evMgr.userResponseHandle(interaction as ButtonInteraction, data);
    });

    componentHandlerRegistry.register(ViewHandlers.OperationHandler, async (interaction, data) => {
      if ((interaction as ButtonInteraction).customId == 'op_btn') 
        await this.opMgr.sendForm(interaction as ButtonInteraction)
      else
        await this.opMgr.handlerForm(interaction, data)
    });

    componentHandlerRegistry.register(ViewHandlers.TicketsHandler, async (interaction, data) => {
      if (interaction.isButton()) {
        if (interaction.customId == Handlers.OpenTicket)
          await this.tkMgr.sendForm(interaction)
        else if (interaction.customId == Handlers.CloseTicket)
          await this.tkMgr.closeForm(interaction, data)
      }
      else if ((interaction as StringSelectMenuInteraction).customId == Handlers.SelectType) 
        await this.tkMgr.createTickets(interaction as StringSelectMenuInteraction, data)
      else if (interaction.isModalSubmit())
        await this.tkMgr.modalSubmit(interaction, data)
    });

    componentHandlerRegistry.register(ViewHandlers.EngaHandler, async (interaction , _) => {
      if (interaction.isButton())
        await sendCandidatures(interaction, this);        
    });

    componentHandlerRegistry.register(ViewHandlers.ScreenHandler, async (interaction , data) => {
      await this.scrMgr.handlerForm(interaction as (ComponentInteraction), data);  
    });

    componentHandlerRegistry.register(ViewHandlers.PromotionsHandler, async (interaction, _) => {
      await this.usrMgr.removePromotion(interaction as (ComponentInteraction));
    });

    componentHandlerRegistry.register(ViewHandlers.DuelHandler, async (interaction, data) => {
      await (interaction as ButtonInteraction).deferUpdate();
      await this.duelMgr.handleDuelCommand(interaction as ButtonInteraction, data);
    });

    componentHandlerRegistry.register(ViewHandlers.GithubHandler, async (interaction, data) => {
      if (interaction.isStringSelectMenu() && interaction.customId === GithubHandlers.SelectRepo)
        await this.githubMgr.handleSelectRepo(interaction as StringSelectMenuInteraction, data);
      else if (interaction.isModalSubmit())
        await this.githubMgr.handleModalSubmit(interaction, data);
    });
    
  }

  @SafeMethod
  private async _onReady(): Promise<void> {
    if (this.hasStarted) return;
    this.hasStarted = true;

    await this.dbMgr.connect();
     // Récupération de la guild
    const guild = this.guilds.cache.get(this.guildId);
    if (!guild) {
      throw new Error(`Guild ${this.guildId} introuvable`);
    }
    this.guild = guild;

    // Récupération du rôle membre (via ID en .env)
    const roleId = process.env.ROLE_ID;
    if (roleId) {
      this.roleMember = this.guild.roles.cache.get(roleId);
    }

    const me = await this.guild.members.fetchMe();
    await this.dbMgr.insertAndGetUser(me);
    
    await this.loadParameters();
    await this.createManager();

    await botLogger.debug({ op: "BOOT"}, 'Synchronisation des Rôles');
    await this.dbMgr.syncRoles(this.guild.roles.cache);
    await botLogger.debug({ op: "BOOT"}, 'Synchronisation des Channels');
    await this.dbMgr.syncChannels(this.guild.channels.cache);

    await sendEnga(this);

    await botLogger.info({ op: "BOOT" }, `Discord connecté en tant que ${this.user?.tag}`);
  }

  private async createManager() {
    await botLogger.debug({ op: "BOOT" }, 'Création des Managers')
    this.evMgr = new EventManager(this);
    this.usrMgr = new UserManager(this);
    
    this.opMgr = new OperationModule(this);
    await this.opMgr.init();
    
    this.tkMgr = new TicketManager(this);
    await this.tkMgr.init();

    this.scrMgr = new ScreenManager(this);
    //this.musicMgr = new MusicManager(this);
    this.duelMgr = new DuelManager(this);
    this.githubMgr = new GithubManager(this);

    // Fusion dynamique des handlers exposés par chaque manager
    const handlersMap = {
      ...this.scrMgr.getSlashHandlers(),
      ...this.evMgr.getSlashHandlers(),
      ...this.dbMgr.getSlashHandlers(),
      ...this.githubMgr.getSlashHandlers(),
    } as Record<string, CommandHandler>;

    this.slhMgr = new SlashCommandManager(this, handlersMap);
    await this.slhMgr.loadAllCommandDefinitions()
    
    this.schedMgr  = new SchedulerManager(this);

    const webServer = new WebServer(this);
    webServer.start(parseInt(process.env.PORT!, 10));
  }

  @SafeMethod
  private async _onGuildRoleCreate(role: Role) {
    try {
      await botLogger.info({ op: "GUILD_ROLE_CREATE" }, `Création du rôle : ${role.name}`);
      const singleRoleCollection = new Collection<string, Role>();
      // 2. Ajoute ton rôle dedans (clé = id, valeur = objet role)
      singleRoleCollection.set(role.id, role);
      this.dbMgr.syncRoles(singleRoleCollection);
    } catch (e) {
      await botLogger.error({ op: "GUILD_ROLE_CREATE", err: e, role: role.id });
    }
  }

  @SafeMethod
  private async _onGuildRoleDelete(role: Role) {
    try {
      const em = this.dbMgr.getEm();
      await botLogger.info({ op: "GUILD_ROLE_DELETE" }, `Suppression du rôle : ${role.name}`);
      await em.nativeDelete(DBRole, {discordId: role.id});
    } catch (e) {
      await botLogger.error({ op: "GUILD_ROLE_DELETE", err: e, role: role.id });
    }
  }

  @SafeMethod
  private async _onGuildRoleUpdate(oldRole: Role, newRoleObj: Role) {
    try {
      const em = this.dbMgr.getEm();
      const roleEntity = await em.findOne(
        DBRole, {discordId:   newRoleObj.id }
      );

      if (!roleEntity) return;

      roleEntity.name = newRoleObj.name;
      await em.persist(roleEntity).flush();
      
      await botLogger.info({ op: "GUILD_ROLE_UPDATE" }, `Modification du rôle ${newRoleObj.id} : ${oldRole.name} -> ${newRoleObj.name}`);
    } catch (e) {
      await botLogger.error({ op: "GUILD_ROLE_UPDATE", err: e, oldRole: oldRole.id, newRole: newRoleObj.id } );
    }
  }

  @SafeMethod
  private async _onGuildChannelCreate(channel: GuildChannel) {
    try {
      const singleChannelCollection = new Collection<string, GuildBasedChannel>();
      singleChannelCollection.set(channel.id, channel as GuildBasedChannel);
      this.dbMgr.syncChannels(singleChannelCollection);
    } catch (e) {
      await botLogger.error({ op: "GUILD_CHANNEL_CREATE", err: e, channel: channel.id });
    }
  }

  @SafeMethod
  private async _onGuildChannelDelete(channel: DMChannel | GuildChannel) {
    try {
      if(channel as DMChannel) return;
      const em = this.dbMgr.getEm();
      await em.nativeDelete(Channel, {discordId: channel.id});
      await botLogger.info({ op: "GUILD_CHANNEL_DELETE" }, `Suppression du canal : ${(channel as GuildChannel).name}`);
    } catch (e) {
      await botLogger.error({ op: "GUILD_CHANNEL_DELETE", err: e, channel: channel.id });
    }
  }

  @SafeMethod
  private async _onGuildChannelUpdate(
    oldChannel: DMChannel | GuildChannel,
    newChannel: DMChannel | GuildChannel
  ) {
    try {
      const em = this.dbMgr.getEm();
      if(newChannel as DMChannel) return;
      if ((oldChannel as GuildChannel).name === (newChannel as GuildChannel).name) return;

      const channelEntity = await em.findOne(Channel, {discordId: newChannel.id});
      if (!channelEntity) return;

      channelEntity.name = (newChannel as GuildChannel).name;
      await em.persist(channelEntity).flush();
      await botLogger.info({ op: "GUILD_CHANNEL_UPDATE" }, `Modification du canal : ${(oldChannel as GuildChannel).name} -> ${(newChannel as GuildChannel).name}`);
    } catch (e) {
      await botLogger.error({ op: "GUILD_CHANNEL_UPDATE", err: e, oldChannel: oldChannel.id, newChannel: newChannel.id });
    }
  }

  @SafeMethod
  private async _onGuildMemberUpdate(
    before: GuildMember | PartialGuildMember,
    after: GuildMember,
  ) {
    try {
      const em = this.dbMgr.getEm();
      // 1) Récupère ou crée l’utilisateur en bdd
      let user: User | null = await em.findOne(
        User,
        { discordId: after.id },
        { populate: ['*'] }
      );

      // calcule les rôles ajoutés / retirés
      const newRoles = after.roles.cache.filter(
        r => !before.roles.cache.has(r.id),
      );
      const removedRoles = before.roles.cache.filter(
        r => !after.roles.cache.has(r.id),
      );

      if (!user) {
        // si ce n’est pas encore un “membre”, on ne fait rien à moins
        // qu’il vienne juste d’obtenir le rôle “membre”
        if (!newRoles.has(this.roleMember!.id)) {
          return;
        }

        user = await this.dbMgr.insertAndGetUser(after);
      }

      // 2) Si y a du changement de rôle
      if (newRoles.size || removedRoles.size) {
        // s’il perd le rôle “membre”, on le supprime
        if (removedRoles.has(this.roleMember!.id)) {
          await em.removeAndFlush(user);
          return;
        }

        // (optionnel) synchronise toutes les nouvelles Roles en bdd
        await this.dbMgr.syncRoles(newRoles);

        let changeGrade = false;

        // AJOUT de rôles
        for (const r of newRoles.values()) {
          const dbRole = await em.findOne(
            DBRole,
            { discordId: r.id },
            { populate: ['rank'] }
          );
          if (dbRole && !user.rolesDiscord.contains(dbRole)) {
            changeGrade = changeGrade || (dbRole.rank !== null);
            user.rolesDiscord.add(dbRole);
          }
        }

        // RETRAIT de rôles
        for (const r of removedRoles.values()) {
          const dbRole = await em.findOne(
            DBRole,
            { discordId: r.id },
          );
          if (dbRole && user.rolesDiscord.contains(dbRole)) {
            changeGrade = changeGrade || (dbRole.rank !== null);
            user.rolesDiscord.remove(dbRole);
          }
        }

        // trace + flush
        await await botLogger.info({ op: "GUILD_MEMBER_UPDATE" }, `Modification des rôles de ${user.username}`);
        await em.persist(user).flush();

        // si nouveau membre ou changement de grade, réinitialise la RH
        if (
          newRoles.has(this.roleMember!.id) ||
          changeGrade
        ) {
          try {
            await this.usrMgr.initMemberRh(
              user.discordId,
              !changeGrade,
            );
          } catch (err) {
            await botLogger.error({ op: "GUILD_MEMBER_UPDATE", err, user: user.username });
            throw err;
          }
        }
      }

      // 3) Si le surnom a changé
      if (before.displayName !== after.displayName) {
        user.username = after.displayName;
        await em.persist(user).flush();

        // calcul de la période [premier jour ; dernier jour] du mois courant
        const today = new Date();
        const startOfMonth = new Date(
          today.getFullYear(),
          today.getMonth(),
          1,
        );
        const endOfMonth = new Date(
          today.getFullYear(),
          today.getMonth() + 1,
          0,
        );

        // récupère les events du mois
        const events = await em.find(Event, {
          start:  { 
            $gte: startOfMonth,
            $lte: endOfMonth, 
          }, 
        }, {
          populate: ['*', 'responses.users'],
        });

        // pour chaque event où l’utilisateur a déjà répondu…
        for (const event of events) {
          const resp = await em.findOne(
            Response,
            {
              users: user.id,
              event: event.id,
            },
          );
          if (resp) {
            await this.evMgr.updateEvent(event);
          }
        }
      }
    } catch (e) {
      await botLogger.error({ op: "GUILD_MEMBER_UPDATE", err: e });
    }
  }

  @SafeMethod
  private async _onGuildMemberRemove(member: GuildMember | PartialGuildMember) {
    try {
      const user = await this.usrMgr.em.findOne(
        User,
        { discordId: member.id },
        { populate: false },
      );
      if (!user) return;
      await this.usrMgr.deleteUser(user);
    } catch (e) {
      await botLogger.error({ op: "GUILD_MEMBER_REMOVE", err: e });
    }
  }

  @SafeMethod
  public async _onInteraction(interaction: Interaction) {
    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
      const { customId, message } = interaction;

      const ctx = await this.dbMgr.getEm().findOne(InteractionContext, { customId, messageId: message?.id });
      if (!ctx) {
        await botLogger.debug({ op: "INTERACTION", customId, messageId: message?.id }, `Composant non trouvé -> customId: ${customId}  message: ${message}`)
        return
      }
      const handler = componentHandlerRegistry.get(ctx.handlerKey);
      if (handler) await handler(interaction, ctx.data);
    } else if (interaction.isChatInputCommand())
      this.slhMgr.handleInteraction(interaction);

    
     
  }

  /** Charge tous les paramètres depuis la BDD dans le cache `this.parameters` */
  @SafeMethod
  public async loadParameters(): Promise<void> {
    // Supposons que db.selectAll renvoie une liste d'instances de Parameter
    const all = await this.dbMgr.getEm().find(Parameter, {}, { populate: ["*"] });
    this.parameters = {};
    for (const p of all) {
      // on utilise p.toString() comme clé, comme ton __str__ Python qui renvoie le name
      this.parameters[p.name] = p;
    }
  }

  /** Récupère la valeur d’un paramètre déjà chargé */
  public getParameter(name: string): string | string[] {
    const p = this.parameters[name];
    if (!p) {
      throw new Error(`Le paramètre ${name} n'existe pas !`);
    }
    return p.getValue();
  }

  /**
   * Recharge les paramètres en base, puis réinitialise ton scheduler d’events.
   * (équivalent de ton update_param Python)
   */
  @SafeMethod
  public async refreshParameters(): Promise<void> {
    await this.loadParameters();
    // Appelle la méthode correspondante de ton scheduler
    this.schedMgr.appEvent.resetScheduler();
  }

  @SafeMethod
  private async _onVoiceStateUpdate(oldState: VoiceState, newState: VoiceState) {
    try {
      // 0) Pas de traitement si pas de changement de salon
      if (oldState.channelId === newState.channelId) return;

      // =========================================================
      // SYSTÈME "CRÉATEUR DE VOCAL" (indépendant des events)
      // =========================================================
      // .env requis : VOICE_CREATE_CHANNEL_ID=xxxx
      // (optionnel) : VOICE_CREATE_CATEGORY_ID=yyyy (force une catégorie)
      const CREATE_VOICE_ID = process.env.VOICE_CREATE_CHANNEL_ID ?? null;
      const FORCE_CATEGORY_ID = process.env.VOICE_CREATE_CATEGORY_ID ?? null;

      const isAutoVoice = (ch: any) =>
        ch?.type === ChannelType.GuildVoice && /^Salon vocal\s+\d+$/i.test(ch.name);

      const createAutoVoice = async (state: VoiceState) => {
        if (!CREATE_VOICE_ID) return;
        if (state.channelId !== CREATE_VOICE_ID) return;

        const creator = state.member;
        if (!creator) return;

        const creatorChannel = state.channel as VoiceChannel | null;
        if (!creatorChannel || creatorChannel.type !== ChannelType.GuildVoice) return;

        const parentId = FORCE_CATEGORY_ID ?? creatorChannel.parentId;
        if (!parentId) return;

        // 1) Trouver le plus petit numéro dispo: "Salon vocal X"
        const used = new Set<number>();
        this.guild.channels.cache.forEach((ch) => {
          if (ch.type !== ChannelType.GuildVoice) return;
          if (ch.parentId !== parentId) return;
          const m = ch.name.match(/^Salon vocal\s+(\d+)$/i);
          if (!m) return;
          const n = Number(m[1]);
          if (Number.isFinite(n) && n > 0) used.add(n);
        });

        let idx = 1;
        while (used.has(idx)) idx += 1;

        const channelName = `Salon vocal ${idx}`;

        // 2) Créer le vocal (permissions absolues au bot + créateur)
        const botId = this.user!.id;

        const created = await this.guild.channels.create({
          name: channelName,
          type: ChannelType.GuildVoice,
          parent: parentId,
          reason: `Auto-create voice for ${creator.user.tag}`,
          permissionOverwrites: [
            // Bot: full control
            {
              id: botId,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageRoles,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.Speak,
                PermissionFlagsBits.Stream,
                PermissionFlagsBits.UseVAD,
                PermissionFlagsBits.MoveMembers,
                PermissionFlagsBits.MuteMembers,
                PermissionFlagsBits.DeafenMembers,
                PermissionFlagsBits.PrioritySpeaker,
              ],
            },
            // Créateur: droits de gestion du vocal
            {
              id: creator.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.Speak,
                PermissionFlagsBits.Stream,
                PermissionFlagsBits.UseVAD,
                PermissionFlagsBits.MoveMembers,
                PermissionFlagsBits.MuteMembers,
                PermissionFlagsBits.DeafenMembers,
                PermissionFlagsBits.PrioritySpeaker,
              ],
            },
          ],
        });

        // 3) Mettre “en dernier” dans la catégorie (position la plus basse)
        const siblingsCount = this.guild.channels.cache.filter(
          (ch): ch is VoiceChannel =>
            ch.type === ChannelType.GuildVoice && ch.parentId === parentId
        ).size;

        await created.setPosition(siblingsCount);

        // 4) Move le créateur dedans
        await state.setChannel(created.id);

        await botLogger.info(
          { op: "VOICE_AUTOCREATE", user: creator.id, channel: created.id, parentId },
          `Création du vocal: ${channelName}`
        );
      };

      // Si l'utilisateur vient d'entrer dans le vocal créateur -> on crée & on move, puis on STOP.
      // Ça évite que ton système d'event équipe se déclenche au même moment.
      if (CREATE_VOICE_ID && newState.channelId === CREATE_VOICE_ID) {
        await createAutoVoice(newState);
        return;
      }

      // =========================================================
      // TON SYSTÈME EVENT / ÉQUIPES (code existant, conservé)
      // =========================================================
      const em = this.evMgr.em;
      const userId = newState.id;

      // On choisit le "meilleur" channel disponible pour déterminer le contexte d'event
      const effectiveChannel = newState.channel ?? oldState.channel;
      if (!effectiveChannel) {
        await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] both newState.channel and oldState.channel are null`);
        return;
      }

      // =========================
      // Helpers
      // =========================

      // A) Récupère l'event via parentId du channel
      const getEventByParentId = async (parentId: string | null) => {
        if (!parentId) return null;
        return await em.findOne(Event, { discord: { vocalParentId: parentId } });
      };

      // B) Upsert VoicePresence
      const getOrCreatePresence = async (event: Event, user: User) => {
        let presence = (await em.findOne(VoicePresence, { event, user })) as InstanceType<typeof VoicePresence> | null;
        if (!presence) {
          presence = em.create(VoicePresence, {
            event,
            user,
            xp: 0,
            present: true,
            promote: false,
          });
          em.persist(presence);
        }
        return presence;
      };

      // C) Move vers salon d'équipe (création si manquant)
      const moveToTeamChannel = async (
        parentId: string,
        teamName: string,
        userState: VoiceState,
        eventId: number
      ): Promise<void> => {
        const channelName = `Équipe ${teamName}`;
        let teamChannel = this.guild.channels.cache.find(
          (ch: any) => ch.type === ChannelType.GuildVoice && ch.parentId === parentId && ch.name === channelName
        );
        if (!teamChannel) {
          teamChannel = await this.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,
            parent: parentId,
            reason: `Création vocal équipe pour event ${eventId}`,
          });
        }
        await userState.setChannel((teamChannel as any).id);
      };

      // D) Move vers "Aucune équipe" (création si manquant)
      const moveToNoTeamChannel = async (
        parentId: string,
        userState: VoiceState,
        eventId: number
      ): Promise<void> => {
        // Recherche des channels "Aucune équipe" dans la même catégorie et collecte des indices occupés
        const prefix = "Aucune équipe";
        const occupied = new Set<number>();
        this.guild.channels.cache.forEach((ch: any) => {
          if (ch.type === ChannelType.GuildVoice && ch.parentId === parentId && ch.name.startsWith(prefix)) {
            const m = ch.name.match(/^Aucune équipe(?:\s*(\d+))?$/i);
            if (m) {
              const idx = m[1] ? parseInt(m[1], 10) : 1;
              if (!Number.isNaN(idx) && idx > 0) occupied.add(idx);
            }
          }
        });

        // Trouve le plus petit index libre (1, 2, 3, ...)
        let idx = 1;
        while (occupied.has(idx)) idx += 1;
        const channelName = `${prefix} ${idx}`;

        // Création du channel avec l'index trouvé
        const noTeamChannel = await this.guild.channels.create({
          name: channelName,
          type: ChannelType.GuildVoice,
          parent: parentId,
          reason: `Création vocal "${channelName}" pour event ${eventId}`,
        });

        await userState.setChannel((noTeamChannel as any).id);
      };

      // E) Suppression d’un salon d’équipe vide (ne supprime pas la catégorie)
      const deleteEmptyTeamChannel = async (channel: GuildChannel): Promise<void> => {
        try {
          const parent = channel.parent;
          await channel.delete(`Suppression auto : channel d'équipe vide`);

          if (parent?.children.cache.size === 0) {
            await parent.delete(`Suppression auto : catégorie d'event vide`);
          }
        } catch (e) {
          await botLogger.error({ op: "VOICE_STATE_UPDATE", err: e });
        }
      };

      // =========================
      // 1) Résoudre l'Event
      // =========================
      await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] channel.name=${effectiveChannel.name} channel.parentId=${effectiveChannel.parentId}`);
      let event = await getEventByParentId(effectiveChannel.parentId);
      if (!event && oldState.channel?.parentId) {
        await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] event not found with effectiveChannel, trying oldState.channel.parentId=${oldState.channel.parentId}`);
        event = await getEventByParentId(oldState.channel.parentId);
      }
      if (!event) {
        await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] No event found for parentId`);
        // (On ne return pas forcément ici si tu veux gérer d'autres vocaux,
        //  mais ton code actuel return, on conserve.)
        // return;
      } else {
        await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] Event found: id=${event.id} name=${event.name}`);

        // =========================
        // 2) Résoudre l'utilisateur & sa réponse
        // =========================
        const user = await em.findOne(User, { discordId: userId });
        if (!user) {
          await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] User not found: discordId=${userId}`);
          // continue quand même pour le cleanup des auto-voices plus bas
        } else {
          await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] User found: username=${user.username}`);

          const resp = await em.findOne(
            Response,
            { event, users: user, typeRep: { $in: ["accepted"] } },
            { populate: ["team"] }
          );
          if (!resp) {
            await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] No response found for user in event`);
          } else {
            await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] Response found: team=${resp.team?.name}`);

            // =========================
            // 3) Déterminer les vocaux d'équipe réels (hors channels techniques)
            // =========================
            const TECHNICAL_NAMES = new Set<string>(["Créer un vocal d'équipe", "Briefing", "Débriefing"]);

            const allTeamChannels: string[] = effectiveChannel.guild.channels.cache
              .filter(
                (ch) =>
                  ch.type === ChannelType.GuildVoice &&
                  ch.parentId === event.discord.vocalParentId &&
                  !TECHNICAL_NAMES.has(ch.name)
              )
              .map((ch) => ch.id);

            await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] allTeamChannels=${JSON.stringify(allTeamChannels)}`);

            const isInTeamChannel = !!(newState.channelId && allTeamChannels.includes(newState.channelId));
            await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] isInTeamChannel=${isInTeamChannel}`);

            // =========================
            // 4) Marquer la présence si l'utilisateur est dans un vocal d'équipe
            // =========================
            if (isInTeamChannel) {
              await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] User is in a team channel, upserting presence`);
              const presence = await getOrCreatePresence(event, user);
              await em.persist(presence).flush();
            }

            // =========================
            // 5) Move auto quand il entre par "Créer un vocal d'équipe"
            // =========================
            if (newState.channel?.name === "Créer un vocal d'équipe") {
              await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] User entered event category, moving to team/no-team channel`);
              if (resp.team) {
                await moveToTeamChannel(event.discord.vocalParentId!, resp.team.name, newState, event.id);
              } else {
                await moveToNoTeamChannel(event.discord.vocalParentId!, newState, event.id);
              }
            }

            // =========================
            // 6) Nettoyage : supprimer un vocal d'équipe désormais vide
            // =========================
            if (
              oldState.channel &&
              oldState.channel.type === ChannelType.GuildVoice &&
              oldState.channel.parentId === event.discord.vocalParentId &&
              oldState.channel.members instanceof Collection &&
              oldState.channel.members.size === 0 &&
              oldState.channel.name !== "Créer un vocal d'équipe"
            ) {
              await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] Deleting empty team channel: ${oldState.channel.name}`);
              await deleteEmptyTeamChannel(oldState.channel as unknown as GuildChannel);
            }
          }
        }
      }

      // =========================================================
      // CLEANUP GLOBAL : supprimer un "Salon vocal X" si vide
      // (indépendant des events, donc toujours en fin de handler)
      // =========================================================
      if (
        oldState.channel &&
        isAutoVoice(oldState.channel) &&
        oldState.channel.members instanceof Collection &&
        oldState.channel.members.size === 0
      ) {
        await botLogger.info(
          { op: "VOICE_AUTODELETE", channel: oldState.channel.id, name: oldState.channel.name },
          "Suppression auto : vocal temporaire vide"
        );
        await oldState.channel.delete("Auto-delete: salon vocal temporaire vide").catch(() => {});
      }
    } catch (err) {
      await botLogger.error({ op: "VOICE_STATE_UPDATE", err });
    }
  }


private async _onMessageCreate(message: Message) {
  try {
    const targetUserId = '216305802296688640';

    // 1) filtres de base
    if (message.author.bot || message.webhookId) return;
    if (message.guildId !== this.guildId) return; // plus rapide que message.guild?.id
    if (message.author.id === targetUserId) return;

    // 2) vérifier que le message est dans la catégorie "Ambassades"
    const inAmbassadeCategory = (() => {
      const ch = message.channel as GuildBasedChannel;
      const AMBASSADES_CATEGORY_ID = process.env.AMBASSADES_CATEGORY_ID ?? null;

      // Si c'est un thread: sa "parent" est un Text/Forum, dont la parentId est la catégorie
      if ((ch as ThreadChannel).isThread?.()) {
        const parent = (ch as ThreadChannel).parent;              // TextChannel | ForumChannel
        const categoryId = (parent as any)?.parentId ?? null;     // catégorie du parent
        if (!categoryId) return false;

        // Par ID prioritaire si fourni, sinon par nom
        if (AMBASSADES_CATEGORY_ID) {
          return categoryId === AMBASSADES_CATEGORY_ID;
        }
        const cat = message.guild?.channels.cache.get(categoryId);
        return (cat as any)?.name === 'Ambassades';
      }

      // Si c'est un salon “classique” sous une catégorie
      const categoryId = (ch as TextChannel).parentId ?? null;
      if (!categoryId) return false;

      if (AMBASSADES_CATEGORY_ID) {
        return categoryId === AMBASSADES_CATEGORY_ID;
      }
      const cat = message.guild?.channels.cache.get(categoryId);
      return (cat as any)?.name === 'Ambassades';
    })();

    if (!inAmbassadeCategory) return;

    // 3) anti-spam 24h via fichier
    const dir = path.resolve('config');
    const filePath = path.join(dir, 'time_amb.txt');
    await fsp.mkdir(dir, { recursive: true });

    let lastTs: number | null = null;
    try {
      const raw = await fsp.readFile(filePath, 'utf8');
      const parsed = Number(raw.trim());
      if (Number.isFinite(parsed)) lastTs = parsed;
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        await botLogger.error({ op: "MESSAGE_CREATE", err });
      }
    }

    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    if (lastTs !== null && now - lastTs < DAY_MS) {
      await botLogger.debug({ op: "MESSAGE_CREATE" }, `Timestamp récent (${Math.floor((now - lastTs) / 1000)}s), sortie.`);
      return;
    }

    // 4) on écrit le nouveau timestamp
    await fsp.writeFile(filePath, String(now), 'utf8');
    await botLogger.debug({ op: "MESSAGE_CREATE" }, `Timestamp mis à jour dans ${filePath}`);

    // 5) DM à l’utilisateur cible (utilise Users.fetch pour être certain d’avoir un canal DM)
    const user = await message.client.users.fetch(targetUserId);

    const diplomaticMessages = [
      "🛸 **Nouvelle Transmission Diplomatique**\nUn message est arrivé à l’ambassade.\nNiveau d’importance : impossible à déterminer.\nNiveau de connerie : probablement élevé.",
      "📡 **ALERTE AMBASSADE**\nUn diplomate vient de parler.\nNous espérons que ce n’est pas encore une demande d’alliance en échange de *5 caisses de Laranite*.",
      "🚨 **PROTOCOLE DE PAIX… OU PAS**\nNouveau message reçu.\nMerci de lire avant de sortir les A2 et les bombes.",
      "🧠 **Communication Inter-Corpo**\nQuelqu’un a écrit un message.\nOn dirait une alliance, mais on a aussi repéré des insultes subtilement cachées.",
      "🛰️ **Transmission diplomatique**\nMessage reçu.\nSi ça parle encore d’organiser un event “Course de Mule dans Lorville”… On refuse.",
      "🛠️ **ATTENTION, TENTATIVE DE RÉUNION SÉRIEUSE**\nNouveau message à l’ambassade.\nMerci de faire semblant d’être *professionnels* pendant au moins 12 secondes.",
      "📦 **MESSAGE PRIORITAIRE**\nContenu supposé :\n- Alliance\n- Demande de taxe sur un outpost\n- Invitation à un “Event surprise” (80% de chance que ça finisse en explosion)",
      "🧊 **Dépêche Diplomatique**\nMessage reçu.\nSi ça parle encore de bloquer Orison avec des Hull-C, on ne répond pas.",
      "🚀 **TRANSMISSION RSI**\nUn message est arrivé.\nScan du contenu : ✅ mots ✅ emojis ❓ bon sens",
      "🍺 **Invitation Potentielle**\nNouveau message à l’ambassade.\nÇa pourrait être un event diplomatique autour d’un bar sur un 890 Jump.\nOu juste un mec ivre qui veut montrer son Aurora.",
      "🦾 **Contact Inter-Corporation**\nNouveau message reçu.\nRappel : Ne promettez PAS de “soutien militaire total” avant d’avoir lu tout le message.",
      "🪐 **MESSAGE CLASSÉ — TOP IMPORTANT**\nOn dirait une alliance.\nOu un spam.\nOn n’est plus sûrs.",
      "🛑 **ERREUR DE COMMUNICATION**\nNouveau message.\nProbabilité que ce soit dans le mauvais canal : **87%**.",
      "🔥 **PROTOCOLE D’URGENCE**\nNouveau message d'ambassade reçu.\nTenez prêt un diplomate… et un Fire Extinguisher, on sait jamais.",
      "💀 **ALERTE DRAMA**\nUn message vient d’arriver.\nUn seul mot dedans : “On doit parler.”\nÇa sent pas bon.",
      "🧨 **INFO ÉVÉNEMENT**\nOn dirait une proposition de rencontre pacifique.\nOn dirait aussi un piège.\nTu vas le découvrir.",
      "🌌 **RÉCEPTION DE MESSAGE**\nLe serveur t’informe que tu dois aller lire.\nNous, on s’en fout, mais le serveur insiste.",
      "🎯 **Communication d4une corpo**\nNouveau message dans l’ambassade.\nSi tu réponds avec *un gif d’explosion*, c’est encore un refus.",
      "📑 **NOTE DIPLOMATIQUE**\nQuelqu’un t’a écrit.\nEt non, tu ne peux pas répondre “ratio”.",
      "🎁 **SURPRISE !**\nUn message est arrivé.\nContenu estimé : 90% diplomatie + 10% bêtise = 100% divertissant."
    ];

    const msg = diplomaticMessages[Math.floor(Math.random() * diplomaticMessages.length)];
    await user.send(msg + '\n' + `>>> ${message.url}`);

  } catch (err) {
    await botLogger.error({ op: "MESSAGE_CREATE", err });
  }
}

    
}
