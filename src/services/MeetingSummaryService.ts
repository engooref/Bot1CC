import { getManagerLogger } from '../logger.js';
import type { TranscriptPart } from './TranscriptionService.js';
import type { MeetingTimelineEntry } from './MeetingAudioStorageService.js';

export interface MeetingSummary {
  summary: string;
  decisions: string[];
  actions: string[];
  blockers: string[];
  timeline: string[];
  transcript?: string;
}

export class MeetingSummaryService {
  private logger = getManagerLogger('MeetingSummaryService');

  /**
   * Résumé heuristique local, gratuit, sans API.
   * Remplaçable plus tard par Ollama/llama.cpp si tu veux un vrai résumé IA local.
   */
  public async generateMeetingSummary(parts: TranscriptPart[], timeline: MeetingTimelineEntry[] | string[]): Promise<MeetingSummary> {
    const transcriptLines = parts
      .filter((part) => part.text.trim().length > 0)
      .map((part) => {
        const time = part.startedAt ? this.formatTime(part.startedAt) : this.formatTime(part.timestamp);
        return `[${time}] ${part.username}: ${part.text.trim()}`;
      });

    const transcript = transcriptLines.join('\n');
    const summary = this.buildShortSummary(parts);
    const decisions = this.extractByRegex(parts, /\b(d[eé]cision|d[eé]cid[eé]|valid[eé]|on valide|act[eé]|retenu|tranch[eé])\b/i, 'Aucune décision détectée.');
    const actions = this.extractByRegex(parts, /\b(action|todo|à faire|a faire|faire|préparer|preparer|assign[eé]|je m[’']occupe|deadline|pour demain|pour vendredi)\b/i, 'Aucune action détectée.');
    const blockers = this.extractByRegex(parts, /\b(bloquant|bloqu[eé]|probl[eè]me|risque|impossible|pas possible|attention|manque|blocked|blocking)\b/i, 'Aucun point bloquant détecté.');
    const formattedTimeline = Array.isArray(timeline)
      ? timeline.map((entry) => typeof entry === 'string' ? entry : `${this.formatTime(entry.at)} — ${entry.label}`)
      : [];

    this.logger.debug({ msg: '[MeetingSummaryService] rapport généré', parts: parts.length, timeline: formattedTimeline.length });

    return {
      summary,
      decisions,
      actions,
      blockers,
      timeline: formattedTimeline,
      transcript,
    };
  }

  public formatDiscordReport(report: MeetingSummary): string {
    return [
      '**Compte-rendu de réunion**',
      '',
      '**Résumé court**',
      report.summary,
      '',
      '**Décisions**',
      ...report.decisions.map((item) => `- ${item}`),
      '',
      '**Actions**',
      ...report.actions.map((item) => `- ${item}`),
      '',
      '**Points bloquants**',
      ...report.blockers.map((item) => `- ${item}`),
      '',
      '**Timeline**',
      ...report.timeline.map((item) => `- ${item}`),
    ].join('\n');
  }

  private buildShortSummary(parts: TranscriptPart[]): string {
    const meaningful = parts
      .map((part) => part.text.trim())
      .filter((text) => text.length > 0);

    if (meaningful.length === 0) {
      return 'Aucun contenu transcrit.';
    }

    const joined = meaningful.join(' ');
    if (joined.length <= 600) return joined;

    return `${joined.slice(0, 600).trim()}…`;
  }

  private extractByRegex(parts: TranscriptPart[], rx: RegExp, fallback: string): string[] {
    const matches = parts
      .filter((part) => rx.test(part.text))
      .map((part) => `${part.username}: ${part.text.trim()}`)
      .slice(0, 12);

    return matches.length > 0 ? matches : [fallback];
  }

  private formatTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
}
