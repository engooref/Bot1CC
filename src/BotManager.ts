// src/BotManager.ts
import {
  Client,
  GatewayIntentBits,
  Guild,
  Role,
  Events,
} from 'discord.js';
import { botLogger } from './logger.js';
import { DatabaseManager } from './managers/DatabaseManager.js';
import { Parameter } from './entities/core/Parameter.js';
import { EventManager } from './managers/EventManager.js';
import { SchedulerManager } from './managers/schedulers/SchedulerManager.js';
import { RefineryManager } from './managers/RefineryManager.js';
import { UserManager } from './managers/UserManager.js';
import { SafeMethod } from './exception/Safe.js';
import { OperationModule } from './managers/OperationManager.js';
import { TicketManager } from './managers/TicketsManager.js';
import { SlashCommandManager } from './utils/SlashCommandManager.js';
import { ScreenManager } from './managers/ScreenManager.js';
import { DuelManager } from './managers/DuelManager.js';
import { GithubManager } from './managers/GithubManager.js';
import { sendEnga } from './view/EngaView.js';
import { registerDiscordEvents } from './bootstrap/DiscordEventHandlers.js';
import { registerComponentHandlers } from './bootstrap/ComponentHandlerSetup.js';
import { createManagers } from './bootstrap/ManagerSetup.js';

export class BotManager extends Client {
  public guildId: string;
  public guild!: Guild;
  public roleMember?: Role;

  public db: DatabaseManager;
  public eventManager!: EventManager;
  public userManager!: UserManager;
  public operationManager!: OperationModule;
  public ticketManager!: TicketManager;
  public schedulerManager!: SchedulerManager;
  public slashCommandManager!: SlashCommandManager;
  public screenManager!: ScreenManager;
  public duelManager!: DuelManager;
  public githubManager!: GithubManager;
  public refineryManager!: RefineryManager;
  // public refineryScheduler!: SchedulerRefinery;

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

    this.guildId = process.env.GUILD_ID!;
    this.db = new DatabaseManager(this, ['Cimetière des canaux']);

    this.once(Events.ClientReady, () => this._onReady());

    registerDiscordEvents(this);
    registerComponentHandlers(this);

    this.login(process.env.DISCORD_TOKEN!);
  }

  @SafeMethod
  private async _onReady(): Promise<void> {
    if (this.hasStarted) return;
    this.hasStarted = true;

    await this.db.connect();

    const guild = this.guilds.cache.get(this.guildId);
    if (!guild) {
      throw new Error(`Guild ${this.guildId} introuvable`);
    }
    this.guild = guild;

    const roleId = process.env.ROLE_ID;
    if (roleId) {
      this.roleMember = this.guild.roles.cache.get(roleId);
    }

    const me = await this.guild.members.fetchMe();
    await this.db.insertAndGetUser(me);

    await this.loadParameters();
    await createManagers(this);

    await botLogger.debug({ op: "BOOT" }, 'Synchronisation des Rôles');
    await this.db.syncRoles(this.guild.roles.cache);
    await botLogger.debug({ op: "BOOT" }, 'Synchronisation des Channels');
    await this.db.syncChannels(this.guild.channels.cache);

    await sendEnga(this);

    await botLogger.info({ op: "BOOT" }, `Discord connecté en tant que ${this.user?.tag}`);
  }

  /** Charge tous les paramètres depuis la BDD dans le cache `this.parameters` */
  @SafeMethod
  public async loadParameters(): Promise<void> {
    const all = await this.db.getEm().find(Parameter, {}, { populate: ['valueType', 'valueChannel', 'roles'] });
    this.parameters = {};
    for (const p of all) {
      this.parameters[p.name] = p;
    }
  }

  /** Récupère la valeur d'un paramètre déjà chargé */
  public getParameter(name: string): string | string[] {
    const p = this.parameters[name];
    if (!p) {
      throw new Error(`Le paramètre ${name} n'existe pas !`);
    }
    return p.getValue();
  }

  /**
   * Recharge les paramètres en base, puis réinitialise le scheduler d'events.
   */
  @SafeMethod
  public async refreshParameters(): Promise<void> {
    await this.loadParameters();
    this.schedulerManager.appEvent.resetScheduler();
  }
}
