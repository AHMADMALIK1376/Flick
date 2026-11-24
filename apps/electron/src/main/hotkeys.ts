/**
 * Global hotkeys (work even while PowerPoint is in slide show).
 * Re-registered whenever the user changes them in Settings.
 */
import { globalShortcut } from 'electron';
import { toAccelerator } from './hotkey-format';
import { safeError } from './logging';

export interface HotkeyHandlers {
  ask: () => void;
  explain: () => void;
}

export class Hotkeys {
  private ask: string | null = null;
  private explain: string | null = null;

  constructor(private readonly handlers: HotkeyHandlers) {}

  /** Registers the two hotkeys. Returns the ones that could not be registered (taken by another app). */
  apply(askHotkey: string, explainHotkey: string): string[] {
    const ask = toAccelerator(askHotkey);
    const explain = toAccelerator(explainHotkey);
    if (ask === this.ask && explain === this.explain) return [];

    globalShortcut.unregisterAll();
    this.ask = ask;
    this.explain = explain;
    const failed: string[] = [];
    for (const [accelerator, handler] of [
      [ask, this.handlers.ask],
      [explain, this.handlers.explain],
    ] as const) {
      if (!accelerator) continue;
      try {
        if (!globalShortcut.register(accelerator, handler)) failed.push(accelerator);
      } catch (err) {
        safeError('[flick] bad hotkey', accelerator, err);
        failed.push(accelerator);
      }
    }
    return failed;
  }

  dispose(): void {
    globalShortcut.unregisterAll();
  }
}
