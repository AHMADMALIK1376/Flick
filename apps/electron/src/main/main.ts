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
import {
  resolveModelCacheDir,
  readConfigModelDir,
  readConfigBrowserDir,
  readConfigKey,
  pickModelDirSource,
  MODEL_DIR_ENV,
  BROWSER_DIR_ENV,
} from './model-paths';
import { safeLog, safeError, ProgressThrottle } from './logging';
import { ConnectorManager } from './connectors/connector-manager';
import { ConnectorLoginBrowser } from './connectors/connector-browser';
import { ModelDownloader } from './model-downloader';
import { ClipboardManager } from './clipboard-manager';
import { HistoryStore } from './history-store';
import { TrayManager } from './tray-manager';
import { AgentService } from './agent/agent-service';
import type { ProviderId } from './agent/llm/providers/llm-provider';

// ── Crash guards ────────────────────────────────────────────────────────────

/**
 * Last-resort guard so a background failure cannot kill the app.
 *
 * Electron's default for an uncaught exception in the main process is a modal
 * crash dialog and process exit — losing an in-flight model download. A broken
 * stdout pipe is benign and silenced; anything else is reported loudly but
 * still not fatal, since a running assistant beats a crash dialog.
 */
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err?.code === 'EPIPE') {
    return;
  }
  safeError('[Main] Uncaught exception:', err?.stack || err);
});

process.on('unhandledRejection', (reason) => {
  safeError('[Main] Unhandled rejection:', reason);
});

// ── Relocate the whole userData directory ────────────────────────────────────
//
// Moves settings, history, connectors, and all Chromium caches off the system
// drive when FLICK_USERDATA_DIR or a userDataDir in flick.config.json says so.
// Must run before any store is created or any path is read — app.setPath only
// takes effect if nothing has touched userData yet. Falls back to the default
// (and thus keeps working) if the target can't be created.
(function relocateUserData(): void {
  const env = (process.env.FLICK_USERDATA_DIR ?? '').trim();
  const configured = readConfigKey('userDataDir', [
    app.getAppPath(),
    process.cwd(),
    path.join(__dirname, '..', '..'),
    path.join(__dirname, '..', '..', '..'),
  ]);
  const dir =
    env && path.isAbsolute(env)
      ? env
      : configured && path.isAbsolute(configured)
        ? configured
        : null;
  if (!dir) return;
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    app.setPath('userData', dir);
    // sessionData holds the Chromium disk/GPU/code caches, which Electron
    // otherwise keeps under %LOCALAPPDATA% on the system drive — that was
    // ~100MB left on C: even after userData moved. Point it at the same place.
    app.setPath('sessionData', dir);
    safeLog(`[Startup] userData and sessionData relocated to ${dir}`);
  } catch (err) {
    safeError('[Startup] could not relocate userData, using default:', err);
  }
})();

// ── Model Cache Directory ───────────────────────────────────────────────────

/** Rate-limits download progress logging to one line per whole percent. */
const downloadProgressThrottle = new ProgressThrottle();

/**
 * Where Whisper model files live. Read on each use rather than captured once,
 * so changing the location in Settings takes effect without a restart.
 *
 * Creates the directory on demand — the user may point this at a drive path
 * that does not exist yet.
 */
/**
 * The model directory, from the highest-precedence source that supplies one.
 *
 * The settings file is rewritten by the app and by the settings UI, so a value
 * held only there can be erased by an unrelated save. FLICK_MODEL_DIR and
 * flick.config.json cannot be written by the app at all, so a path set there
 * survives regardless of what happens to settings.
 */
function getConfiguredModelDir(): { value: string; source: string } {
  return pickModelDirSource({
    env: process.env[MODEL_DIR_ENV],
    // Searched rather than assumed: the app root differs between a dev run
    // (electron build/main/main.js) and a packaged build.
    configFile: readConfigModelDir(
      app.getAppPath(),
      process.cwd(),
      path.join(__dirname, '..', '..'),
      path.join(__dirname, '..', '..', '..'),
    ),
    setting: settingsStore.get('modelCacheDir'),
  });
}

