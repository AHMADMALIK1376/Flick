import {
  app,
  BrowserWindow,
  Tray,
  globalShortcut,
  ipcMain,
  clipboard,
  screen,
  session,
} from 'electron';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';
import { IpcChannel } from '../shared/ipc-channels';
import type { Settings, TranscriptEntry } from '../shared/types';
import { WhisperService, resolveModelId, resolveLanguage } from './whisper-service';
import { resolveModelCacheDir } from './model-paths';
import { ModelDownloader } from './model-downloader';
import { ModelManager } from './model-manager';
import { ClipboardManager } from './clipboard-manager';
import { SettingsStore } from './settings-store';
import { HistoryStore } from './history-store';
import { TrayManager } from './tray-manager';
import { AgentService } from './agent/agent-service';
import type { ProviderId } from './agent/llm/providers/llm-provider';

// ── Model Cache Directory ───────────────────────────────────────────────────

/**
 * Where Whisper model files live. Read on each use rather than captured once,
 * so changing the location in Settings takes effect without a restart.
 *
 * Creates the directory on demand — the user may point this at a drive path
 * that does not exist yet.
 */
function getModelCacheDir(): string {
  const dir = resolveModelCacheDir(
    settingsStore.get('modelCacheDir'),
    app.getPath('userData'),
  );
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// ── Stores & Services ───────────────────────────────────────────────────────

const settingsStoreInstance = new SettingsStore();
const historyStoreInstance = new HistoryStore();
const modelManager = new ModelManager();
const whisperService = new WhisperService();
const clipboardManager = new ClipboardManager();
const trayManager = new TrayManager();

const agentService = new AgentService({
  notifySuccess: (msg) => {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.webContents.send(IpcChannel.AGENT_TOAST, { type: 'success', message: msg, autoDismissMs: 4000 });
    }
  },
  notifyError: (msg) => {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.webContents.send(IpcChannel.AGENT_TOAST, { type: 'error', message: msg, autoDismissMs: 4000 });
    }
  },
  notifyUnrecognized: (text) => {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.webContents.send(IpcChannel.AGENT_TOAST, { type: 'warning', message: `Command not recognized: "${text}"`, autoDismissMs: 4000 });
    }
  },
  requestConfirm: (prompt) => {
    // No dashboard means nobody can answer, so report undelivered and let the
    // permission gate fail closed.
    if (!dashboardWindow || dashboardWindow.isDestroyed()) {
      return false;
    }
    dashboardWindow.show();
    dashboardWindow.focus();
    dashboardWindow.webContents.send(IpcChannel.AGENT_CONFIRM_REQUEST, prompt);
    return true;
  },
});

// Keep a reference to the raw electron-store for direct access where needed
const settingsStore = new Store<Settings>({
  name: 'settings',
  defaults: {
    hotkeyAccelerator: process.platform === 'darwin' ? 'Cmd+Shift+Space' : 'Ctrl+Shift+Space',
    hotkeyMode: 'toggle' as const,
    modelName: 'medium',
    modelCacheDir: '',
    language: 'en',
    autoCopyToClipboard: true,
    showFloatingWidget: true,
    launchAtStartup: false,
    silenceDurationMs: 1500,
    widgetPosition: null,
    onboardingComplete: false,
    aiAgentEnabled: false,
    openaiApiKey: '',
    geminiApiKey: '',
    deepseekApiKey: '',
    anthropicApiKey: '',
    qwenApiKey: '',
    llmProvider: '',
    llmModel: '',
    browserAgentHeadless: false,
  },
});

// ── Window references ───────────────────────────────────────────────────────

let widgetWindow: BrowserWindow | null = null;
let recorderWindow: BrowserWindow | null = null;
let onboardingWindow: BrowserWindow | null = null;
let dashboardWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// ── Window creation ─────────────────────────────────────────────────────────

function createFloatingWidget(): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  const savedPosition = settingsStore.get('widgetPosition');
  const x = savedPosition ? savedPosition.x : Math.round(screenWidth / 2 - 100);
  const y = savedPosition ? savedPosition.y : screenHeight - 60;

  const preloadPath = path.join(__dirname, '..', 'preload', 'preload.js');
  console.log('[Main] Preload path:', preloadPath, 'exists:', fs.existsSync(preloadPath));

  const win = new BrowserWindow({
    width: 160,
    height: 48,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
      webSecurity: false,
    },
  });

  const widgetHtmlPath = path.join(__dirname, '..', 'renderer', 'widget', 'widget.html');
  win.loadFile(widgetHtmlPath);

  // Persist position when the window is moved (dragged)
  win.on('moved', () => {
    const [wx, wy] = win.getPosition();
    settingsStore.set('widgetPosition', { x: wx, y: wy });
  });

  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  return win;
}

function createRecorderWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
  });

  const recorderHtmlPath = path.join(__dirname, '..', 'renderer', 'recorder', 'recorder.html');
  win.loadFile(recorderHtmlPath);

  return win;
}

function createOnboardingWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 600,
    height: 700,
    center: true,
    resizable: true,
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const onboardingHtmlPath = path.join(__dirname, '..', 'renderer', 'onboarding', 'onboarding.html');
  win.loadFile(onboardingHtmlPath);

  win.on('closed', () => {
    onboardingWindow = null;
  });

  return win;
}

function createDashboardWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 460,
    minHeight: 520,
    center: true,
    frame: true,
    show: false,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const dashboardHtmlPath = path.join(__dirname, '..', 'renderer', 'dashboard', 'dashboard.html');
  win.loadFile(dashboardHtmlPath);

  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  return win;
}

// ── System Tray ─────────────────────────────────────────────────────────────

function initTray(): Tray {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
  return trayManager.create(iconPath, {
    onDashboard: () => {
      if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.show();
        dashboardWindow.focus();
      }
    },
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
  });
}

// ── Global Hotkey ───────────────────────────────────────────────────────────

let uiohookStarted = false;

function registerGlobalHotkey(accelerator: string): void {
  const mode = settingsStore.get('hotkeyMode') || 'toggle';

  // Clean up previous registrations
  globalShortcut.unregisterAll();
  stopUiohook();

  if (mode === 'push-to-talk') {
    setupPushToTalk();
  } else {
    setupToggleHotkey(accelerator);
  }
}

function setupToggleHotkey(accelerator: string): void {
  try {
    let lastToggle = 0;
    const registered = globalShortcut.register(accelerator, () => {
      const now = Date.now();
      if (now - lastToggle < 500) return;
      lastToggle = now;
      if (widgetWindow && !widgetWindow.isDestroyed()) {
        widgetWindow.webContents.send(IpcChannel.TOGGLE_RECORDING);
      }
    });
    if (!registered) {
      console.warn(`Failed to register global hotkey: ${accelerator}`);
    }
  } catch (err) {
    console.warn(`Error registering global hotkey: ${err}`);
  }
}

function setupPushToTalk(): void {
  try {
    const { uIOhook, UiohookKey } = require('uiohook-napi');

    // Ctrl+Shift+Space keycodes
    let ctrlDown = false;
    let shiftDown = false;
    let spaceDown = false;
    let recording = false;

    uIOhook.on('keydown', (e: any) => {
      if (e.keycode === UiohookKey.Ctrl || e.keycode === UiohookKey.CtrlRight) ctrlDown = true;
      if (e.keycode === UiohookKey.Shift || e.keycode === UiohookKey.ShiftRight) shiftDown = true;
      if (e.keycode === UiohookKey.Space) spaceDown = true;

      if (ctrlDown && shiftDown && spaceDown && !recording) {
        recording = true;
        console.log('[PTT] Start recording');
        if (widgetWindow && !widgetWindow.isDestroyed()) {
          widgetWindow.webContents.send('start-recording');
        }
      }
    });

    uIOhook.on('keyup', (e: any) => {
      if (e.keycode === UiohookKey.Ctrl || e.keycode === UiohookKey.CtrlRight) ctrlDown = false;
      if (e.keycode === UiohookKey.Shift || e.keycode === UiohookKey.ShiftRight) shiftDown = false;
      if (e.keycode === UiohookKey.Space) spaceDown = false;

      if (recording && (!ctrlDown || !shiftDown || !spaceDown)) {
        recording = false;
        console.log('[PTT] Stop recording');
        if (widgetWindow && !widgetWindow.isDestroyed()) {
          widgetWindow.webContents.send('stop-recording');
        }
      }
    });

    uIOhook.start();
    uiohookStarted = true;
    console.log('[PTT] Push-to-talk mode active');
  } catch (err) {
    console.warn('[PTT] Failed to start uiohook:', err);
    // Fall back to toggle mode
    const accelerator = settingsStore.get('hotkeyAccelerator');
    setupToggleHotkey(accelerator);
  }
}

function stopUiohook(): void {
  if (uiohookStarted) {
    try {
      const { uIOhook } = require('uiohook-napi');
      uIOhook.stop();
    } catch (e) {}
    uiohookStarted = false;
  }
}

// ── IPC Handlers ────────────────────────────────────────────────────────────

