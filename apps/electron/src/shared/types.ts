/**
 * Language of a spoken utterance.
 *
 * 'roman-ur' is Urdu written in Latin script ("chrome open karo") — how
 * Pakistani students most often speak to a computer. 'mixed' is Urdu script
 * combined with Latin words in one utterance.
 */
export type LanguageHint = 'en' | 'ur' | 'roman-ur' | 'mixed';

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
  autoCopyToClipboard: boolean;
  showFloatingWidget: boolean;
  launchAtStartup: boolean;
  silenceDurationMs: number;
  widgetPosition: { x: number; y: number } | null;
  onboardingComplete: boolean;
  aiAgentEnabled: boolean;
  openaiApiKey: string;
  geminiApiKey: string;
  deepseekApiKey: string;
  anthropicApiKey: string;
  qwenApiKey: string;
  /** Picovoice access key for hands-free wake-word activation. Empty = off. */
  picovoiceAccessKey: string;
  /** Wake word: a built-in name ("JARVIS", "COMPUTER") or a path to a .ppn. */
  wakeWord: string;
  llmProvider: string;
  llmModel: string;
  browserAgentHeadless: boolean;
}

export interface TranscriptEntry {
  id: string;
  text: string;
  timestamp: number;
  durationMs: number;
  modelName: string;
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

// Renderer → Main message types
export interface TranscribeRequest {
  wavBuffer: ArrayBuffer;
}

export type SettingsUpdateRequest = Partial<Settings>;

export interface WidgetPositionRequest {
  x: number;
  y: number;
}

// ── AI Agent Types ──────────────────────────────────────────────────────────

export type ActionType =
  | 'open_application'
  | 'open_url'
  | 'type_text'
  | 'web_search'
  | 'open_path'
  | 'system_control'
  | 'browser_task';

export interface ClassifiedIntent {
  action: ActionType;
  target: string;
  confidence: number;
  parameters?: Record<string, unknown>;
}

export interface ActionLogEntry {
  id: string;
  timestamp: number;
  commandText: string;
  intentType: ActionType;
  target: string;
  status: 'success' | 'error';
  errorMessage?: string;
  durationMs: number;
}

export interface ToastMessage {
  type: 'success' | 'error' | 'warning';
  message: string;
  autoDismissMs: number;
}

export interface AgentResult {
  handled: boolean;
  action?: ActionLogEntry;
  error?: string;
}

// ── Chat Types ──────────────────────────────────────────────────────────────

export type ChatRole = 'user' | 'agent';

export type ChatResponseStatus =
  | 'success'
  | 'error'
  | 'not_command'
  | 'low_confidence'
  | 'disabled';

export interface ChatResponse {
  status: ChatResponseStatus;
  message: string;
  actionType?: string;
}

export interface ChatMessage {
  role: ChatRole;
  text: string;
  timestamp: number;
}

export interface DetectionResult {
  isCommand: boolean;
  confidence: number;
  matchedPattern?: string;
  language: LanguageHint;
}

export interface ClassificationError {
  type: 'timeout' | 'network' | 'invalid_key' | 'api_error' | 'parse_error';
  message: string;
  httpStatus?: number;
}

export type ClassificationResult =
  | { success: true; intent: ClassifiedIntent }
  | { success: false; error: ClassificationError };

export interface ExecutionResult {
  success: boolean;
  action: ActionType;
  target: string;
  error?: string;
  durationMs: number;
}

// ── Browser Agent Types ─────────────────────────────────────────────────────

export type BrowserActionType =
  | 'navigate_to_url'
  | 'click_element'
  | 'type_into_element'
  | 'scroll_page'
  | 'read_page_content'
  | 'take_screenshot'
  | 'wait_for_load'
  | 'task_complete'
  | 'task_failed';

export interface BrowserAction {
  type: BrowserActionType;
  target?: string;
  value?: string;
  description: string;
}

export interface BrowserTaskRequest {
  command: string;
  taskId: string;
}

export interface BrowserTaskResult {
  taskId: string;
  status: 'completed' | 'cancelled' | 'failed' | 'partial';
  result?: string;
  structuredData?: Record<string, unknown>;
  stepsCompleted: number;
  error?: string;
  confidence?: number;
}

export interface BrowserAgentConfig {
  userDataDir: string;
  headless: boolean;
  viewport: { width: number; height: number };
  maxSteps: number;
}

export interface ReactStep {
  stepNumber: number;
  action: BrowserAction;
  observation: string;
  screenshot?: string;
  timestamp: number;
}

export type ReactLoopStatus = 'planning' | 'acting' | 'observing' | 'deciding' | 'complete' | 'failed';

export interface BrowserTaskProgressMessage {
  taskId: string;
  stepNumber: number;
  totalStepsLimit: number;
  action: string;
  description: string;
  status: ReactLoopStatus;
  thumbnail?: string;
}

export interface BrowserTaskNotifier {
  sendProgress(progress: BrowserTaskProgressMessage): void;
  sendResult(result: BrowserTaskResult): void;
  sendLoginRequired(taskId: string, url: string): void;
  sendToast(message: ToastMessage): void;
}

export interface AnalysisResult {
  action: BrowserAction;
  reasoning: string;
  isTaskComplete: boolean;
  extractedData?: string;
  confidence: number;
}
