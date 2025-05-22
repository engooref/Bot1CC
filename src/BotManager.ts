// src/BotManager.ts
import { 
  Client, GatewayIntentBits, Guild, Role, Message, GuildChannel, GuildBasedChannel, 
  DMChannel, Collection, GuildMember, 
  PartialGuildMember,
  Interaction,
  StringSelectMenuInteraction,
  TextChannel,
  ButtonInteraction
} from 'discord.js';
import logger from './logger.js';
import DatabaseManager from './managers/DatabaseManager.js';
import { Role as DBRole } from './entities/Role.js';
import { Parameter } from './entities/Parameter.js';
import EventManager  from './managers/EventManager.js';
// import type TicketManager    from './managers/TicketManager.js';
// import type OperationManager from './managers/OperationManager.js';
import SchedulerManager from './managers/SchedulerManager.js';

import { Channel } from './entities/Channel.js';
import { User } from './entities/User.js';
import UserManager from './managers/UserManager.js';
import { Event } from './entities/Event.js';
import { Response } from './entities/Response.js';
import { componentHandlerRegistry } from './registry/ComponentHandlerRegistry.js';
import { ViewHandlers } from './view/BaseView.js';
import { InteractionContext } from './entities/ViewContext.js';

export default class BotManager extends Client {
  public guildId: string;
  public guild!: Guild;
  public roleMember?: Role;
  public dbMgr: DatabaseManager;
  public evMgr: EventManager;
  public usrMgr: UserManager;

