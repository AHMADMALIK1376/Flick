export interface Settings {
  hotkeyAccelerator: string;
  hotkeyMode: 'toggle' | 'push-to-talk';
  modelName: string;
  /**
   * Absolute directory for Whisper model files. Empty means the default
   * location inside userData. Exists because models are ~1.5GB and the system
   * drive is often the wrong place for them.
   */
  modelCacheDir: string;
  language: string;
  showFloatingWidget: boolean;
  launchAtStartup: boolean;
  silenceDurationMs: number;
  widgetPosition: { x: number; y: number } | null;
  onboardingComplete: boolean;
  openaiApiKey: string;
  geminiApiKey: string;
  deepseekApiKey: string;
  anthropicApiKey: string;
  qwenApiKey: string;
  /**
   * Tavily search key. Only needed when the chosen AI provider has no built-in
   * web search (everything except Claude).
   */
  tavilyApiKey: string;
  llmProvider: string;
  llmModel: string;
  /**
   * 'speak': Flick reads every answer aloud to the room.
   * 'private': the answer only appears on the presenter's screen, so they can
   * answer in their own words (there is still a Speak button on the card).
   */
  answerMode: 'speak' | 'private';
}

export interface TranscriptionResult {
  text: string;
  durationMs: number;
}

export interface DownloadProgress {
  modelName: string;
  bytesDownloaded: number;
  totalBytes: number;
  percentage: number;
  speedBps: number;
  currentFile?: string;
  status?: 'downloading' | 'verifying' | 'complete' | 'error';
  error?: string;
}

export interface DownloadError {
  message: string;
  code: 'NETWORK_ERROR' | 'DISK_PERMISSION' | 'DISK_SPACE' | 'VERIFICATION_FAILED';
  retryable: boolean;
}

export interface ModelFile {
  name: string;
  url: string;
  expectedSize?: number;
}

// Main → Renderer message types
export interface TranscriptionStatusMessage {
  status: 'transcribing' | 'complete' | 'error';
  text?: string;
  error?: string;
}

export type DownloadProgressMessage = DownloadProgress;

export type SettingsUpdateRequest = Partial<Settings>;

export interface WidgetPositionRequest {
  x: number;
  y: number;
}

export interface ToastMessage {
  type: 'success' | 'error' | 'warning';
  message: string;
  autoDismissMs: number;
}

// ── Presentation types ─────────────────────────────────────────────────────

/** One slide's text, as extracted from the .pptx. Numbers are 1-based. */
export interface Slide {
  number: number;
  title: string;
  /** Body text, one line per paragraph, title excluded. */
  body: string;
  /** Speaker notes — often where the presenter keeps the real explanation. */
  notes: string;
}

/** A question Flick expects the audience to ask, prepared before the talk. */
export interface PredictedQuestion {
  id: string;
  /** Slide the question is about; 0 for the talk as a whole. */
  slide: number;
  question: string;
  answer: string;
}

export type PrepStatus = 'idle' | 'preparing' | 'ready' | 'error';

export interface Deck {
  id: string;
  /** File name without the folder, e.g. "Lecture 4 - Neural Nets.pptx". */
  name: string;
  /** Where the file was loaded from, so it can be re-read after edits. */
  filePath: string;
  loadedAt: number;
  slides: Slide[];
  predicted: PredictedQuestion[];
  prepStatus: PrepStatus;
  prepError?: string;
}

/** Deck summary for lists — the full slide text stays in the main process. */
export interface DeckSummary {
  id: string;
  name: string;
  loadedAt: number;
  slideCount: number;
  questionCount: number;
  prepStatus: PrepStatus;
  prepError?: string;
  active: boolean;
}

export interface WebSourceRef {
  title: string;
  url: string;
}

/**
 * Where an answer came from — shown on the answer card so the presenter knows
 * how much to trust it before repeating it.
 */
export type AnswerOrigin =
  | 'prepared' // matched a question predicted before the talk
  | 'slides' // answered from the deck's content
  | 'web' // the deck did not cover it, so Flick searched the web
  | 'general' // no deck coverage and no web search available
  | 'greeting'
  | 'error';

export interface AnswerPayload {
  id: string;
  question: string;
  answer: string;
  origin: AnswerOrigin;
  sources: WebSourceRef[];
  /** Slide on screen when the question was asked, when PowerPoint reported one. */
  currentSlide: number | null;
  durationMs: number;
  timestamp: number;
  /** Whether this answer should be read aloud now. */
  speak: boolean;
}

export interface PrepProgress {
  deckId: string;
  status: PrepStatus;
  done: number;
  total: number;
  message?: string;
}
