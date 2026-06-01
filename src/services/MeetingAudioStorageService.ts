import { createWriteStream, WriteStream } from 'node:fs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getManagerLogger } from '../logger.js';

export interface MeetingTimelineEntry {
  type: 'START' | 'PAUSE_TRANSCRIPTION' | 'RESUME_TRANSCRIPTION' | 'STOP' | 'INFO' | 'ERROR';
  at: string;
  label: string;
  metadata?: Record<string, unknown>;
}

export interface MeetingAudioSegment {
  id: string;
  userId: string;
  username: string;
  startedAt: string;
  endedAt: string | null;
  relativeStartMs: number;
  relativeEndMs: number | null;
  rawPcmPath: string;
  wavPath: string;
  sampleRate: 48000;
  channels: 2;
  format: 's16le';
  byteLength: number;
  status: 'open' | 'closed' | 'discarded';
}

export interface MeetingStorageContext {
  meetingId: string;
  rootDir: string;
  audioDir: string;
  startedAt: string;
  endedAt: string | null;
  timeline: MeetingTimelineEntry[];
  segments: MeetingAudioSegment[];
}

export interface ActiveAudioSegment {
  segment: MeetingAudioSegment;
  stream: WriteStream;
}

export class MeetingAudioStorageService {
  private logger = getManagerLogger('MeetingAudioStorageService');
  private activeWriters = new Map<string, WriteStream>();

  public async createMeeting(): Promise<MeetingStorageContext> {
    const meetingId = this.createMeetingId();
    const rootBase = process.env.MEETING_TMP_DIR ?? path.join(process.cwd(), 'storage', 'meetings', 'tmp');
    const rootDir = path.join(rootBase, meetingId);
    const audioDir = path.join(rootDir, 'audio');

    await mkdir(audioDir, { recursive: true });

    const context: MeetingStorageContext = {
      meetingId,
      rootDir,
      audioDir,
      startedAt: new Date().toISOString(),
      endedAt: null,
      timeline: [],
      segments: [],
    };

    this.addTimelineMarker(context, 'START', 'Début de réunion');
    await this.persist(context);

    this.logger.info({ msg: '[MeetingAudioStorageService] dossier meeting créé', meetingId, rootDir });
    return context;
  }

  public addTimelineMarker(
    context: MeetingStorageContext,
    type: MeetingTimelineEntry['type'],
    label: string,
    metadata?: Record<string, unknown>,
  ): void {
    context.timeline.push({
      type,
      label,
      at: new Date().toISOString(),
      metadata,
    });
  }

  public async startSegment(context: MeetingStorageContext, userId: string, username: string): Promise<ActiveAudioSegment> {
    const id = randomUUID();
    const now = new Date();
    const relativeStartMs = now.getTime() - new Date(context.startedAt).getTime();
    const rawPcmPath = path.join(context.audioDir, `${id}.pcm`);
    const wavPath = path.join(context.audioDir, `${id}.wav`);

    const segment: MeetingAudioSegment = {
      id,
      userId,
      username,
      startedAt: now.toISOString(),
      endedAt: null,
      relativeStartMs,
      relativeEndMs: null,
      rawPcmPath,
      wavPath,
      sampleRate: 48000,
      channels: 2,
      format: 's16le',
      byteLength: 0,
      status: 'open',
    };

    const stream = createWriteStream(rawPcmPath, { flags: 'a' });
    this.activeWriters.set(id, stream);
    context.segments.push(segment);
    await this.persist(context);

    this.logger.debug({ msg: '[MeetingAudioStorageService] segment audio ouvert', meetingId: context.meetingId, segmentId: id, userId });
    return { segment, stream };
  }

  public writePcm(context: MeetingStorageContext, segmentId: string, chunk: Buffer): void {
    const segment = context.segments.find((item) => item.id === segmentId);
    const writer = this.activeWriters.get(segmentId);

    if (!segment || !writer || segment.status !== 'open') return;

    segment.byteLength += chunk.length;
    writer.write(chunk);
  }

  public async finishSegment(context: MeetingStorageContext, segmentId: string): Promise<void> {
    const segment = context.segments.find((item) => item.id === segmentId);
    const writer = this.activeWriters.get(segmentId);

    if (!segment || segment.status !== 'open') return;

    const now = new Date();
    segment.endedAt = now.toISOString();
    segment.relativeEndMs = now.getTime() - new Date(context.startedAt).getTime();
    segment.status = segment.byteLength > 0 ? 'closed' : 'discarded';

    if (writer) {
      await new Promise<void>((resolve) => {
        writer.once('finish', resolve);
        writer.end();
      });
      this.activeWriters.delete(segmentId);
    }

    await this.persist(context);
    this.logger.debug({ msg: '[MeetingAudioStorageService] segment audio finalisé', segmentId, status: segment.status, bytes: segment.byteLength });
  }

  public async discardSegment(context: MeetingStorageContext, segmentId: string): Promise<void> {
    const segment = context.segments.find((item) => item.id === segmentId);
    const writer = this.activeWriters.get(segmentId);

    if (!segment) return;

    segment.status = 'discarded';
    segment.endedAt = new Date().toISOString();

    if (writer) {
      try {
        writer.destroy();
      } catch {}
      this.activeWriters.delete(segmentId);
    }

    try {
      await rm(segment.rawPcmPath, { force: true });
    } catch {}

    await this.persist(context);
  }

  public async finishMeeting(context: MeetingStorageContext): Promise<void> {
    context.endedAt = new Date().toISOString();
    this.addTimelineMarker(context, 'STOP', 'Fin de réunion');

    for (const segment of context.segments.filter((item) => item.status === 'open')) {
      await this.finishSegment(context, segment.id);
    }

    await this.persist(context);
  }

  public async cleanupMeeting(context: MeetingStorageContext): Promise<void> {
    await rm(context.rootDir, { recursive: true, force: true });
    this.logger.info({ msg: '[MeetingAudioStorageService] fichiers temporaires supprimés', meetingId: context.meetingId });
  }

  public async persist(context: MeetingStorageContext): Promise<void> {
    await mkdir(context.rootDir, { recursive: true });
    await writeFile(path.join(context.rootDir, 'manifest.json'), JSON.stringify(context, null, 2), 'utf8');
    await writeFile(path.join(context.rootDir, 'timeline.json'), JSON.stringify(context.timeline, null, 2), 'utf8');
  }

  private createMeetingId(): string {
    const datePart = new Date().toISOString().replace(/[:.]/g, '-');
    return `${datePart}_${randomUUID()}`;
  }
}
