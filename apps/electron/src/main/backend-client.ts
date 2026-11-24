/** The few backend calls the desktop shell itself needs (the UI makes all the others). */
import type { BackendInfo } from './sidecar';

export interface DesktopSettings {
  ask_hotkey: string;
  explain_hotkey: string;
  hotkey_mode: 'toggle' | 'push-to-talk';
  show_mic: boolean;
}

export class BackendClient {
  constructor(private readonly info: BackendInfo) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`http://127.0.0.1:${this.info.port}${path}`, {
      method,
      headers: { 'X-Flick-Token': this.info.token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Backend ${method} ${path} failed (${res.status})`);
    return (await res.json()) as T;
  }

  getSettings(): Promise<DesktopSettings> {
    return this.request('GET', '/settings');
  }

  /** Explains the slide on screen. The answer reaches the card through live events. */
  explain(): Promise<unknown> {
    return this.request('POST', '/explain', { slide: null });
  }

  /** "Present for me" from the tray. */
  presentStart(): Promise<unknown> {
    return this.request('POST', '/present/start', { from_slide: null });
  }

  presentStop(): Promise<unknown> {
    return this.request('POST', '/present/stop');
  }

  questionStarting(): Promise<unknown> {
    return fetch(`http://127.0.0.1:${this.info.port}/question-starting`, {
      method: 'POST',
      headers: { 'X-Flick-Token': this.info.token },
    });
  }
}
