import {
  app,
  BrowserWindow,
  Tray,
  dialog,
  globalShortcut,
  ipcMain,
  screen,
  session,
  shell,
} from 'electron';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import Store from 'electron-store';
import { IpcChannel } from '../shared/ipc-channels';
import type { AnswerPayload, Settings, ToastMessage } from '../shared/types';
import { WhisperService, resolveModelId, resolveLanguage } from './whisper-service';
import {
  resolveModelCacheDir,
  readConfigModelDir,
  readConfigKey,
  pickModelDirSource,
  MODEL_DIR_ENV,
} from './model-paths';
import { safeLog, safeError, ProgressThrottle } from './logging';
import { ModelDownloader } from './model-downloader';
import { TrayManager } from './tray-manager';
import { LLMService } from './llm/llm-service';
import type { ProviderId } from './llm/providers/llm-provider';
import { PowerPointBridge } from './presentation/powerpoint-bridge';
import {
  PresentationService,
  type DeckData,
  type LogData,
} from './presentation/presentation-service';

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
// Moves settings, decks, the question log, and all Chromium caches off the system
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
    // Transcription writes a scratch .wav per command. os.tmpdir() follows this
    // path, so redirecting it keeps those off the system drive too.
    const tempDir = path.join(dir, 'temp');
    fs.mkdirSync(tempDir, { recursive: true });
    app.setPath('temp', tempDir);
    process.env.TMPDIR = tempDir;
    process.env.TEMP = tempDir;
    process.env.TMP = tempDir;
    safeLog(`[Startup] userData, sessionData and temp relocated to ${dir}`);
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

// ── Stores & Services ───────────────────────────────────────────────────────

const whisperService = new WhisperService();
const trayManager = new TrayManager();

const settingsStore = new Store<Settings>({
  name: 'settings',
  defaults: {
    hotkeyAccelerator: process.platform === 'darwin' ? 'Cmd+Shift+Space' : 'Ctrl+Shift+Space',
    hotkeyMode: 'toggle' as const,
    // 'small' balances accuracy with speed — a live answer cannot wait on a
    // slow transcription. 'medium' is better for Urdu.
    modelName: 'small',
    modelCacheDir: '',
    language: 'en',
    showFloatingWidget: true,
    launchAtStartup: false,
    silenceDurationMs: 1500,
    widgetPosition: null,
    onboardingComplete: false,
    openaiApiKey: '',
    geminiApiKey: '',
    deepseekApiKey: '',
    anthropicApiKey: '',
    qwenApiKey: '',
    tavilyApiKey: '',
    llmProvider: 'anthropic',
    llmModel: 'claude-haiku-5-5',
    answerMode: 'speak',
  },
});

// Decks and the question log get stores of their own: a deck's slide text is
// large, and settings.json is rewritten on every settings save.
const deckStore = new Store<DeckData>({
  name: 'decks',
  defaults: { decks: [], activeDeckId: null },
});
const logStore = new Store<LogData>({
  name: 'qa-log',
  defaults: { entries: [] },
});

const llmService = new LLMService();

const presentation = new PresentationService({
  llm: llmService,
  decks: deckStore,
  log: logStore,
  bridge: new PowerPointBridge(),
  settings: () => ({
    answerMode: settingsStore.get('answerMode') ?? 'speak',
    tavilyApiKey: settingsStore.get('tavilyApiKey') ?? '',
  }),
  notifier: {
    onThinking: (question) => {
      showAnswerCard();
      send(answerWindow, IpcChannel.THINKING, question);
      send(dashboardWindow, IpcChannel.THINKING, question);
    },
    onAnswer: (answer: AnswerPayload) => {
      showAnswerCard();
      send(answerWindow, IpcChannel.ANSWER, answer);
      send(dashboardWindow, IpcChannel.ANSWER, answer);
      if (answer.speak) send(widgetWindow, IpcChannel.SPEAK, answer.answer);
    },
    onPrepProgress: (progress) => {
      send(dashboardWindow, IpcChannel.DECK_PREP_PROGRESS, progress);
    },
  },
});

