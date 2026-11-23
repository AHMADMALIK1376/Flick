// Data shapes sent by the Python backend.
// They copy backend/flick/models.py. If you change a model there, change it here too.

export type PrepStatus = 'idle' | 'preparing' | 'ready' | 'error';

/** Where an answer came from. Shown as a badge so the presenter knows how far to trust it. */
export type AnswerOrigin =
  | 'prepared' // matched a question predicted before the talk
  | 'slides' // answered from the deck
  | 'web' // Claude searched the web
  | 'general' // no deck loaded, no search needed
  | 'explain' // "Flick, explain this slide"
  | 'greeting' // only "Flick" was said
  | 'error';

export interface Slide {
  number: number;
  title: string;
  body: string;
  notes: string;
}

export interface PredictedQuestion {
  id: string;
  slide: number; // 0 = about the whole talk
  question: string;
  answer: string;
}

export interface Deck {
  id: string;
  name: string;
  file_path: string;
  loaded_at: number;
  prep_status: PrepStatus;
  prep_error: string | null;
  slides: Slide[];
  predicted: PredictedQuestion[];
}

export interface DeckSummary {
  id: string;
  name: string;
  loaded_at: number;
  slide_count: number;
  question_count: number;
  explanation_count: number;
  prep_status: PrepStatus;
  prep_error: string | null;
  active: boolean;
}

export interface WebSource {
  title: string;
  url: string;
}

export interface Answer {
  id: string;
  question: string;
  answer: string;
  origin: AnswerOrigin;
  sources: WebSource[];
  current_slide: number | null;
  duration_ms: number;
  timestamp: number; // seconds since 1970
  speak: boolean;
  streamed: boolean;
}

export interface PrepProgress {
  deck_id: string;
  status: PrepStatus;
  done: number;
  total: number;
  message: string | null;
}

/** Settings as the backend sends them: the API key comes back masked ("••••••••abcd"). */
export interface Settings {
  anthropic_api_key: string;
  has_api_key: boolean;
  model: string;
  answer_mode: 'speak' | 'private';
  ask_hotkey: string;
  explain_hotkey: string;
  hotkey_mode: 'toggle' | 'push-to-talk';
  speech_model: string;
  language: string;
  show_mic: boolean;
}

/** Send only the fields you change. */
export type SettingsUpdate = Partial<Omit<Settings, 'has_api_key'>>;

export interface ModelOption {
  id: string;
  name: string;
}

export interface Status {
  speech_model: { ready: boolean; error: string | null };
  meaning_model: { ready: boolean; error: string | null };
  powerpoint: boolean;
  has_api_key: boolean;
}

export interface AskAudioResult {
  transcript: string;
  transcribe_ms: number;
  answer: Answer | null;
}

// ── Live events from the WebSocket /events ─────────────────────────────────

/** Event name → the data it carries. */
export interface FlickEventMap {
  thinking: { id: string; question: string }; // a question arrived, Flick is working
  searching: { id: string; speak: boolean }; // Flick is searching the web
  answer_delta: { id: string; text: string; speak: boolean }; // one more sentence of the answer
  answer: Answer; // the final answer
  prep_progress: PrepProgress; // preparing a deck
}

export type FlickEventType = keyof FlickEventMap;

export interface FlickEvent {
  type: FlickEventType;
  data: unknown;
}