function setupIPC(): void {
  ipcMain.handle(IpcChannel.GET_SETTINGS, () => {
    return settingsStore.store;
  });

  ipcMain.handle(IpcChannel.UPDATE_SETTINGS, (_event, partial: Partial<Settings>) => {
    for (const [key, value] of Object.entries(partial)) {
      settingsStore.set(key as keyof Settings, value);
    }
    // Re-register hotkey if it changed
    if (partial.hotkeyAccelerator) {
      registerGlobalHotkey(partial.hotkeyAccelerator);
    }
    // Update agent service settings
    if ('aiAgentEnabled' in partial) {
      agentService.setEnabled(partial.aiAgentEnabled as boolean);
    }
    // Per-provider API keys → push to LLMService
    if ('openaiApiKey' in partial) {
      agentService.setProviderApiKey('openai', partial.openaiApiKey as string);
    }
    if ('geminiApiKey' in partial) {
      agentService.setProviderApiKey('gemini', partial.geminiApiKey as string);
    }
    if ('deepseekApiKey' in partial) {
      agentService.setProviderApiKey('deepseek', partial.deepseekApiKey as string);
    }
    if ('anthropicApiKey' in partial) {
      agentService.setProviderApiKey('anthropic', partial.anthropicApiKey as string);
    }
    if ('qwenApiKey' in partial) {
      agentService.setProviderApiKey('qwen', partial.qwenApiKey as string);
    }
    // Provider/model selection → instant switch
    if ('llmProvider' in partial || 'llmModel' in partial) {
      const provider = (partial.llmProvider ?? settingsStore.get('llmProvider')) as string;
      const model = (partial.llmModel ?? settingsStore.get('llmModel')) as string;
      if (provider && model) {
        agentService.setActiveSelection(provider as ProviderId, model);
      }
    }
    if ('browserAgentHeadless' in partial) {
      agentService.setBrowserConfig({ headless: partial.browserAgentHeadless as boolean });
    }
  });

  ipcMain.handle(IpcChannel.GET_HISTORY, () => {
    return historyStoreInstance.getEntries();
  });

  ipcMain.handle(IpcChannel.CLEAR_HISTORY, () => {
    historyStoreInstance.clearHistory();
  });

  ipcMain.handle(IpcChannel.DELETE_HISTORY_ENTRY, (_event, id: string) => {
    return historyStoreInstance.deleteEntry(id);
  });

  ipcMain.handle(IpcChannel.UPDATE_HISTORY_ENTRY, (_event, id: string, text: string) => {
    return historyStoreInstance.updateEntry(id, text);
  });

  ipcMain.handle(IpcChannel.COPY_TO_CLIPBOARD, (_event, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.handle(IpcChannel.WIDGET_POSITION_SAVE, (_event, position: { x: number; y: number }) => {
    settingsStore.set('widgetPosition', position);
  });

  ipcMain.handle(IpcChannel.WIDGET_POSITION_LOAD, () => {
    return settingsStore.get('widgetPosition');
  });

  ipcMain.handle(IpcChannel.IS_ONBOARDING_DONE, () => {
    return settingsStore.get('onboardingComplete');
  });

  ipcMain.handle(IpcChannel.ONBOARDING_COMPLETE, () => {
    settingsStore.set('onboardingComplete', true);
    if (onboardingWindow) {
      onboardingWindow.destroy();
      onboardingWindow = null;
    }
    // Create dashboard window after first-launch onboarding completes
    if (!dashboardWindow || dashboardWindow.isDestroyed()) {
      dashboardWindow = createDashboardWindow();
    }
  });

  ipcMain.handle(IpcChannel.OPEN_SETTINGS, () => {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.show();
      dashboardWindow.focus();
    }
  });

  ipcMain.handle(IpcChannel.SHOW_DASHBOARD, () => {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.show();
      dashboardWindow.focus();
    }
  });

  ipcMain.handle(IpcChannel.QUIT_APP, () => {
    isQuitting = true;
    app.quit();
  });

  // Transcribe handler
  ipcMain.handle(IpcChannel.TRANSCRIBE, async (_event, wavBuffer: ArrayBuffer) => {
    try {
      // Notify widget: transcribing
      if (widgetWindow) {
        widgetWindow.webContents.send(IpcChannel.TRANSCRIPTION_STATUS, { status: 'transcribing' });
      }

      // Initialize whisper service if needed
      if (!whisperService.isInitialized()) {
        await whisperService.initialize({
        cacheDir: getModelCacheDir(),
        modelId: resolveModelId(settingsStore.get('modelName')),
      });
      }

      // Write WAV buffer to temp file
      const tmpFile = path.join(os.tmpdir(), `vtt-${Date.now()}.wav`);
      fs.writeFileSync(tmpFile, Buffer.from(wavBuffer));

      try {
        const result = await whisperService.transcribe(
          tmpFile,
          resolveLanguage(settingsStore.get('language'))
        );

        // AI Agent processing
        if (agentService.isEnabled() && result.text) {
          const agentResult = await agentService.process(result.text);
          if (agentResult.handled) {
            // Command was executed — notify widget and return without clipboard/history
            if (widgetWindow) {
              widgetWindow.webContents.send(IpcChannel.TRANSCRIPTION_STATUS, {
                status: 'complete',
                text: result.text,
              });
            }
            return result;
          }
        }

        // Auto-copy to clipboard if enabled
        if (result.text && settingsStore.get('autoCopyToClipboard')) {
          clipboardManager.copyText(result.text);
        }

        // Save to history if non-empty
        if (result.text) {
          const entry: TranscriptEntry = {
            id: uuidv4(),
            text: result.text,
            timestamp: Date.now(),
            durationMs: result.durationMs,
            modelName: settingsStore.get('modelName'),
          };
          historyStoreInstance.addEntry(entry);
        }

        // Notify widget: complete
        if (widgetWindow) {
          widgetWindow.webContents.send(IpcChannel.TRANSCRIPTION_STATUS, {
            status: 'complete',
            text: result.text,
          });
        }

        return result;
      } finally {
        // Clean up temp file
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (widgetWindow) {
        widgetWindow.webContents.send(IpcChannel.TRANSCRIPTION_STATUS, {
          status: 'error',
          error: errorMsg,
        });
      }
      throw err;
    }
  });

  // Agent log handlers
  ipcMain.handle(IpcChannel.AGENT_GET_LOG, () => {
    return agentService.getLog();
  });

  ipcMain.handle(IpcChannel.AGENT_CLEAR_LOG, () => {
    agentService.clearLog();
  });

  // Chat command handler (request/response)
  ipcMain.handle(IpcChannel.CHAT_SEND, async (_event, text: string) => {
    return await agentService.processChatCommand(text);
  });

  // Answer to a tool confirmation prompt
  ipcMain.handle(
    IpcChannel.AGENT_CONFIRM_RESPONSE,
    (_event, id: string, approved: boolean) => {
      agentService.resolveConfirm(id, approved);
    }
  );

  // Browser agent handlers
  ipcMain.handle(IpcChannel.BROWSER_TASK_CANCEL, () => {
    agentService.cancelBrowserTask();
  });

  ipcMain.handle(IpcChannel.BROWSER_TASK_LOGIN_COMPLETE, (_event, taskId: string) => {
    // For MVP, log the signal — full login resume is handled by BrowserAgent's session persistence
    console.log('[BrowserAgent] Login complete signal received for task:', taskId);
  });

  // Download model handler
  ipcMain.handle(IpcChannel.DOWNLOAD_MODEL, async (_event, modelName: string) => {
    // Map short model names to full Hugging Face model IDs
    let modelId = modelName || 'Xenova/whisper-small';
    if (!modelId.includes('/')) {
      modelId = `Xenova/whisper-${modelId}`;
    }
    const modelDownloader = new ModelDownloader(getModelCacheDir());

    // If model is already downloaded, skip and send 100% progress
    if (modelDownloader.isModelReady(modelId)) {
      console.log(`[Model] Model ${modelId} already downloaded, skipping.`);
      if (onboardingWindow && !onboardingWindow.isDestroyed()) {
        onboardingWindow.webContents.send(IpcChannel.DOWNLOAD_PROGRESS, {
          modelName: modelId,
          bytesDownloaded: 1,
          totalBytes: 1,
          percentage: 100,
          speedBps: 0,
          status: 'complete',
        });
      }
      // Initialize WhisperService with the cache dir
      await whisperService.initialize({
        cacheDir: getModelCacheDir(),
        modelId: resolveModelId(settingsStore.get('modelName')),
      });
      return;
    }

    // Download model files with progress forwarding
    try {
      await modelDownloader.download({
        modelId,
        destDir: getModelCacheDir(),
        onProgress: (progress) => {
          if (onboardingWindow && !onboardingWindow.isDestroyed()) {
            onboardingWindow.webContents.send(IpcChannel.DOWNLOAD_PROGRESS, progress);
          }
          console.log(`[Model] ${progress.status || 'downloading'}: ${progress.currentFile || ''} ${progress.percentage}%`);
        },
        onError: (error) => {
          console.error(`[Model] Download error: ${error.message} (${error.code})`);
          if (onboardingWindow && !onboardingWindow.isDestroyed()) {
            onboardingWindow.webContents.send(IpcChannel.DOWNLOAD_PROGRESS, {
              modelName: modelId,
              bytesDownloaded: 0,
              totalBytes: 0,
              percentage: 0,
              speedBps: 0,
              status: 'error',
              error: error.message,
            });
          }
          throw new Error(error.message);
        },
      });

      // On completion, initialize WhisperService with the cache dir
      await whisperService.initialize({
        cacheDir: getModelCacheDir(),
        modelId: resolveModelId(settingsStore.get('modelName')),
      });
    } catch (err) {
      console.error('[Model] Download/load failed:', err);
      throw err;
    }
  });
}

// ── App Lifecycle ───────────────────────────────────────────────────────────

// Prevent multiple instances — if a second instance launches, focus the existing one
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to launch a second instance — show the dashboard
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.show();
      dashboardWindow.focus();
    } else if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.show();
    }
  });

  app.whenReady().then(() => {
    // Grant microphone permission automatically
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      if (permission === 'media') {
        callback(true);
      } else {
        callback(true);
      }
    });

    setupIPC();

    // Initialize agent from saved settings
    const savedAgentEnabled = settingsStore.get('aiAgentEnabled');
    if (savedAgentEnabled) {
      agentService.setEnabled(true);
    }

    // Seed LLM provider keys from settings
    const openaiKey = settingsStore.get('openaiApiKey');
    const geminiKey = settingsStore.get('geminiApiKey');
    const deepseekKey = settingsStore.get('deepseekApiKey');
    const anthropicKey = settingsStore.get('anthropicApiKey');
    const qwenKey = settingsStore.get('qwenApiKey');
    if (openaiKey) agentService.setProviderApiKey('openai', openaiKey);
    if (geminiKey) agentService.setProviderApiKey('gemini', geminiKey);
    if (deepseekKey) agentService.setProviderApiKey('deepseek', deepseekKey);
    if (anthropicKey) agentService.setProviderApiKey('anthropic', anthropicKey);
    if (qwenKey) agentService.setProviderApiKey('qwen', qwenKey);
    // Seed active selection if persisted
    const savedProvider = settingsStore.get('llmProvider');
    const savedModel = settingsStore.get('llmModel');
    if (savedProvider && savedModel) {
      agentService.setActiveSelection(savedProvider as ProviderId, savedModel);
    }

    // Set up browser agent notifier and config
    agentService.setupBrowserNotifier({
      sendProgress: (progress) => {
        if (dashboardWindow && !dashboardWindow.isDestroyed()) {
          dashboardWindow.webContents.send(IpcChannel.BROWSER_TASK_PROGRESS, progress);
        }
      },
      sendResult: (result) => {
        if (dashboardWindow && !dashboardWindow.isDestroyed()) {
          dashboardWindow.webContents.send(IpcChannel.BROWSER_TASK_RESULT, result);
        }
      },
      sendLoginRequired: (taskId, url) => {
        if (dashboardWindow && !dashboardWindow.isDestroyed()) {
          dashboardWindow.webContents.send(IpcChannel.BROWSER_TASK_LOGIN_REQUIRED, { taskId, url });
        }
      },
      sendToast: (toast) => {
        if (dashboardWindow && !dashboardWindow.isDestroyed()) {
          dashboardWindow.webContents.send(IpcChannel.AGENT_TOAST, toast);
        }
      },
    });

    // Pass initial browser config (headless setting)
    agentService.setBrowserConfig({ headless: settingsStore.get('browserAgentHeadless') });

    widgetWindow = createFloatingWidget();
    tray = initTray();

    const hotkey = settingsStore.get('hotkeyAccelerator');
    registerGlobalHotkey(hotkey);

    // Show onboarding on first launch
    const onboardingDone = settingsStore.get('onboardingComplete');
    if (!onboardingDone) {
      onboardingWindow = createOnboardingWindow();
      onboardingWindow.show();
    } else {
      // Create dashboard window when onboarding is already complete
      dashboardWindow = createDashboardWindow();
    }
  });
}

app.on('window-all-closed', () => {
  // Don't quit — keep running in tray
});

app.on('before-quit', () => {
  isQuitting = true;
  agentService.shutdownBrowser();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopUiohook();
});

app.on('activate', () => {
  // macOS: re-show widget when dock icon is clicked
  if (widgetWindow && !widgetWindow.isVisible()) {
    widgetWindow.show();
  }
});