/** Sends to a window if it is still alive. */
function send(win: BrowserWindow | null, channel: string, payload?: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function toast(message: string, type: ToastMessage['type'] = 'success'): void {
  send(dashboardWindow, IpcChannel.TOAST, { type, message, autoDismissMs: 4000 });
}

/** Pushes every stored API key and the chosen model into the LLM service. */
function applyLlmSettings(): void {
  const keys: Array<[ProviderId, keyof Settings]> = [
    ['openai', 'openaiApiKey'],
    ['gemini', 'geminiApiKey'],
    ['deepseek', 'deepseekApiKey'],
    ['anthropic', 'anthropicApiKey'],
    ['qwen', 'qwenApiKey'],
  ];
  for (const [provider, setting] of keys) {
    llmService.setApiKey(provider, String(settingsStore.get(setting) ?? ''));
  }
  const provider = settingsStore.get('llmProvider');
  const model = settingsStore.get('llmModel');
  if (provider && model) llmService.setActiveSelection(provider as ProviderId, model);
}

// ── Window references ───────────────────────────────────────────────────────

let widgetWindow: BrowserWindow | null = null;
let answerWindow: BrowserWindow | null = null;
let onboardingWindow: BrowserWindow | null = null;
let dashboardWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const preloadPath = () => path.join(__dirname, '..', 'preload', 'preload.js');
const rendererPath = (...parts: string[]) => path.join(__dirname, '..', 'renderer', ...parts);

// ── Window creation ─────────────────────────────────────────────────────────

/**
 * Keeps a window above a full-screen PowerPoint slideshow. The default
 * always-on-top level sits below full-screen apps on Windows.
 */
function floatAboveSlideshow(win: BrowserWindow): void {
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

function createFloatingWidget(): BrowserWindow {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  const savedPosition = settingsStore.get('widgetPosition');
  const x = savedPosition ? savedPosition.x : Math.round(screenWidth / 2 - 80);
  const y = savedPosition ? savedPosition.y : screenHeight - 60;

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
    focusable: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
      webSecurity: false,
    },
  });
  floatAboveSlideshow(win);
  win.loadFile(rendererPath('widget', 'widget.html'));

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

/**
 * The answer card: a small panel in the top-right corner that shows each
 * question, Flick's answer, where it came from, and any web sources. It is
 * shown without taking focus, so the presenter's clicker keeps driving
 * PowerPoint.
 */
function createAnswerWindow(): BrowserWindow {
  const area = screen.getPrimaryDisplay().workArea;
  const width = 440;
  const height = 340;

  const win = new BrowserWindow({
    width,
    height,
    x: area.x + area.width - width - 16,
    y: area.y + 16,
    frame: false,
    transparent: true,
    resizable: true,
    minWidth: 320,
    minHeight: 200,
    skipTaskbar: true,
    show: false,
    hasShadow: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  floatAboveSlideshow(win);
  win.loadFile(rendererPath('answer', 'answer.html'));

  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });
  return win;
}

function showAnswerCard(): void {
  if (!answerWindow || answerWindow.isDestroyed()) answerWindow = createAnswerWindow();
  if (!answerWindow.isVisible()) answerWindow.showInactive();
}

function createOnboardingWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 600,
    height: 700,
    center: true,
    resizable: true,
    frame: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(rendererPath('onboarding', 'onboarding.html'));
  win.on('closed', () => {
    onboardingWindow = null;
  });
  return win;
}

function createDashboardWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 460,
    minHeight: 520,
    center: true,
    frame: true,
    show: false,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(rendererPath('dashboard', 'dashboard.html'));

  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  win.once('ready-to-show', () => win.show());
  return win;
}

function showDashboard(): void {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.show();
    dashboardWindow.focus();
  }
}