function getModelCacheDir(): string {
  const { value: configured, source } = getConfiguredModelDir();
  const dir = resolveModelCacheDir(configured, app.getPath('userData'));

  if (dir !== lastLoggedModelDir) {
    lastLoggedModelDir = dir;
    safeLog(`[Models] storing in ${dir} (source: ${source})`);
  }

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Last path announced, so the location is logged on change rather than per call. */
let lastLoggedModelDir: string | null = null;

/**
 * The browser profile directory — cookies, cache, saved logins for the browser
 * agent and connectors. It grows large (hundreds of MB), so like the model
 * store it is relocatable off a full system drive via FLICK_BROWSER_DIR or a
 * browserDataDir in flick.config.json. Defaults to userData/browser-data.
 */
let lastLoggedBrowserDir: string | null = null;
function getBrowserDataDir(): string {
  const env = (process.env[BROWSER_DIR_ENV] ?? '').trim();
  const configFile = readConfigBrowserDir(
    app.getAppPath(),
    process.cwd(),
    path.join(__dirname, '..', '..'),
    path.join(__dirname, '..', '..', '..'),
  );
  const setting = (settingsStore.get('browserDataDir') ?? '').trim();

  let dir: string;
  let source: string;
  if (env && path.isAbsolute(env)) {
    dir = env;
    source = BROWSER_DIR_ENV;
  } else if (configFile && path.isAbsolute(configFile)) {
    dir = configFile;
    source = 'flick.config.json';
  } else if (setting && path.isAbsolute(setting)) {
    dir = setting;
    source = 'settings';
  } else {
    dir = path.join(app.getPath('userData'), 'browser-data');
    source = 'default';
  }

  if (dir !== lastLoggedBrowserDir) {
    lastLoggedBrowserDir = dir;
    safeLog(`[Browser] profile at ${dir} (source: ${source})`);
  }
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// ── Stores & Services ───────────────────────────────────────────────────────

const historyStoreInstance = new HistoryStore();
const whisperService = new WhisperService();

// ── Connectors ───────────────────────────────────────────────────────────────
// Kept in a store of their own rather than in settings.json, which is rewritten
// often and has a history of clobbering values.
const connectorStore = new Store<{ connectedIds: string[] }>({
  name: 'connectors',
  defaults: { connectedIds: [] },
});
const connectorManager = new ConnectorManager({
  getConnectedIds: () => connectorStore.get('connectedIds'),
  setConnectedIds: (ids) => connectorStore.set('connectedIds', ids),
});
const loginBrowser = new ConnectorLoginBrowser(() => getBrowserDataDir());
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
  speak: (text) => {
    // The widget window is always alive, so it is the reliable place to speak
    // from. The renderer uses the Web Speech API with the OS voice.
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.webContents.send(IpcChannel.AGENT_SPEAK, text);
    }
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
    browserDataDir: '',
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
      agentService.setBrowserConfig({ headless: partial.browserAgentHeadless as boolean, userDataDir: getBrowserDataDir() });
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

  // ── Connectors ─────────────────────────────────────────────────────────────

  ipcMain.handle(IpcChannel.CONNECTORS_LIST, () => connectorManager.list());

  // Open a service's login page in a visible window. The agent's own browser
  // must release the shared profile first — only one Chromium can hold it.
  ipcMain.handle(
    IpcChannel.CONNECTOR_OPEN_LOGIN,
    async (_event, idOrUrl: string) => {
      const connector = connectorManager.resolve(idOrUrl);
      if (!connector) {
        return { ok: false, error: `Not a valid service or URL: "${idOrUrl}"` };
      }
      try {
        await agentService.shutdownBrowser();
        await loginBrowser.open(connector.homeUrl);
        return { ok: true, connector };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  );

  // User finished logging in. Close the window to flush the session to disk,
  // then record the connector as connected.
  ipcMain.handle(
    IpcChannel.CONNECTOR_MARK_CONNECTED,
    async (_event, id: string) => {
      await loginBrowser.close();
      connectorManager.markConnected(id);
      return connectorManager.list();
    }
  );

  ipcMain.handle(IpcChannel.CONNECTOR_DISCONNECT, (_event, id: string) => {
    connectorManager.disconnect(id);
    return connectorManager.list();
  });

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
          // Throttled and crash-safe: this fires per chunk, and a raw
          // console.log here threw EPIPE and killed the app mid-download.
          if (downloadProgressThrottle.shouldLog(progress.percentage)) {
            safeLog(
              `[Model] ${progress.status || 'downloading'}: ${progress.currentFile || ''} ${progress.percentage}%`,
            );
          }
        },
        onError: (error) => {
          safeError(`[Model] Download error: ${error.message} (${error.code})`);
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
    agentService.setBrowserConfig({ headless: settingsStore.get('browserAgentHeadless'), userDataDir: getBrowserDataDir() });
    // Before any browser task, close a connector login window if one is open —
    // both use the same profile, and only one Chromium can hold it at a time.
    agentService.setBeforeBrowserTask(() => loginBrowser.close());

    widgetWindow = createFloatingWidget();
    tray = initTray();

    const hotkey = settingsStore.get('hotkeyAccelerator');
    registerGlobalHotkey(hotkey);

    // Which file the settings actually came from, and whether the store agrees
    // with it. A run once reported values that contradicted the file on disk,
    // which means the store and the file had diverged.
    safeLog(`[Startup] settings file: ${settingsStore.path}`);
    safeLog(`[Startup] userData: ${app.getPath('userData')}`);
    try {
      const raw = fs.readFileSync(settingsStore.path, 'utf8');
      const onDisk = JSON.parse(raw) as Partial<Settings>;
      safeLog(
        `[Startup] on disk : onboardingComplete=${onDisk.onboardingComplete} modelCacheDir=${JSON.stringify(onDisk.modelCacheDir)}`,
      );
      safeLog(
        `[Startup] in store: onboardingComplete=${settingsStore.get('onboardingComplete')} modelCacheDir=${JSON.stringify(settingsStore.get('modelCacheDir'))}`,
      );
      if (onDisk.modelCacheDir !== settingsStore.get('modelCacheDir')) {
        safeError(
          '[Startup] MISMATCH: the settings store disagrees with the file on disk.',
        );
      }
    } catch (err) {
      safeError('[Startup] could not read settings file directly:', err);
    }

    // Show onboarding on first launch — or any time the model is missing.
    //
    // "Onboarding finished" and "a model is on disk" are independent facts,
    // and the download only ever happens during onboarding. Treating the flag
    // as proof a model exists strands the user: the dashboard opens, voice
    // silently never works, and no UI path exists to fetch a model. Deleting
    // the model store, selecting a model that was never downloaded, or moving
    // the model directory all produce exactly that state.
    const onboardingDone = settingsStore.get('onboardingComplete');
    const wantedModel = resolveModelId(settingsStore.get('modelName'));
    const modelReady = WhisperService.isModelReady(getModelCacheDir(), wantedModel);

    safeLog(
      `[Startup] onboardingComplete=${onboardingDone} modelReady=${modelReady} (${wantedModel})`,
    );
    const modelDirChoice = getConfiguredModelDir();
    safeLog(
      `[Startup] models will go to ${getModelCacheDir()} (source: ${modelDirChoice.source})`,
    );

    if (!onboardingDone || !modelReady) {
      if (onboardingDone) {
        safeLog('[Startup] setup was complete but no model is present — re-running setup');
      }
      onboardingWindow = createOnboardingWindow();
      onboardingWindow.show();
      onboardingWindow.focus();
      safeLog('[Startup] onboarding window opened');
    } else {
      // Create dashboard window when onboarding is already complete
      dashboardWindow = createDashboardWindow();
      dashboardWindow.once('ready-to-show', () =>
        safeLog('[Startup] dashboard window shown'),
      );
    }
  });
}

app.on('window-all-closed', () => {
  // Don't quit — keep running in tray
});

app.on('before-quit', () => {
  isQuitting = true;
  agentService.shutdownBrowser();
  void loginBrowser.close();
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