  // public ticketMgr: TicketManager;
  // public opMgr: OperationManager;
  public schedMgr: SchedulerManager;
  private hasStarted = false;
  private parameters: Record<string, Parameter> = {};

  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
      ],
    });

    this.guildId   = process.env.GUILD_ID!;
    this.dbMgr = new DatabaseManager(this, ['Cimetière des canaux']);
    this.dbMgr.connect();

    this.evMgr = new EventManager(this);
    this.usrMgr = new UserManager(this);

    // this.ticketMgr = options.ticketMgr;
    // this.opMgr     = options.opMgr;
    this.schedMgr  = new SchedulerManager(this);

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
  }

  private setHandlersButtons() {
    // clés libres, tant qu’elles sont uniques
    componentHandlerRegistry.register(ViewHandlers.InviteViewHandler, async (interaction, data) => {
      await this.evMgr.userResponseHandle(interaction as ButtonInteraction, data);
    });

    componentHandlerRegistry.register(ViewHandlers.SelectRoleHandler, async (interaction, data) => {
      await this.evMgr.userResponseHandle(interaction as ButtonInteraction, data);
    });

  }

  private async _onReady(): Promise<void> {
    if (this.hasStarted) return;
    this.hasStarted = true;

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

    this.loadParameters();

    const me = await this.guild.members.fetchMe();
    await this.dbMgr.insertAndGetUser(me);


    // Démarrage des managers (exemples commentés)
    // if (this.ticketMgr) await this.ticketMgr.createInitialTickets(this.guild);
    // if (this.opMgr)     await this.opMgr.ensureChannels(this.guild);
    await this.dbMgr.syncRoles(this.guild.roles.cache);
    await this.dbMgr.syncChannels(this.guild.channels.cache);


    logger.info(`Discord connecté en tant que ${this.user?.tag}`);
  }

  private async _onGuildRoleCreate(role: Role) {
    try {
      logger.info(`Création du rôle : ${role.name}`);
      const singleRoleCollection = new Collection<string, Role>();
      // 2. Ajoute ton rôle dedans (clé = id, valeur = objet role)
      singleRoleCollection.set(role.id, role);
      this.dbMgr.syncRoles(singleRoleCollection);
    } catch (e) {
      logger.error(`onGuildRoleCreate - ${e}`);
    }
  }

  private async _onGuildRoleDelete(role: Role) {
    try {
      logger.info(`Suppression du rôle : ${role.name}`);
      const roleDb = this.dbMgr.getEm().findOne(DBRole, {discordId: role.id})
      if (roleDb) await this.dbMgr.getEm().removeAndFlush(roleDb);
    } catch (e) {
      logger.error(`onGuildRoleDelete - ${e}`);
    }
  }

  private async _onGuildRoleUpdate(oldRole: Role, newRoleObj: Role) {
    try {
      const roleEntity = await this.dbMgr.getEm().findOne(
        DBRole, {discordId:   newRoleObj.id }
      );

      if (!roleEntity) return;

      roleEntity.name = newRoleObj.name;
      roleEntity.isGrade = newRoleObj.hoist;
      await this.dbMgr.update(roleEntity);
      
      logger.info(
        `Modification du rôle ${newRoleObj.id} : ${oldRole.name} -> ${newRoleObj.name}`,
      );
    } catch (e) {
      logger.error(`onGuildRoleUpdate - ${e}`);
    }
  }

  private async _onGuildChannelCreate(channel: GuildChannel) {
    try {
      const singleChannelCollection = new Collection<string, GuildBasedChannel>();
      singleChannelCollection.set(channel.id, channel as GuildBasedChannel);
      this.dbMgr.syncChannels(singleChannelCollection);
    } catch (e) {
      logger.error(`onGuildChannelCreate - ${e}`);
    }
  }

  private async _onGuildChannelDelete(channel: DMChannel | GuildChannel) {
    try {
      if(channel as DMChannel) return;
      const channelEntity = await this.dbMgr.getEm().findOne(Channel, {discordId: channel.id});
      if (channelEntity) await this.dbMgr.getEm().removeAndFlush(channelEntity);
      logger.info(`Suppression du canal : ${(channel as GuildChannel).name}`);
    } catch (e) {
      logger.error(`onGuildChannelDelete - ${e}`);
    }
  }

  private async _onGuildChannelUpdate(
    oldChannel: DMChannel | GuildChannel,
    newChannel: DMChannel | GuildChannel
  ) {
    try {
      if(newChannel as DMChannel) return;
      if ((oldChannel as GuildChannel).name === (newChannel as GuildChannel).name) return;

      const channelEntity = await this.dbMgr.getEm().findOne(Channel, {discordId: newChannel.id});
      if (!channelEntity) return;

      channelEntity.name = (newChannel as GuildChannel).name;
      await this.dbMgr.update(channelEntity);
      logger.info(
        `Modification du canal : ${(oldChannel as GuildChannel).name} -> ${(newChannel as GuildChannel).name}`,
      );
    } catch (e) {
      logger.error(`onGuildChannelUpdate - ${e}`);
    }
  }

  private async _onGuildMemberUpdate(
    before: GuildMember | PartialGuildMember,
    after: GuildMember,
  ) {
    try {
      // 1) Récupère ou crée l’utilisateur en bdd
      let user = await this.dbMgr.getEm().findOne(
        User,
        { discordId: after.id },
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
          await this.dbMgr.getEm().removeAndFlush(user);
          return;
        }

        // (optionnel) synchronise toutes les nouvelles Roles en bdd
        await this.dbMgr.syncRoles(newRoles);

        let changeGrade = false;

        // AJOUT de rôles
        for (const r of newRoles.values()) {
          const dbRole = await this.dbMgr.getEm().findOne(
            DBRole,
            { discordId: r.id },
          );
          if (dbRole && !user.rolesDiscord.contains(dbRole)) {
            changeGrade = changeGrade || dbRole.isGrade;
            user.rolesDiscord.add(dbRole);
          }
        }

        // RETRAIT de rôles
        for (const r of removedRoles.values()) {
          const dbRole = await this.dbMgr.getEm().findOne(
            DBRole,
            { discordId: r.id },
          );
          if (dbRole && user.rolesDiscord.contains(dbRole)) {
            changeGrade = changeGrade || dbRole.isGrade;
            user.rolesDiscord.remove(dbRole);
          }
        }

        // trace + flush
        await logger.info(`Modification des rôles de ${user.username}`);
        await this.dbMgr.update(user);

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
            logger.error(
              `Erreur initMemberRh pour ${user.username} → ${err}`,
            );
            throw err;
          }
        }
      }

      // 3) Si le surnom a changé
      if (before.displayName !== after.displayName) {
        user.username = after.displayName;
        await this.dbMgr.update(user);

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
        const events = await this.dbMgr.getEm().find(Event, {
          start:  { 
            $gte: startOfMonth,
            $lte: endOfMonth, 
          }, 
        }, {
          populate: ['*', 'responses.users'],
        });

        // pour chaque event où l’utilisateur a déjà répondu…
        for (const event of events) {
          const resp = await this.dbMgr.getEm().findOne(
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
      logger.error(`onGuildMemberUpdate - ${e}`);
    }
  }

  private async _onGuildMemberRemove(member: GuildMember | PartialGuildMember) {
    try {
      const user = await this.dbMgr.getEm().findOne(
        User,
        { discordId: member.id },
        { populate: false },
      );
      if (!user) return;
      await this.usrMgr.deleteUser(user);
    } catch (e) {
      logger.error(`onGuildMemberRemove - ${e}`);
    }
  }

  public async _onInteraction(interaction: Interaction) {
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      const { customId, message } = interaction;
      const ctx = await this.dbMgr.getEm().findOne(InteractionContext, { customId, messageId: message.id });
      if (!ctx) return interaction.reply({ content: 'Ce composant a expiré.', ephemeral: true });
      const handler = componentHandlerRegistry.get(ctx.handlerKey);
      if (handler) await handler(interaction, ctx.data);
    }

    
      // cas du bouton “closeTicket_…”
      // if (customId.startsWith('closeTicket')) {
      //   const [, closeButtonId] = customId.split('_');
      //   await interaction.showModal(
      //     Ticket.CloseTicketModal(closeButtonId, interaction.channel!)
      //   );
      // }
  }

  /** Charge tous les paramètres depuis la BDD dans le cache `this.parameters` */
  public async loadParameters(): Promise<void> {
    // Supposons que db.selectAll renvoie une liste d'instances de Parameter
    const all = await this.dbMgr.getEm().findAll(Parameter, {populate: ["*"]});
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
  public async refreshParameters(): Promise<void> {
    await this.loadParameters();
    // Appelle la méthode correspondante de ton scheduler
    this.schedMgr.appEvent.resetScheduler();
  }
}
