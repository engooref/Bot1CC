import { SchedulerRH } from './SchedulerRH.js';
import { BotManager } from '../../BotManager.js';
import { SchedulerAppEvent } from './SchedulerAppEvent.js';
import { SchedulerEvent } from './SchedulerEvent.js';
import { SchedulerScreen } from './SchedulerScreen.js';
import { SchedulerOperation } from './SchedulerOperation.js';

export { SchedulerAppEvent } from './SchedulerAppEvent.js';
export { SchedulerEvent } from './SchedulerEvent.js';
export { SchedulerScreen } from './SchedulerScreen.js';
export { SchedulerDemands } from './SchedulerDemands.js';
import { SchedulerMessage } from './ScheduledMessage.js';

export class SchedulerManager {
  public rh: SchedulerRH;
  public appEvent: SchedulerAppEvent;
  public event:    SchedulerEvent;
  public screen:   SchedulerScreen;
  public messages: SchedulerMessage;
  public operation: SchedulerOperation;

  constructor(bot: BotManager) {
    this.rh = new SchedulerRH(bot);
    this.appEvent = new SchedulerAppEvent(bot);
    this.event    = new SchedulerEvent(bot);
    this.screen   = new SchedulerScreen(bot);
    this.messages = new SchedulerMessage(bot);
    this.operation = new SchedulerOperation(bot);
  }
}
