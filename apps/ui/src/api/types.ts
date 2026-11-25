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
  | 'error'
  | 'example'; // Flick drew an example / a story on the whiteboard

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
  /** Said by Flick's natural voice in the backend: the screens must not speak it again. */
  voiced: boolean;
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
  /** 'natural' = Flick's own offline voice (needed to present); 'windows' = the Windows voice. */
  voice: 'natural' | 'windows';
  voice_name: string;
  voice_speed: number;
}

/** Send only the fields you change. */
export type SettingsUpdate = Partial<Omit<Settings, 'has_api_key'>>;

export interface ModelOption {
  id: string;
  name: string;
  /** "Haiku 5.5" */
  short?: string;
  /** One line: what it is good for. */
  hint?: string;
  /** USD per million input / output tokens, e.g. "$0.10 / $0.50" */
  price?: string;
}

export interface Status {
  speech_model: { ready: boolean; error: string | null };
  meaning_model: { ready: boolean; error: string | null };
  powerpoint: boolean;
  has_api_key: boolean;
  voice: { ready: boolean; error: string | null; downloading: boolean };
}

export type PresentState = 'idle' | 'starting' | 'presenting' | 'paused' | 'finished' | 'error';

/** "Present for me": Flick gives the whole talk. */
/** The whiteboard option inside every mode. */
export type Board = 'auto' | 'draw' | 'example';

export interface PresentStatus {
  state: PresentState;
  slide: number | null;
  total: number;
  /** The sentence being said now (shown as a caption). */
  line: string | null;
  paused_for: 'question' | 'manual' | null;
  message: string | null;
  deck: string | null;
  deck_id: string | null;
  /** class (the normal talk) | story | professional | exam | visual */
  style: string;
  /** true: a student's study session (no PowerPoint, shown on the Study page) */
  study: boolean;
  /** Why PowerPoint isn't following the talk, and what to do (null when it is). */
  powerpoint?: string | null;
}

// ── The whiteboard ──────────────────────────────────────────────────────────

export type InkColor = 'plum' | 'aqua' | 'amber' | 'rose' | 'green' | 'gray';

export type DrawingElement =
  | { id: string; type: 'box'; step: number; x: number; y: number; w: number; h: number; label: string; emoji: string; color: InkColor }
  | { id: string; type: 'circle'; step: number; x: number; y: number; r: number; label: string; emoji: string; color: InkColor }
  | { id: string; type: 'emoji'; step: number; x: number; y: number; char: string; size: number; label: string }
  | { id: string; type: 'text'; step: number; x: number; y: number; text: string; size: number; color: InkColor }
  | { type: 'arrow'; step: number; from: string; to: string; label: string; dashed: boolean };

/** A drawing planned by Claude: a 1000 × 600 board, revealed step by step. */
export interface Drawing {
  title: string;
  elements: DrawingElement[];
  steps: { say: string }[];
}

export type CanvasEvent =
  | ({ action: 'open'; id: string; slide: number | null; target: 'class' | 'study' } & Drawing)
  | { action: 'step'; id: string; step: number; say: string; target: 'class' | 'study' }
  | { action: 'close'; id: string; target: 'class' | 'study' };

export interface AskAudioResult {
  transcript: string;
  transcribe_ms: number;
  answer: Answer | null;
}

// ── Live events from the WebSocket /events ─────────────────────────────────

// ── Token Analyzer ──────────────────────────────────────────────────────────

export interface UsageSums {
  calls: number;
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
  searches: number;
  tokens: number;
  /** USD */
  cost: number;
}

export type UsageCardType = 'presentation' | 'study' | 'slide' | 'questions' | 'prep';

export interface UsageCard {
  id: string;
  type: UsageCardType;
  type_name: string;
  deck_id: string | null;
  deck_name: string | null;
  style: string | null;
  slide: number | null;
  title: string;
  started_at: number;
  ended_at: number | null;
  totals: UsageSums;
  /** What the tokens were for: talk, drawing, example, question, explain, prep */
  by_kind: (UsageSums & { kind: string; name: string })[];
  by_slide: (UsageSums & { slide: number | null })[];
  models: string[];
}

export interface UsageReport {
  total: UsageSums;
  cards: UsageCard[];
  kinds: Record<string, string>;
  prices: Record<string, { input: number; output: number; cache_write: number; cache_read: number }>;
  /** USD per web search */
  web_search: number;
  model: string;
}

/** Event name → the data it carries. */
export interface FlickEventMap {
  thinking: { id: string; question: string }; // a question arrived, Flick is working
  searching: { id: string; speak: boolean; voiced?: boolean }; // Flick is searching the web
  answer_delta: { id: string; text: string; speak: boolean; voiced?: boolean }; // one more sentence of the answer
  answer: Answer; // the final answer
  prep_progress: PrepProgress; // preparing a deck
  present: PresentStatus; // presenting: slide, state, caption
  canvas: CanvasEvent; // the whiteboard: open a drawing, show the next step, close
  usage: { card: UsageCard | null; total: UsageSums }; // a Claude call was counted (Token Analyzer)
}

export type FlickEventType = keyof FlickEventMap;

export interface FlickEvent {
  type: FlickEventType;
  data: unknown;
}
