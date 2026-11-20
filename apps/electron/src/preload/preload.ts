import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel } from '../shared/ipc-channels';
import type {
  AnswerPayload,
  Deck,
  DeckSummary,
  DownloadProgress,
  PrepProgress,
  Settings,
  ToastMessage,
  TranscriptionResult,
  TranscriptionStatusMessage,
} from '../shared/types';

type DeckLoadResult = { ok: boolean; deckId?: string; error?: string; canceled?: boolean };

const electronAPI = {
  // ── Voice ──
  transcribe(wavBuffer: ArrayBuffer): Promise<TranscriptionResult> {
    return ipcRenderer.invoke(IpcChannel.TRANSCRIBE, wavBuffer);
  },
  onTranscriptionStatus(callback: (message: TranscriptionStatusMessage) => void): void {
    ipcRenderer.on(IpcChannel.TRANSCRIPTION_STATUS, (_event, message) => callback(message));
  },
  onToggleRecording(callback: () => void): void {
    ipcRenderer.on(IpcChannel.TOGGLE_RECORDING, () => callback());
  },

  // ── Settings & app ──
  getSettings(): Promise<Settings> {
    return ipcRenderer.invoke(IpcChannel.GET_SETTINGS);
  },
  updateSettings(settings: Partial<Settings>): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.UPDATE_SETTINGS, settings);
  },
  downloadModel(modelName: string): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.DOWNLOAD_MODEL, modelName);
  },
  onDownloadProgress(callback: (progress: DownloadProgress) => void): void {
    ipcRenderer.on(IpcChannel.DOWNLOAD_PROGRESS, (_event, progress) => callback(progress));
  },
  retryDownload(modelName: string): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.DOWNLOAD_MODEL, modelName);
  },
  saveWidgetPosition(position: { x: number; y: number }): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.WIDGET_POSITION_SAVE, position);
  },
  loadWidgetPosition(): Promise<{ x: number; y: number } | null> {
    return ipcRenderer.invoke(IpcChannel.WIDGET_POSITION_LOAD);
  },
  isOnboardingDone(): Promise<boolean> {
    return ipcRenderer.invoke(IpcChannel.IS_ONBOARDING_DONE);
  },
  completeOnboarding(): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.ONBOARDING_COMPLETE);
  },
  openSettings(): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.OPEN_SETTINGS);
  },
  showDashboard(): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.SHOW_DASHBOARD);
  },
  quitApp(): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.QUIT_APP);
  },
  onToast(callback: (toast: ToastMessage) => void): void {
    ipcRenderer.on(IpcChannel.TOAST, (_event, toast) => callback(toast));
  },
  openExternal(url: string): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.OPEN_EXTERNAL, url);
  },

  // ── Decks ──
  uploadDeck(): Promise<DeckLoadResult> {
    return ipcRenderer.invoke(IpcChannel.DECK_UPLOAD);
  },
  loadDeckFromPowerPoint(): Promise<DeckLoadResult> {
    return ipcRenderer.invoke(IpcChannel.DECK_LOAD_FROM_POWERPOINT);
  },
  listDecks(): Promise<DeckSummary[]> {
    return ipcRenderer.invoke(IpcChannel.DECK_LIST);
  },
  getDeck(id: string): Promise<Deck | null> {
    return ipcRenderer.invoke(IpcChannel.DECK_GET, id);
  },
  activateDeck(id: string): Promise<DeckSummary[]> {
    return ipcRenderer.invoke(IpcChannel.DECK_ACTIVATE, id);
  },
  deleteDeck(id: string): Promise<DeckSummary[]> {
    return ipcRenderer.invoke(IpcChannel.DECK_DELETE, id);
  },
  prepareDeck(id: string): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.DECK_PREPARE, id);
  },
  onPrepProgress(callback: (progress: PrepProgress) => void): void {
    ipcRenderer.on(IpcChannel.DECK_PREP_PROGRESS, (_event, progress) => callback(progress));
  },

  // ── Questions & answers ──
  ask(text: string): Promise<AnswerPayload | null> {
    return ipcRenderer.invoke(IpcChannel.ASK, text);
  },
  onThinking(callback: (question: string) => void): void {
    ipcRenderer.on(IpcChannel.THINKING, (_event, question) => callback(question));
  },
  onAnswer(callback: (answer: AnswerPayload) => void): void {
    ipcRenderer.on(IpcChannel.ANSWER, (_event, answer) => callback(answer));
  },
  getQaLog(): Promise<AnswerPayload[]> {
    return ipcRenderer.invoke(IpcChannel.QA_LOG_GET);
  },
  clearQaLog(): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.QA_LOG_CLEAR);
  },
  speak(text: string): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.SPEAK, text);
  },
  stopSpeaking(): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.STOP_SPEAKING);
  },
  hideAnswerCard(): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.ANSWER_CARD_HIDE);
  },
};

// The widget window runs without context isolation (it needs Node for audio
// capture), where exposeInMainWorld throws; it uses ipcRenderer directly.
if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electronAPI', electronAPI);
}

export type ElectronAPI = typeof electronAPI;
