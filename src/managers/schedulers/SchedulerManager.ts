import { BotManager } from '../../BotManager.js';
import { SchedulerAppEvent } from './SchedulerAppEvent.js';
import { SchedulerEvent } from './SchedulerEvent.js';
import { SchedulerScreen } from './SchedulerScreen.js';
import { SchedulerRefinery } from './SchedulerRefinery.js';

export { SchedulerAppEvent } from './SchedulerAppEvent.js';
export { SchedulerEvent } from './SchedulerEvent.js';
export { SchedulerScreen } from './SchedulerScreen.js';
export { SchedulerDemands } from './SchedulerDemands.js';
export { SchedulerRefinery } from './SchedulerRefinery.js';

export class SchedulerManager {
  public appEvent: SchedulerAppEvent;
  public event:    SchedulerEvent;
  public screen:   SchedulerScreen;
  public refinery: SchedulerRefinery;

  constructor(bot: BotManager) {
    this.appEvent = new SchedulerAppEvent(bot);
    this.event    = new SchedulerEvent(bot);
    this.screen   = new SchedulerScreen(bot);
    this.refinery = new SchedulerRefinery(bot);
  }
}
