/**
 * The small bridge between the React UI and the desktop shell: window.flick.
 * Sandboxed preload: it may only use 'electron', so channel names are written here.
 */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

function on(channel: string, callback: (...args: unknown[]) => void): () => void {
  const listener = (_event: IpcRendererEvent, ...args: unknown[]) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('flick', {
  isDesktop: true,
  /** The real path of a dropped or picked file, so Flick can open the same deck in PowerPoint. */
  pathForFile: (file: File) => {
    try {
      return (file as File & { path?: string }).path || ''; // Electron 28 adds .path to files
    } catch {
      return '';
    }
  },
  /** Mic window: the Ask hotkey was pressed. */
  onToggleAsk: (callback: () => void) => on('flick:toggle-ask', () => callback()),
  /** Mic window: recording started / stopped (so the card can show "Listening…"). */
  setListening: (listening: boolean) => ipcRenderer.send('flick:listening', listening),
  setMicMode: (mode: 'button' | 'panel') => ipcRenderer.send('flick:mic-mode', mode),
  /** Card window: recording started / stopped somewhere. */
  onListening: (callback: (listening: boolean) => void) => on('flick:listening', (v) => callback(Boolean(v))),
  /** Card window: show or hide the floating card. */
  showCard: () => ipcRenderer.send('flick:show-card'),
  hideCard: () => ipcRenderer.send('flick:hide-card'),
  /** Whiteboard window: show or hide it. */
  showCanvas: () => ipcRenderer.send('flick:show-canvas'),
  hideCanvas: () => ipcRenderer.send('flick:hide-canvas'),
});
