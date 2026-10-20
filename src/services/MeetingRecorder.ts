import { SettingKeys } from '../constants/SettingKeys.js';
import { settingsService } from './SettingsService.js';
import { ChatInputCommandInteraction, TextChannel } from 'discord.js';
import { joinVoiceChannel, EndBehaviorType, VoiceConnection } from '@discordjs/voice';
import * as prism from 'prism-media';
import { getManagerLogger } from '../logger.js';
import { MeetingSummaryService } from './MeetingSummaryService.js';
import { MeetingAudioStorageService, MeetingStorageContext } from './MeetingAudioStorageService.js';
import { MeetingProcessingService } from './MeetingProcessingService.js';
import { BotManager } from '../BotManager.js';
import type { TranscriptPart } from './TranscriptionService.js';

interface ActiveCapture {
  stream: NodeJS.ReadableStream;
  decoder: NodeJS.ReadWriteStream;
  segmentId: string;
}

export interface MeetingState {
  active: boolean;
  paused: boolean;
  processing: boolean;
  guildId: string | null;
  textChannelId: string | null;
  voiceChannelId: string | null;
  connection: VoiceConnection | null;
  activeStreams: Map<string, NodeJS.ReadableStream>;
  transcriptParts: TranscriptPart[];
  timeline: string[];
  startedAt: Date | null;
  storageContext: MeetingStorageContext | null;
}

export class MeetingRecorder {
  public meetingState: MeetingState;
  private logger = getManagerLogger('MeetingRecorder');
  private audioStorage = new MeetingAudioStorageService();
  private summary = new MeetingSummaryService();
  private processing = new MeetingProcessingService(undefined, this.summary);
  private activeCaptures = new Map<string, ActiveCapture>();

  constructor(private bot: BotManager) {
    this.meetingState = this.createEmptyState();
  }

  private createEmptyState(): MeetingState {
    return {
      active: false,
      paused: false,
      processing: false,
      guildId: null,
      textChannelId: null,
      voiceChannelId: null,
      connection: null,
      activeStreams: new Map(),
      transcriptParts: [],
      timeline: [],
      startedAt: null,
      storageContext: null,
    };
  }

  private canCapture(): boolean {
    return this.meetingState.active && !this.meetingState.paused && !!this.meetingState.storageContext;
  }

