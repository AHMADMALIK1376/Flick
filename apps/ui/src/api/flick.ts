// Every backend endpoint as one typed function.
// Full list with details: backend/README.md
import { request } from './client';
import { desktop } from '../desktop';
import { connection } from './connection';
import type {
  Answer,
  AskAudioResult,
  Deck,
  DeckSummary,
  ModelOption,
  PredictedQuestion,
  PresentStatus,
  Settings,
  SettingsUpdate,
  Status,
} from './types';

export const api = {
  // ── Health, settings, status ──
  health: () => request<{ ok: boolean; version: string }>('GET', '/health'),
  getSettings: () => request<Settings>('GET', '/settings'),
  updateSettings: (changes: SettingsUpdate) => request<Settings>('PATCH', '/settings', changes),
  status: () => request<Status>('GET', '/status'),
  models: () => request<ModelOption[]>('GET', '/models'),
  testKey: () => request<{ ok: boolean; reason?: string }>('POST', '/settings/test-key'),

  // ── Presentations (decks) ──
  listDecks: () => request<DeckSummary[]>('GET', '/decks'),
  activeDeck: () => request<Deck | null>('GET', '/decks/active'),
  getDeck: (id: string) => request<Deck>('GET', `/decks/${id}`),
  loadFromPowerPoint: () => request<DeckSummary>('POST', '/decks/from-powerpoint'),
  loadFromPath: (path: string) => request<DeckSummary>('POST', '/decks/from-path', { path }),
  uploadDeck: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    // On the desktop, the file's real path lets "Present for me" open it in PowerPoint.
    const path = desktop?.pathForFile?.(file);
    if (path) form.append('path', path);
    return request<DeckSummary>('POST', '/decks/upload', form);
  },
  activateDeck: (id: string) => request<DeckSummary[]>('POST', `/decks/${id}/activate`),
  prepareDeck: (id: string) => request<{ started: boolean }>('POST', `/decks/${id}/prepare`),
  deleteDeck: (id: string) => request<DeckSummary[]>('DELETE', `/decks/${id}`),

  // ── Prepared questions ──
  addQuestion: (deckId: string, q: { slide: number; question: string; answer: string }) =>
    request<PredictedQuestion>('POST', `/decks/${deckId}/questions`, q),
  editQuestion: (id: string, changes: { slide?: number; question?: string; answer?: string }) =>
    request<PredictedQuestion>('PATCH', `/questions/${id}`, changes),
  deleteQuestion: (id: string) => request<void>('DELETE', `/questions/${id}`),

  // ── Live ──
  questionStarting: () => request<void>('POST', '/question-starting'),
  ask: (text: string) => request<Answer | null>('POST', '/ask', { text }),
  /** slide: a number, or leave empty for the slide on screen. */
  explain: (slide?: number) => request<Answer>('POST', '/explain', { slide: slide ?? null }),
  askAudio: (audio: Blob) => {
    const form = new FormData();
    form.append('audio', audio, 'question.webm');
    return request<AskAudioResult>('POST', '/ask-audio', form);
  },

  // ── Present for me ──
  presentStatus: () => request<PresentStatus>('GET', '/present'),
  presentStart: (fromSlide?: number, style = 'class') =>
    request<PresentStatus>('POST', '/present/start', { from_slide: fromSlide ?? null, style }),
  /** A student's study session in a style: story | professional | exam. */
  studyStart: (style: string, deckId?: string, fromSlide?: number) =>
    request<PresentStatus>('POST', '/study/start', { style, deck_id: deckId ?? null, from_slide: fromSlide ?? null }),
  styles: () => request<ModelOption[]>('GET', '/styles'),
  presentPause: () => request<PresentStatus>('POST', '/present/pause'),
  presentResume: () => request<PresentStatus>('POST', '/present/resume'),
  presentNext: () => request<PresentStatus>('POST', '/present/next'),
  presentPrevious: () => request<PresentStatus>('POST', '/present/previous'),
  presentStop: () => request<PresentStatus>('POST', '/present/stop'),

  // ── Voice ──
  voices: () => request<ModelOption[]>('GET', '/voices'),
  voiceTest: () => request<void>('POST', '/voice/test'),
  /** The Stop button: Flick goes quiet at once (a talk in progress is paused). */
  voiceStop: () => request<void>('POST', '/voice/stop'),
  /** The Speak button: say this text again in Flick's voice. */
  voiceSay: (text: string) => request<void>('POST', '/voice/say', { text }),

  // ── Q&A log ──
  getLog: (limit = 300) => request<Answer[]>('GET', `/log?limit=${limit}`),
  clearLog: () => request<void>('DELETE', '/log'),
  /** Download link for the log as CSV (a link can't send headers, so the token goes in the URL). */
  exportLogUrl: () => `${connection.httpBase}/log/export?token=${encodeURIComponent(connection.token)}`,
};
