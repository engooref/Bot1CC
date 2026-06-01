import { ChatInputCommandInteraction } from 'discord.js';
import { BotManager } from '../BotManager.js';
import { getManagerLogger } from '../logger.js';
import { MeetingRecorder } from '../services/MeetingRecorder.js';

export class MeetingManager {
  private recorder: MeetingRecorder;
  private logger = getManagerLogger('MeetingManager');

  constructor(private bot: BotManager) {
    this.recorder = new MeetingRecorder(bot);
  }

  public getSlashHandlers() {
    return {
      meetingHandler: this.handleCommand.bind(this),
    } as Record<string, (interaction: ChatInputCommandInteraction) => Promise<void>>;
  }

  private async handleCommand(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'start':
        await this.recorder.startMeeting(interaction);
        break;
      case 'pause':
        await this.recorder.pauseMeeting(interaction);
        break;
      case 'resume':
        await this.recorder.resumeMeeting(interaction);
        break;
      case 'stop':
        await this.recorder.stopMeeting(interaction);
        break;
      default:
        await interaction.editReply({ content: 'Commande inconnue.' });
    }
  }
}