// ── System Tray ─────────────────────────────────────────────────────────────

function initTray(): Tray {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
  return trayManager.create(iconPath, {
    onDashboard: showDashboard,
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
      presentation.questionStarting();
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
        presentation.questionStarting();
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
  ipcMain.handle(IpcChannel.GET_SETTINGS, () => settingsStore.store);

  ipcMain.handle(IpcChannel.UPDATE_SETTINGS, (_event, partial: Partial<Settings>) => {
    for (const [key, value] of Object.entries(partial)) {
      settingsStore.set(key as keyof Settings, value);
    }
    if (partial.hotkeyAccelerator || partial.hotkeyMode) {
      registerGlobalHotkey(settingsStore.get('hotkeyAccelerator'));
    }
    if ('showFloatingWidget' in partial && widgetWindow && !widgetWindow.isDestroyed()) {
      partial.showFloatingWidget ? widgetWindow.showInactive() : widgetWindow.hide();
    }
    applyLlmSettings();
  });

  ipcMain.handle(IpcChannel.WIDGET_POSITION_SAVE, (_event, position: { x: number; y: number }) => {
    settingsStore.set('widgetPosition', position);
  });

  ipcMain.handle(IpcChannel.WIDGET_POSITION_LOAD, () => settingsStore.get('widgetPosition'));

  ipcMain.handle(IpcChannel.IS_ONBOARDING_DONE, () => settingsStore.get('onboardingComplete'));

  ipcMain.handle(IpcChannel.ONBOARDING_COMPLETE, () => {
    settingsStore.set('onboardingComplete', true);
    if (onboardingWindow) {
      onboardingWindow.destroy();
      onboardingWindow = null;
    }
    if (!dashboardWindow || dashboardWindow.isDestroyed()) {
      dashboardWindow = createDashboardWindow();
    }
  });

  ipcMain.handle(IpcChannel.OPEN_SETTINGS, showDashboard);
  ipcMain.handle(IpcChannel.SHOW_DASHBOARD, showDashboard);

  ipcMain.handle(IpcChannel.QUIT_APP, () => {
    isQuitting = true;
    app.quit();
  });

  // Speech → text. Answering is a separate step (ASK), so the widget can send
  // text from either recogniser through the same path.
  ipcMain.handle(IpcChannel.TRANSCRIBE, async (_event, wavBuffer: ArrayBuffer) => {
    presentation.questionStarting();
    send(widgetWindow, IpcChannel.TRANSCRIPTION_STATUS, { status: 'transcribing' });
    try {
      if (!whisperService.isInitialized()) {
        await whisperService.initialize({
          cacheDir: getModelCacheDir(),
          modelId: resolveModelId(settingsStore.get('modelName')),
        });
      }

      const tmpFile = path.join(os.tmpdir(), `flick-${Date.now()}.wav`);
      fs.writeFileSync(tmpFile, Buffer.from(wavBuffer));
      try {
        const result = await whisperService.transcribe(
          tmpFile,
          resolveLanguage(settingsStore.get('language')),
        );
        send(widgetWindow, IpcChannel.TRANSCRIPTION_STATUS, { status: 'complete', text: result.text });
        return result;
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      send(widgetWindow, IpcChannel.TRANSCRIPTION_STATUS, { status: 'error', error: errorMsg });
      throw err;
    }
  });

  // ── Presentation ───────────────────────────────────────────────────────────

  ipcMain.handle(IpcChannel.ASK, (_event, text: string) => presentation.ask(String(text ?? '')));

  ipcMain.handle(IpcChannel.DECK_UPLOAD, async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose your presentation',
      filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
      properties: ['openFile'],
    };
    const picked =
      dashboardWindow && !dashboardWindow.isDestroyed()
        ? await dialog.showOpenDialog(dashboardWindow, options)
        : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true };
    return loadDeck(() => presentation.loadDeckFromFile(picked.filePaths[0]));
  });

  ipcMain.handle(IpcChannel.DECK_LOAD_FROM_POWERPOINT, () =>
    loadDeck(() => presentation.loadDeckFromPowerPoint()),
  );

  ipcMain.handle(IpcChannel.DECK_LIST, () => presentation.listDecks());
  ipcMain.handle(IpcChannel.DECK_GET, (_event, id: string) => presentation.getDeck(id));
  ipcMain.handle(IpcChannel.DECK_ACTIVATE, (_event, id: string) => {
    presentation.activateDeck(id);
    return presentation.listDecks();
  });
  ipcMain.handle(IpcChannel.DECK_DELETE, (_event, id: string) => {
    presentation.deleteDeck(id);
    return presentation.listDecks();
  });
  ipcMain.handle(IpcChannel.DECK_PREPARE, (_event, id: string) => {
    void presentation.prepareDeck(id);
  });

  ipcMain.handle(IpcChannel.QA_LOG_GET, () => presentation.getLog());
  ipcMain.handle(IpcChannel.QA_LOG_CLEAR, () => presentation.clearLog());

  ipcMain.handle(IpcChannel.SPEAK, (_event, text: string) => send(widgetWindow, IpcChannel.SPEAK, text));
  ipcMain.handle(IpcChannel.STOP_SPEAKING, () => send(widgetWindow, IpcChannel.STOP_SPEAKING));
  ipcMain.handle(IpcChannel.ANSWER_CARD_HIDE, () => {
    if (answerWindow && !answerWindow.isDestroyed()) answerWindow.hide();
  });

  ipcMain.handle(IpcChannel.OPEN_EXTERNAL, (_event, url: string) => {
    // Only web links — never file:// or app protocols from model output.
    if (/^https?:\/\//i.test(String(url))) void shell.openExternal(url);
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

/** Loads a deck and reports the outcome in a shape the dashboard can show. */
async function loadDeck(load: () => Promise<{ id: string; name: string; slides: unknown[] }>) {
  try {
    const deck = await load();
    toast(`Loaded "${deck.name}" (${deck.slides.length} slides). Preparing questions…`);
    return { ok: true, deckId: deck.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    safeError('[Deck] load failed:', message);
    return { ok: false, error: message };
  }
}

// ── App Lifecycle ───────────────────────────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) showDashboard();
    else if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.show();
  });

  app.whenReady().then(() => {
    // The microphone is the only permission Flick's windows ask for.
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === 'media');
    });

    setupIPC();
    applyLlmSettings();

    widgetWindow = createFloatingWidget();
    if (!settingsStore.get('showFloatingWidget')) widgetWindow.hide();
    answerWindow = createAnswerWindow();
    tray = initTray();
    registerGlobalHotkey(settingsStore.get('hotkeyAccelerator'));

    safeLog(`[Startup] settings file: ${settingsStore.path}`);
    safeLog(`[Startup] userData: ${app.getPath('userData')}`);

    // Show onboarding on first launch, or whenever the Whisper model is
    // missing — the model download only happens during onboarding.
    const onboardingDone = settingsStore.get('onboardingComplete');
    const wantedModel = resolveModelId(settingsStore.get('modelName'));
    const modelReady = WhisperService.isModelReady(getModelCacheDir(), wantedModel);
    safeLog(`[Startup] onboardingComplete=${onboardingDone} modelReady=${modelReady} (${wantedModel})`);

    if (!onboardingDone || !modelReady) {
      onboardingWindow = createOnboardingWindow();
      onboardingWindow.show();
      onboardingWindow.focus();
    } else {
      dashboardWindow = createDashboardWindow();
    }
  });
}

app.on('window-all-closed', () => {
  // Don't quit — keep running in the tray.
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopUiohook();
});

app.on('activate', () => {
  if (widgetWindow && !widgetWindow.isVisible()) widgetWindow.show();
});
