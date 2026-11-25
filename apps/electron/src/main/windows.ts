/**
 * Flick's windows. They all show the React UI (apps/ui) at different routes:
 *   dashboard  #/          main window with the sidebar
 *   card       #/card      floating answer card, above the PowerPoint slide show
 *   mic        #/mic       small floating mic button
 *   canvas     #/canvas    Flick's whiteboard, over the slide show, when it draws for the class
 *   presenter  #/presenter compact view for a second screen
 */
import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import type { BackendInfo } from './sidecar';

export type UiSource = { kind: 'url'; base: string } | { kind: 'file'; indexHtml: string };

const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');

function load(win: BrowserWindow, ui: UiSource, backend: BackendInfo, route: string): void {
  const query = { port: String(backend.port), token: backend.token };
  if (ui.kind === 'url') {
    const params = new URLSearchParams(query).toString();
    void win.loadURL(`${ui.base.replace(/\/$/, '')}/?${params}#/${route}`);
  } else {
    void win.loadFile(ui.indexHtml, { query, hash: `/${route}` });
  }
}

function base(extra: Electron.BrowserWindowConstructorOptions): Electron.BrowserWindowConstructorOptions {
  return {
    show: false,
    backgroundColor: '#f1eff6',
    autoHideMenuBar: true,
    ...extra,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false, // the card and mic must react while hidden
      ...extra.webPreferences,
    },
  };
}

function floating(extra: Electron.BrowserWindowConstructorOptions): Electron.BrowserWindowConstructorOptions {
  return base({
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false, // clicking it does not take focus away from PowerPoint
    hasShadow: false,
    ...extra,
  });
}

export function createDashboard(ui: UiSource, backend: BackendInfo, iconPath: string): BrowserWindow {
  const win = new BrowserWindow(
    base({ width: 1280, height: 860, minWidth: 980, minHeight: 640, title: 'Flick', icon: iconPath }),
  );
  load(win, ui, backend, '');
  win.once('ready-to-show', () => win.show());
  return win;
}

export function createCard(ui: UiSource, backend: BackendInfo): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 440;
  const height = 340;
  const win = new BrowserWindow(
    floating({ width, height, x: workArea.x + workArea.width - width - 24, y: workArea.y + 24, resizable: true }),
  );
  win.setAlwaysOnTop(true, 'screen-saver'); // stay above the PowerPoint slide show
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  load(win, ui, backend, 'card');
  return win;
}

export function createMic(ui: UiSource, backend: BackendInfo): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 170;
  const height = 80;
  const win = new BrowserWindow(
    floating({ width, height, x: workArea.x + workArea.width - width - 24, y: workArea.y + workArea.height - height - 24 }),
  );
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  load(win, ui, backend, 'mic');
  return win;
}

/** The whole screen the slide show is on (the primary one). */
export function canvasBounds(): Electron.Rectangle {
  return { ...screen.getPrimaryDisplay().bounds };
}

export function createCanvas(ui: UiSource, backend: BackendInfo): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(1080, workArea.width - 80);
  const height = Math.min(700, workArea.height - 80);
  const win = new BrowserWindow(
    floating({
      width,
      height,
      x: workArea.x + Math.round((workArea.width - width) / 2),
      y: workArea.y + Math.round((workArea.height - height) / 2),
      resizable: true,
    }),
  );
  win.setAlwaysOnTop(true, 'screen-saver'); // over the slide show
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  load(win, ui, backend, 'canvas');
  return win;
}

export function createPresenter(ui: UiSource, backend: BackendInfo, iconPath: string): BrowserWindow {
  const win = new BrowserWindow(base({ width: 420, height: 560, title: 'Flick: Presenter view', icon: iconPath }));
  load(win, ui, backend, 'presenter');
  win.once('ready-to-show', () => win.show());
  return win;
}
