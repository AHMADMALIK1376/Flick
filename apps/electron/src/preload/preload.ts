import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel } from '../shared/ipc-channels';
import type {
  TranscriptionResult,
  Settings,
  TranscriptEntry,
  DownloadProgress,
  TranscriptionStatusMessage,
  ActionLogEntry,
  ToastMessage,
  BrowserTaskProgressMessage,
  BrowserTaskResult,
  ChatResponse,
} from '../shared/types';

const electronAPI = {
  transcribe(wavBuffer: ArrayBuffer): Promise<TranscriptionResult> {
    return ipcRenderer.invoke(IpcChannel.TRANSCRIBE, wavBuffer);
  },

  onTranscriptionStatus(callback: (message: TranscriptionStatusMessage) => void): void {
    ipcRenderer.on(IpcChannel.TRANSCRIPTION_STATUS, (_event, message) => callback(message));
  },

  onToggleRecording(callback: () => void): void {
    ipcRenderer.on(IpcChannel.TOGGLE_RECORDING, () => callback());
  },

  getSettings(): Promise<Settings> {
    return ipcRenderer.invoke(IpcChannel.GET_SETTINGS);
  },

  updateSettings(settings: Partial<Settings>): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.UPDATE_SETTINGS, settings);
  },

  getHistory(): Promise<TranscriptEntry[]> {
    return ipcRenderer.invoke(IpcChannel.GET_HISTORY);
  },

  clearHistory(): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.CLEAR_HISTORY);
  },

  deleteHistoryEntry(id: string): Promise<boolean> {
    return ipcRenderer.invoke(IpcChannel.DELETE_HISTORY_ENTRY, id);
  },

  updateHistoryEntry(id: string, text: string): Promise<TranscriptEntry | null> {
    return ipcRenderer.invoke(IpcChannel.UPDATE_HISTORY_ENTRY, id, text);
  },

  copyToClipboard(text: string): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.COPY_TO_CLIPBOARD, text);
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

  getAgentLog(): Promise<ActionLogEntry[]> {
    return ipcRenderer.invoke(IpcChannel.AGENT_GET_LOG);
  },

  clearAgentLog(): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.AGENT_CLEAR_LOG);
  },

  onAgentToast(callback: (toast: ToastMessage) => void): void {
    ipcRenderer.on(IpcChannel.AGENT_TOAST, (_event, toast) => callback(toast));
  },

  onAgentConfirmRequest(
    callback: (prompt: {
      id: string;
      toolName: string;
      description: string;
      args: Record<string, unknown>;
    }) => void
  ): void {
    ipcRenderer.on(IpcChannel.AGENT_CONFIRM_REQUEST, (_event, prompt) =>
      callback(prompt)
    );
  },

  respondAgentConfirm(id: string, approved: boolean): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.AGENT_CONFIRM_RESPONSE, id, approved);
  },

  cancelBrowserTask(taskId: string): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.BROWSER_TASK_CANCEL, taskId);
  },

  completeBrowserLogin(taskId: string): Promise<void> {
    return ipcRenderer.invoke(IpcChannel.BROWSER_TASK_LOGIN_COMPLETE, taskId);
  },

  // Connectors
  listConnectors(): Promise<unknown> {
    return ipcRenderer.invoke(IpcChannel.CONNECTORS_LIST);
  },

  openConnectorLogin(idOrUrl: string): Promise<unknown> {
    return ipcRenderer.invoke(IpcChannel.CONNECTOR_OPEN_LOGIN, idOrUrl);
  },

  markConnectorConnected(id: string): Promise<unknown> {
    return ipcRenderer.invoke(IpcChannel.CONNECTOR_MARK_CONNECTED, id);
  },

  disconnectConnector(id: string): Promise<unknown> {
    return ipcRenderer.invoke(IpcChannel.CONNECTOR_DISCONNECT, id);
  },

  onBrowserTaskProgress(callback: (progress: BrowserTaskProgressMessage) => void): void {
    ipcRenderer.on(IpcChannel.BROWSER_TASK_PROGRESS, (_event, progress) => callback(progress));
  },

  onBrowserTaskResult(callback: (result: BrowserTaskResult) => void): void {
    ipcRenderer.on(IpcChannel.BROWSER_TASK_RESULT, (_event, result) => callback(result));
  },

  onBrowserTaskLoginRequired(callback: (data: { taskId: string; url: string }) => void): void {
    ipcRenderer.on(IpcChannel.BROWSER_TASK_LOGIN_REQUIRED, (_event, data) => callback(data));
  },

  sendChatCommand(text: string): Promise<ChatResponse> {
    return ipcRenderer.invoke(IpcChannel.CHAT_SEND, text);
  },

  onChatResponse(callback: (response: ChatResponse) => void): void {
    ipcRenderer.on(IpcChannel.CHAT_RESPONSE, (_event, response) => callback(response));
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