  public async startMeeting(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const memberAny = (interaction.member as any) ?? (await interaction.guild?.members.fetch(interaction.user.id));
      const voiceChannel = memberAny?.voice?.channel;

      if (!voiceChannel) {
        await interaction.editReply({ content: '⛔ Vous devez être dans un salon vocal pour lancer la réunion.' });
        return;
      }

      if (this.meetingState.active) {
        await interaction.editReply({ content: '⚠️ Une réunion est déjà active.' });
        return;
      }

      if (this.meetingState.processing) {
        await interaction.editReply({ content: '⏳ Un rapport est encore en cours de génération. Attendez la fin avant de lancer une nouvelle réunion.' });
        return;
      }

      const storageContext = await this.audioStorage.createMeeting();

      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guildId!,
        adapterCreator: (interaction.guild as any).voiceAdapterCreator,
        selfDeaf: false,
      });

      this.meetingState.active = true;
      this.meetingState.paused = false;
      this.meetingState.processing = false;
      this.meetingState.guildId = interaction.guildId ?? null;
      this.meetingState.textChannelId = interaction.channelId ?? null;
      this.meetingState.voiceChannelId = voiceChannel.id;
      this.meetingState.connection = connection;
      this.meetingState.startedAt = new Date(storageContext.startedAt);
      this.meetingState.storageContext = storageContext;
      this.meetingState.timeline = storageContext.timeline.map((entry) => `${entry.label} ${entry.at}`);

      const receiver = connection.receiver;
      receiver.speaking.on('start', (userId: string) => {
        void this.handleSpeakingStart(userId);
      });

      this.logger.info({ msg: '[MeetingRecorder] réunion démarrée', meetingId: storageContext.meetingId });

      const textChannel = interaction.channel as TextChannel | null;
      if (textChannel) {
        await textChannel.send('🔴 Enregistrement de réunion actif — utilisez `/reunion pause` pour suspendre toute capture audio. Le rapport sera généré après `/reunion stop`.');
      }

      await interaction.editReply({ content: '✅ Réunion démarrée — le bot a rejoint le vocal.' });
    } catch (err) {
      this.logger.error({ msg: '[MeetingRecorder] erreur startMeeting', err });
      try {
        await interaction.editReply({ content: '⚠️ Impossible de démarrer la réunion.' });
      } catch {}
    }
  }

  private async handleSpeakingStart(userId: string): Promise<void> {
    if (!this.canCapture()) return;

    const conn = this.meetingState.connection;
    const context = this.meetingState.storageContext;

    if (!conn || !context) return;
    if (this.activeCaptures.has(userId)) return;

    const username = this.resolveUsername(userId);

    let stream: NodeJS.ReadableStream;
    try {
      stream = conn.receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
      });
    } catch (err) {
      this.logger.warn({ msg: '[MeetingRecorder] impossible de subscribe', err, userId });
      return;
    }

    const activeSegment = await this.audioStorage.startSegment(context, userId, username);
    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 }) as NodeJS.ReadWriteStream;

    const capture: ActiveCapture = {
      stream,
      decoder,
      segmentId: activeSegment.segment.id,
    };

    this.activeCaptures.set(userId, capture);
    this.meetingState.activeStreams.set(userId, stream);

    stream.on('data', (chunk: Buffer) => {
      if (!this.canCapture()) return;

      try {
        decoder.write(chunk);
      } catch (err) {
        this.logger.warn({ msg: '[MeetingRecorder] erreur écriture decoder opus', err, userId });
      }
    });

    decoder.on('data', (pcmChunk: Buffer) => {
      if (!this.canCapture()) return;
      this.audioStorage.writePcm(context, activeSegment.segment.id, pcmChunk);
    });

    stream.on('end', () => {
      void this.closeCapture(userId, 'stream_end', false);
    });

    stream.on('error', (err: any) => {
      this.logger.warn({ msg: '[MeetingRecorder] stream error', err, userId });
      void this.closeCapture(userId, 'stream_error', true);
    });

    decoder.on('error', (err: any) => {
      this.logger.warn({ msg: '[MeetingRecorder] decoder opus error', err, userId });
      void this.closeCapture(userId, 'decoder_error', true);
    });
  }

  private async closeCapture(userId: string, reason: string, destroyStream: boolean): Promise<void> {
    const context = this.meetingState.storageContext;
    const capture = this.activeCaptures.get(userId);

    if (!context || !capture) return;

    this.activeCaptures.delete(userId);
    this.meetingState.activeStreams.delete(userId);

    if (destroyStream) {
      try {
        (capture.stream as any).destroy?.();
      } catch (err) {
        this.logger.warn({ msg: '[MeetingRecorder] erreur destruction stream', err, userId });
      }
    }

    await this.flushDecoder(capture.decoder);

    await this.audioStorage.finishSegment(context, capture.segmentId);
    this.logger.info({ msg: '[MeetingRecorder] stream détruit', userId, reason });
  }

  private async flushDecoder(decoder: NodeJS.ReadWriteStream): Promise<void> {
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };

      decoder.once('end', finish);
      decoder.once('finish', finish);
      decoder.once('close', finish);
      decoder.once('error', finish);

      try {
        (decoder as any).end?.();
      } catch {
        finish();
      }

      setTimeout(finish, 250);
    });
  }

  private async closeAllCaptures(reason: string): Promise<void> {
    const userIds = [...this.activeCaptures.keys()];

    for (const userId of userIds) {
      await this.closeCapture(userId, reason, true);
    }

    this.activeCaptures.clear();
    this.meetingState.activeStreams.clear();
  }

  private resolveUsername(userId: string): string {
    try {
      const member = this.bot.guild?.members.cache.get(userId);
      if (member) return (member as any).displayName ?? (member as any).user?.username ?? userId;
    } catch {}

    return `user:${userId}`;
  }

  public async pauseMeeting(interaction?: ChatInputCommandInteraction): Promise<void> {
    if (!this.meetingState.active) {
      if (interaction) await interaction.editReply({ content: '⚠️ Aucune réunion active.' });
      return;
    }

    if (this.meetingState.paused) {
      if (interaction) await interaction.editReply({ content: 'ℹ️ La capture audio est déjà en pause.' });
      return;
    }

    this.meetingState.paused = true;

    const context = this.meetingState.storageContext;
    if (context) {
      this.audioStorage.addTimelineMarker(context, 'PAUSE_TRANSCRIPTION', 'Pause transcription');
      await this.audioStorage.persist(context);
      this.meetingState.timeline = context.timeline.map((entry) => `${entry.label} ${entry.at}`);
    }

    await this.closeAllCaptures('pause');

    this.logger.info('[MeetingRecorder] transcription en pause');

    if (interaction) {
      await interaction.editReply({ content: '⏸️ Capture audio mise en pause pour toute la réunion. Aucun audio n’est stocké pendant la pause.' });
    }
  }

  public async resumeMeeting(interaction?: ChatInputCommandInteraction): Promise<void> {
    if (!this.meetingState.active) {
      if (interaction) await interaction.editReply({ content: '⚠️ Aucune réunion active.' });
      return;
    }

    if (!this.meetingState.paused) {
      if (interaction) await interaction.editReply({ content: 'ℹ️ La capture audio est déjà active.' });
      return;
    }

    this.meetingState.paused = false;

    const context = this.meetingState.storageContext;
    if (context) {
      this.audioStorage.addTimelineMarker(context, 'RESUME_TRANSCRIPTION', 'Reprise transcription');
      await this.audioStorage.persist(context);
      this.meetingState.timeline = context.timeline.map((entry) => `${entry.label} ${entry.at}`);
    }

    this.logger.info('[MeetingRecorder] transcription reprise');

    if (interaction) {
      await interaction.editReply({ content: '▶️ Capture audio reprise. Le bot attend les prochains speakers.' });
    }
  }

  public async stopMeeting(interaction?: ChatInputCommandInteraction): Promise<void> {
    if (!this.meetingState.active) {
      if (interaction) await interaction.editReply({ content: '⚠️ Aucune réunion active.' });
      return;
    }

    const context = this.meetingState.storageContext;
    const guildId = this.meetingState.guildId;
    const textChannelId = this.meetingState.textChannelId;

    this.meetingState.active = false;
    this.meetingState.paused = false;
    this.meetingState.processing = true;

    await this.closeAllCaptures('stop');

    if (context) {
      await this.audioStorage.finishMeeting(context);
    }

    try {
      this.meetingState.connection?.destroy();
      this.meetingState.connection = null;
    } catch (err) {
      this.logger.warn({ msg: '[MeetingRecorder] erreur fermeture connection', err });
    }

    this.logger.info('[MeetingRecorder] réunion arrêtée');

    if (interaction) {
      await interaction.editReply({
        content: '⏳ Réunion arrêtée. Génération du rapport en cours. La transcription CPU peut prendre plusieurs minutes selon la durée de la réunion.',
      });
    }

    if (!context) {
      this.resetStateAfterProcessing();
      return;
    }

    void this.processStoppedMeeting(context, guildId, textChannelId);
  }

  private async processStoppedMeeting(context: MeetingStorageContext, guildId: string | null, textChannelId: string | null): Promise<void> {
    try {
      const result = await this.processing.processMeeting(context);
      this.meetingState.transcriptParts = result.transcriptParts;

      const channel = this.resolveTextChannel(guildId, textChannelId);
      if (channel) {
        const content = this.summary.formatDiscordReport(result.report);
        for (const chunk of this.splitDiscordMessage(content)) {
          await channel.send({ content: chunk });
        }
      }

      if (!await settingsService.getBool(SettingKeys.bot.meeting.keepAudio)) {
        await this.audioStorage.cleanupMeeting(context);
      }
    } catch (err) {
      this.logger.error({ msg: '[MeetingRecorder] erreur génération rapport', err });

      const channel = this.resolveTextChannel(guildId, textChannelId);
      if (channel) {
        await channel.send({
          content: `⚠️ Erreur pendant la génération du rapport. Les fichiers temporaires sont conservés pour debug : \`${context.rootDir}\``,
        });
      }
    } finally {
      this.resetStateAfterProcessing();
    }
  }

  private resolveTextChannel(guildId: string | null, textChannelId: string | null): TextChannel | null {
    if (!guildId || !textChannelId) return null;

    const guild = this.bot.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(textChannelId) as TextChannel | undefined;

    return channel ?? null;
  }

  private splitDiscordMessage(content: string, maxLength = 1900): string[] {
    if (content.length <= maxLength) return [content];

    const chunks: string[] = [];
    let current = '';

    for (const line of content.split('\n')) {
      if ((current + '\n' + line).length > maxLength) {
        chunks.push(current.trim());
        current = line;
      } else {
        current += current ? `\n${line}` : line;
      }
    }

    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  private resetStateAfterProcessing(): void {
    const wasProcessing = this.meetingState.processing;
    this.meetingState = this.createEmptyState();
    this.meetingState.processing = false;

    if (wasProcessing) {
      this.logger.info('[MeetingRecorder] état réunion réinitialisé');
    }
  }
}
