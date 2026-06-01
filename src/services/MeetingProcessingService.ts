import { spawn } from 'node:child_process';
import { getManagerLogger } from '../logger.js';
import { TranscriptionService, TranscriptPart } from './TranscriptionService.js';
import { MeetingSummaryService, MeetingSummary } from './MeetingSummaryService.js';
import type { MeetingStorageContext, MeetingAudioSegment } from './MeetingAudioStorageService.js';

export interface MeetingProcessingResult {
  transcriptParts: TranscriptPart[];
  report: MeetingSummary;
}

export class MeetingProcessingService {
  private logger = getManagerLogger('MeetingProcessingService');

  constructor(
    private transcription = new TranscriptionService(),
    private summary = new MeetingSummaryService(),
  ) {}

  public async processMeeting(context: MeetingStorageContext): Promise<MeetingProcessingResult> {
    this.logger.info({ msg: '[MeetingProcessingService] traitement post-réunion démarré', meetingId: context.meetingId, segments: context.segments.length });

    const usableSegments = context.segments
      .filter((segment) => segment.status === 'closed' && segment.byteLength > 0)
      .sort((a, b) => a.relativeStartMs - b.relativeStartMs);

    const transcriptParts: TranscriptPart[] = [];

    for (const segment of usableSegments) {
      try {
        await this.convertPcmToWav(segment);
        const text = await this.transcription.transcribeAudioFile(segment.wavPath);

        if (!text.trim()) continue;

        transcriptParts.push({
          userId: segment.userId,
          username: segment.username,
          text: text.trim(),
          timestamp: segment.startedAt,
          startedAt: segment.startedAt,
          endedAt: segment.endedAt,
        });
      } catch (err) {
        this.logger.warn({ msg: '[MeetingProcessingService] segment ignoré après erreur', segmentId: segment.id, err });
      }
    }

    const report = await this.summary.generateMeetingSummary(transcriptParts, context.timeline);

    this.logger.info({ msg: '[MeetingProcessingService] traitement post-réunion terminé', meetingId: context.meetingId, transcriptParts: transcriptParts.length });

    return { transcriptParts, report };
  }

  private async convertPcmToWav(segment: MeetingAudioSegment): Promise<void> {
    const ffmpeg = process.env.MEETING_FFMPEG_PATH ?? 'ffmpeg';

    await this.runProcess(ffmpeg, [
      '-y',
      '-f', 's16le',
      '-ar', String(segment.sampleRate),
      '-ac', String(segment.channels),
      '-i', segment.rawPcmPath,
      '-ac', '1',
      '-ar', '16000',
      segment.wavPath,
    ]);

    this.logger.debug({ msg: '[MeetingProcessingService] segment converti en wav', segmentId: segment.id, wavPath: segment.wavPath });
  }

  private async runProcess(command: string, args: string[]): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });

      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
          return;
        }

        reject(new Error(`${command} exited with code ${code}: ${stderr || stdout}`));
      });
    });
  }
}
