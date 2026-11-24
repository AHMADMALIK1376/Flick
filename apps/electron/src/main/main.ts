/**
 * Flick desktop app.
 *
 * 1. Starts the Python backend (sidecar.ts) with a private port + token.
 * 2. Opens the React UI windows (windows.ts): dashboard, floating answer card, floating mic.
 * 3. Registers the global hotkeys from Settings (hotkeys.ts) and keeps them in sync.
 *
 * Speaking answers aloud happens in the card window (apps/ui: useAutoSpeak).
 *
 * Run in development (from apps/electron):
 *   npm run start     uses the built UI (apps/ui/dist: run `npm run build` there first)
 *   npm run dev       uses the Vite dev server at http://127.0.0.1:5173 (`npm run dev` in apps/ui)
 */
import { app, BrowserWindow, dialog, ipcMain, session, Tray } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { BackendClient, DesktopSettings } from './backend-client';
import { Hotkeys } from './hotkeys';
import { safeError, safeLog } from './logging';
import { Backend, BackendInfo, launchPlan } from './sidecar';
import { createTray } from './tray';
import { createCard, createDashboard, createMic, createPresenter, UiSource } from './windows';

const SETTINGS_SYNC_MS = 3000;
const DEV_UI_URL = 'http://127.0.0.1:5173';

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..'); // build/main → repo root
const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');

let backend: Backend | null = null;
let client: BackendClient | null = null;
let info: BackendInfo | null = null;
let ui: UiSource | null = null;
let dashboard: BrowserWindow | null = null;
let card: BrowserWindow | null = null;
let mic: BrowserWindow | null = null;
let presenter: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let syncTimer: NodeJS.Timeout | null = null;
let lastSettings: DesktopSettings | null = null;
let warnedHotkeys = '';

const hotkeys = new Hotkeys({ ask: toggleAsk, explain: explainSlide });

function uiSource(): UiSource | null {
  if (!app.isPackaged && process.argv.includes('--dev-ui')) return { kind: 'url', base: DEV_UI_URL };
  const indexHtml = app.isPackaged
    ? path.join(process.resourcesPath, 'ui', 'index.html')
    : path.join(repoRoot, 'apps', 'ui', 'dist', 'index.html');
  return fs.existsSync(indexHtml) ? { kind: 'file', indexHtml } : null;
}

// ── Actions ──────────────────────────────────────────────────────────────────

function toggleAsk(): void {
  if (!mic || mic.isDestroyed()) return;
  client?.questionStarting().catch(() => undefined); // look up the slide early
  mic.webContents.send('flick:toggle-ask');
}

function explainSlide(): void {
  // The answer streams to the card through live events, and is spoken there.
  client?.explain().catch((err) => safeError('[flick] explain failed:', err));
}

function openDashboard(): void {
  if (!dashboard || dashboard.isDestroyed()) {
    if (!ui || !info) return;
    dashboard = createDashboard(ui, info, iconPath);
    keepOpenUntilQuit(dashboard);
  }
  dashboard.show();
  dashboard.focus();
}

function openPresenter(): void {
  if (!ui || !info) return;
  if (!presenter || presenter.isDestroyed()) presenter = createPresenter(ui, info, iconPath);
  else presenter.show();
}

/** Closing the dashboard hides it: Flick keeps running in the tray, hotkeys keep working. */
function keepOpenUntilQuit(win: BrowserWindow): void {
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
}

// ── Settings → hotkeys + mic ──────────────────────────────────────────────

async function syncSettings(): Promise<void> {
  if (!client) return;
  let settings: DesktopSettings;
  try {
    settings = await client.getSettings();
  } catch {
    return; // backend restarting; try again next time
  }
  const failed = hotkeys.apply(settings.ask_hotkey, settings.explain_hotkey);
  const failedKey = failed.join(', ');
  if (failed.length > 0 && failedKey !== warnedHotkeys) {
    warnedHotkeys = failedKey;
    dialog.showMessageBox({
      type: 'warning',
      title: 'Flick',
      message: `Another app is using ${failedKey}.`,
      detail: 'Choose a different shortcut in Flick → Settings → Voice.',
    });
  }
  if (!lastSettings || lastSettings.show_mic !== settings.show_mic) {
    if (settings.show_mic) mic?.showInactive();
    else mic?.hide();
  }
  lastSettings = settings;
}

// ── IPC from the UI windows ─────────────────────────────────────────────────

function showCard(): void {
  if (!card || card.isDestroyed()) return;
  if (!card.isVisible()) card.showInactive(); // don't take focus from PowerPoint
  card.setAlwaysOnTop(true, 'screen-saver');
  card.moveTop();
}

ipcMain.on('flick:show-card', showCard);
ipcMain.on('flick:hide-card', () => card?.hide());
ipcMain.on('flick:listening', (_event, listening: boolean) => {
  if (!card || card.isDestroyed()) return;
  card.webContents.send('flick:listening', listening);
  if (listening) showCard();
});

// ── Start-up ─────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  // Allow the microphone for our own windows.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  ui = uiSource();
  if (!ui) {
    dialog.showErrorBox(
      'Flick: screens not built',
      'Build the screens first:\n\ncd apps\\ui\nnpm install\nnpm run build\n\nOr run "npm run dev" in apps/ui and start Flick with "npm run dev".',
    );
    app.quit();
    return;
  }

  backend = new Backend((port) =>
    launchPlan({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      repoRoot,
      platform: process.platform,
      env: process.env,
      port,
    }),
  );
  try {
    info = await backend.start();
  } catch (err) {
    const hint = app.isPackaged
      ? 'Try reinstalling Flick.'
      : 'Check that Python 3.12 is installed and run:\n  cd backend\n  pip install -r requirements.txt';
    dialog.showErrorBox(
      'Flick could not start',
      `${err instanceof Error ? err.message : String(err)}\n\n${hint}\n\nLast output:\n${backend.recentOutput()}`,
    );
    app.quit();
    return;
  }
  client = new BackendClient(info);

  card = createCard(ui, info);
  mic = createMic(ui, info);
  dashboard = createDashboard(ui, info, iconPath);
  keepOpenUntilQuit(dashboard);

  tray = createTray(iconPath, {
    openDashboard,
    openPresenter,
    ask: toggleAsk,
    explain: explainSlide,
    present: () => {
      client?.presentStart().catch(() => openDashboard()); // e.g. no deck yet: show why
    },
    stopPresenting: () => {
      client?.presentStop().catch(() => undefined);
    },
    quit: () => app.quit(),
  });

  await syncSettings();
  syncTimer = setInterval(() => void syncSettings(), SETTINGS_SYNC_MS);
  safeLog(`[flick] ready (backend on port ${info.port})`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', openDashboard);
  app.whenReady().then(start);

  // Flick lives in the tray: closing windows does not quit it.
  app.on('window-all-closed', () => undefined);

  app.on('before-quit', () => {
    quitting = true;
    if (syncTimer) clearInterval(syncTimer);
    hotkeys.dispose();
    tray?.destroy();
    backend?.stop();
  });
}
