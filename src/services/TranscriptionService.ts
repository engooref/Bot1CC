import { SettingKeys } from '../constants/SettingKeys.js';
import { settingsService } from './SettingsService.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getManagerLogger } from '../logger.js';

export interface TranscriptPart {
  userId: string;
  username: string;
  text: string;
  timestamp: string;
  startedAt?: string;
  endedAt?: string | null;
}

export interface TranscriptionOptions {
  language?: string;
  model?: string;
  device?: 'cpu' | 'cuda' | string;
  computeType?: string;
}

export class TranscriptionService {
  private logger = getManagerLogger('TranscriptionService');

  /**
   * Transcrit un fichier audio local avec faster-whisper.
   *
   * Dépendances serveur attendues :
   * - python3
   * - pip install faster-whisper
   *
   * Variables optionnelles :
   * - MEETING_STT_PYTHON=python3
   * - MEETING_STT_DEVICE=cpu
   * - MEETING_STT_COMPUTE_TYPE=int8
   */
  public async transcribeAudioFile(audioFilePath: string, options: TranscriptionOptions = {}): Promise<string> {
    const python = process.env.MEETING_STT_PYTHON ?? 'python3';
    const model = options.model ?? await settingsService.getString(SettingKeys.bot.meeting.transcriptionModel, 'base');
    const device = options.device ?? process.env.MEETING_STT_DEVICE ?? 'cpu';
    const computeType = options.computeType ?? process.env.MEETING_STT_COMPUTE_TYPE ?? 'int8';
    const language = options.language ?? await settingsService.getString(SettingKeys.bot.meeting.transcriptionLanguage, 'fr');

    const script = String.raw`
import json
import sys

try:
    from faster_whisper import WhisperModel
except Exception as exc:
    print(json.dumps({"error": "faster-whisper import failed", "details": str(exc)}), file=sys.stderr)
    sys.exit(2)

audio_path = sys.argv[1]
model_name = sys.argv[2]
device = sys.argv[3]
compute_type = sys.argv[4]
language = sys.argv[5]

try:
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    segments, info = model.transcribe(audio_path, language=language, vad_filter=True)
    text = " ".join(segment.text.strip() for segment in segments if segment.text and segment.text.strip())
    print(json.dumps({"text": text, "language": getattr(info, "language", language)}, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"error": "transcription failed", "details": str(exc)}), file=sys.stderr)
    sys.exit(3)
`;

    const stdout = await this.runProcess(python, ['-c', script, audioFilePath, model, device, computeType, language]);

    try {
      const payload = JSON.parse(stdout.trim() || '{}') as { text?: string };
      const text = payload.text?.trim() ?? '';
      this.logger.debug({ msg: '[TranscriptionService] fichier transcrit', audioFilePath, chars: text.length });
      return text;
    } catch (err) {
      this.logger.warn({ msg: '[TranscriptionService] sortie JSON invalide', stdout, err });
      return stdout.trim();
    }
  }

  /**
   * Compatibilité ancienne API : à éviter pour le nouveau flow.
   * Le nouveau système doit passer par transcribeAudioFile() après /reunion stop.
   */
  public async transcribeAudioBuffer(userId: string, audioBuffer: Buffer): Promise<string> {
    const tmpRoot = await mkdtemp(path.join(tmpdir(), `meeting-audio-${userId}-`));
    const tmpFile = path.join(tmpRoot, 'chunk.wav');

    try {
      await writeFile(tmpFile, audioBuffer);
      return await this.transcribeAudioFile(tmpFile);
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  }

  public async transcribeAudioChunk(userId: string, audioChunk: Buffer): Promise<string> {
    return this.transcribeAudioBuffer(userId, audioChunk);
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

      child.on('error', (err) => reject(err));
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
