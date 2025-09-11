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
} from 'discord.js';
import logger from './logger.js';
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

      ],
    });

    this.guildId   = process.env.GUILD_ID!;
    this.dbMgr = new DatabaseManager(this, ['Cimetière des canaux']);

    // Événements Discord.js
    this.once('ready', () => this._onReady());
    
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

    await logger.debug('Synchronisation des Rôles');
    await this.dbMgr.syncRoles(this.guild.roles.cache);
    await logger.debug('Synchronisation des Channels');
    await this.dbMgr.syncChannels(this.guild.channels.cache);

    await sendEnga(this);


    await logger.info(`Discord connecté en tant que ${this.user?.tag}`);
  }

  private async createManager() {
    await logger.debug('Création des Managers')
    this.evMgr = new EventManager(this);
    this.usrMgr = new UserManager(this);
    
    this.opMgr = new OperationModule(this);
    await this.opMgr.init();
    
    this.tkMgr = new TicketManager(this);
    await this.tkMgr.init();

    this.scrMgr = new ScreenManager(this);
    //this.musicMgr = new MusicManager(this);

    // Fusion dynamique des handlers exposés par chaque manager
    const handlersMap = {
      ...this.scrMgr.getSlashHandlers(),
      ...this.evMgr.getSlashHandlers(),
      ...this.dbMgr.getSlashHandlers(),
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
      await logger.info(`Création du rôle : ${role.name}`);
      const singleRoleCollection = new Collection<string, Role>();
      // 2. Ajoute ton rôle dedans (clé = id, valeur = objet role)
      singleRoleCollection.set(role.id, role);
      this.dbMgr.syncRoles(singleRoleCollection);
    } catch (e) {
      await logger.error(`onGuildRoleCreate - ${e}`);
    }
  }

  @SafeMethod
  private async _onGuildRoleDelete(role: Role) {
    try {
      const em = this.dbMgr.getEm();
      await logger.info(`Suppression du rôle : ${role.name}`);
      await em.nativeDelete(DBRole, {discordId: role.id});
    } catch (e) {
      await logger.error(`onGuildRoleDelete - ${e}`);
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
      await em.persistAndFlush(roleEntity);
      
      await logger.info(`Modification du rôle ${newRoleObj.id} : ${oldRole.name} -> ${newRoleObj.name}`);
    } catch (e) {
      await logger.error(`onGuildRoleUpdate - ${e}`);
    }
  }

  @SafeMethod
  private async _onGuildChannelCreate(channel: GuildChannel) {
    try {
      const singleChannelCollection = new Collection<string, GuildBasedChannel>();
      singleChannelCollection.set(channel.id, channel as GuildBasedChannel);
      this.dbMgr.syncChannels(singleChannelCollection);
    } catch (e) {
      await logger.error(`onGuildChannelCreate - ${e}`);
    }
  }

  @SafeMethod
  private async _onGuildChannelDelete(channel: DMChannel | GuildChannel) {
    try {
      if(channel as DMChannel) return;
      const em = this.dbMgr.getEm();
      await em.nativeDelete(Channel, {discordId: channel.id});
      await logger.info(`Suppression du canal : ${(channel as GuildChannel).name}`);
    } catch (e) {
      await logger.error(`onGuildChannelDelete - ${e}`);
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
      await em.persistAndFlush(channelEntity);
      await logger.info(`Modification du canal : ${(oldChannel as GuildChannel).name} -> ${(newChannel as GuildChannel).name}`);
    } catch (e) {
      await logger.error(`onGuildChannelUpdate - ${e}`);
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
        await await logger.info(`Modification des rôles de ${user.username}`);
        await em.persistAndFlush(user);

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
            await logger.error(
              `Erreur initMemberRh pour ${user.username} → ${err}`,
            );
            throw err;
          }
        }
      }

      // 3) Si le surnom a changé
      if (before.displayName !== after.displayName) {
        user.username = after.displayName;
        await em.persistAndFlush(user);

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
      await logger.error(`onGuildMemberUpdate - ${e}`);
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
      await logger.error(`onGuildMemberRemove - ${e}`);
    }
  }

  @SafeMethod
  public async _onInteraction(interaction: Interaction) {
    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
      const { customId, message } = interaction;

      const ctx = await this.dbMgr.getEm().findOne(InteractionContext, { customId, messageId: message?.id });
      if (!ctx) {
        await logger.debug(`Composant non trouvé -> customId: ${customId}  message: ${message}`)
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

  /**
   * Gère la création des channels vocaux d'équipe et leur suppression auto
   */
  @SafeMethod
  private async _onVoiceStateUpdate(oldState: VoiceState, newState: VoiceState) {
    const em = this.evMgr.em;
    const userId = newState.id;
    const channel = newState.channel ?? oldState.channel;
    if (!channel) return;

    // Helper: get event by parentId
    const getEventByParentId = async (parentId: string | null) => {
      if (!parentId) return null;
      return await em.findOne(Event, { discord: { vocalParentId: parentId } });
    };

    // Helper: get or create VoicePresence
    const getOrCreatePresence = async (event: Event, user: User) => {
      let presence = await em.findOne(VoicePresence, { event: event, user: user }) as InstanceType<typeof VoicePresence> | null;
      if (!presence) {
        presence = em.create(VoicePresence, {
          event,
          user,
          xp: 0,
          presence: true,
        });
        em.persist(presence);
      }
      return presence;
    };

    // Helper: move user to team channel
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
      await userState.setChannel(teamChannel.id);
    };

    // Helper: move user to "Aucune équipe" channel
    const moveToNoTeamChannel = async (
      parentId: string,
      userState: VoiceState,
      eventId: number
    ): Promise<void> => {
      let noTeamChannel = this.guild.channels.cache.find(
        (ch: any) => ch.type === ChannelType.GuildVoice && ch.parentId === parentId && ch.name === 'Aucune équipe'
      );
      if (!noTeamChannel) {
        noTeamChannel = await this.guild.channels.create({
          name: 'Aucune équipe',
          type: ChannelType.GuildVoice,
          parent: parentId,
          reason: `Création vocal "Aucune équipe" pour event ${eventId}`,
        });
      }
      await userState.setChannel(noTeamChannel.id);
    };

    // Helper: delete empty team channel and parent category if empty
    const deleteEmptyTeamChannel = async (
      channel: GuildChannel
    ): Promise<void> => {
      try {
        await channel.delete('Suppression auto : channel d\'équipe vide');
        const parentCategory = channel.parent;
        if (
          parentCategory &&
          parentCategory.type === ChannelType.GuildCategory &&
          parentCategory.children &&
          parentCategory.children.cache.filter(
            (ch: any) => ch.type === ChannelType.GuildVoice
          ).size === 0
        ) {
          await parentCategory.delete('Suppression auto : catégorie vide');
        }
      } catch (e) {
        await logger.error(`Erreur suppression channel équipe vide : ${e}`);
      }
    };

    // 1. Récupère l'event via parentId du channel (si newState.channel, sinon oldState.channel)
    let event = await getEventByParentId(channel.parentId);
    // 2. Si pas d'event avec newState, c'est qu'il a quitté la catégorie (on traite le leave)
    if (!event && oldState.channel && oldState.channel.parentId) event = await getEventByParentId(oldState.channel.parentId);
    
    if (!event) return;

    // 3. Récupère l'utilisateur
    const user = await em.findOne(User, { discordId: userId });
    if (!user) return;

    // 4. Récupère la réponse à l'event
    const resp = await em.findOne(Response, { event, users: user, typeRep: { $in: ['accepted'] } }, { populate: ['team'] });
    if (!resp) return;

    // 5. Liste des channels d'équipe
    const allTeamChannels = channel.guild.channels.cache
      .filter(ch => ch.type === ChannelType.GuildVoice && ch.parentId === event.discord.vocalParentId)
      .map(ch => ch.id);

    const isIn  = newState.channelId && allTeamChannels.includes(newState.channelId);

    // 8. Si l'utilisateur quitte le channel d'un event et sort de la catégorie
    if (isIn) {
      let presence = await getOrCreatePresence(event, user);
      await em.persistAndFlush(presence);
    }

    // 9. Si l'utilisateur est dans une équipe, on le move dans le channel équipe
    if (isIn && newState.channelId === event.discord.vocalParentId) {
      if (resp.team) {
        await moveToTeamChannel(event.discord.vocalParentId!, resp.team.name, newState, event.id);
      } else {
        await moveToNoTeamChannel(event.discord.vocalParentId!, newState, event.id);
      }
    }

    // 10. Suppression auto du channel d'équipe s'il est vide
    if (
      oldState.channel &&
      oldState.channel.type === ChannelType.GuildVoice &&
      oldState.channel.name.startsWith('Équipe ') &&
      'members' in oldState.channel &&
      oldState.channel.members instanceof Collection &&
      oldState.channel.members.size === 0
    ) {
      await deleteEmptyTeamChannel(oldState.channel);
    }
  }
}
