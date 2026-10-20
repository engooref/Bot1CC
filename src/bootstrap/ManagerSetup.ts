import { ParrainageManager } from '../managers/ParrainageManager.js';
import { RecrutementManager } from '../managers/RecrutementManager.js';
import { DiploManager } from '../managers/DiploManager.js';
import { BotManager } from '../BotManager.js';
import { botLogger } from '../logger.js';
import { EventManager } from '../managers/EventManager.js';
import { UserManager } from '../managers/UserManager.js';
import { OperationModule } from '../managers/OperationManager.js';
import { TicketManager } from '../managers/TicketsManager.js';
import { ScreenManager } from '../managers/ScreenManager.js';
import { DuelManager } from '../managers/DuelManager.js';
import { GithubManager } from '../managers/GithubManager.js';
import { RefineryManager } from '../managers/RefineryManager.js';
import { MeetingManager } from '../managers/MeetingManager.js';
import { AutoMessageManager } from '../managers/AutoMessageManager.js';
import { ContractManager } from '../managers/ContractManager.js';
import { SlashCommandManager, CommandHandler } from '../utils/SlashCommandManager.js';
import { SchedulerManager } from '../managers/schedulers/SchedulerManager.js';
import { ReactionManager } from '../managers/ReactionManager.js';
import WebServer from '../web/WebServer.js';

export async function createManagers(bot: BotManager): Promise<void> {
  await botLogger.debug({ op: "BOOT" }, 'Création des Managers');

  bot.eventManager = new EventManager(bot);
  bot.userManager = new UserManager(bot);
  bot.reactionManager = new ReactionManager(bot);

  bot.operationManager = new OperationModule(bot);
  await bot.operationManager.init();

  bot.ticketManager = new TicketManager(bot);
  await bot.ticketManager.init();

  bot.screenManager = new ScreenManager(bot);
  bot.duelManager = new DuelManager(bot);
  bot.githubManager = new GithubManager(bot);

  bot.meetingManager = new MeetingManager(bot);
  bot.autoMessageManager = new AutoMessageManager(bot);
  bot.contractManager = new ContractManager(bot);
  bot.diploManager = new DiploManager(bot);
  bot.recrutementManager = new RecrutementManager(bot);
  bot.parrainageManager = new ParrainageManager(bot);

  // --- Raffinerie ---
  bot.refineryManager = new RefineryManager(bot.db.getEm(), bot);

  // Fusion dynamique des handlers exposés par chaque manager
  const handlersMap = {
    ...bot.parrainageManager.getSlashHandlers(),
    ...bot.screenManager.getSlashHandlers(),
    ...bot.eventManager.getSlashHandlers(),
    ...bot.db.getSlashHandlers(),
    ...bot.githubManager.getSlashHandlers(),
    ...bot.meetingManager.getSlashHandlers(),
    ...bot.autoMessageManager.getSlashHandlers(),
  } as Record<string, CommandHandler>;

  bot.slashCommandManager = new SlashCommandManager(bot, handlersMap);
  await bot.slashCommandManager.loadAllCommandDefinitions();

  bot.schedulerManager = new SchedulerManager(bot);

  const webServer = new WebServer(bot);
  webServer.start(parseInt(process.env.PORT!, 10));
}
