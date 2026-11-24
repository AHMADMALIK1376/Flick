// Every backend endpoint as one typed function.
// Full list with details: backend/README.md
import { request } from './client';
import type {
  Answer,
  AskAudioResult,
  Deck,
  DeckSummary,
  ModelOption,
  PredictedQuestion,
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

  // ── Q&A log ──
  getLog: (limit = 300) => request<Answer[]>('GET', `/log?limit=${limit}`),
  clearLog: () => request<void>('DELETE', '/log'),
  // TODO(#11): exportLogUrl for GET /log/export
};
