import * as fs from 'fs';
import { WakeWordListener, type WakeEngine, type FrameRecorder } from './wake-word';
import { safeError, safeLog } from './logging';

/**
 * Resolves a wake-word setting to something Porcupine accepts.
 *
 * A built-in keyword name ("JARVIS", "COMPUTER", ...) maps to the built-in
 * enum and needs no file. A path ending in .ppn is a custom keyword (e.g. a
 * generated "Flick"). Anything else falls back to the built-in Jarvis — fitting
 * for the assistant, and it needs no keyword file.
 */
export function resolveKeyword(
  wakeWord: string | undefined,
  builtins: Record<string, unknown>,
): { keyword: unknown; label: string } {
  const value = (wakeWord ?? '').trim();

  if (value.toLowerCase().endsWith('.ppn')) {
    if (fs.existsSync(value)) {
      return { keyword: value, label: `custom (${value})` };
    }
    safeError(`[Wake] custom keyword file not found: ${value}; using Jarvis`);
    return { keyword: builtins.JARVIS, label: 'JARVIS (fallback)' };
  }

  const key = value.toUpperCase().replace(/\s+/g, '_');
  if (key && key in builtins) {
    return { keyword: builtins[key], label: key };
  }

  return { keyword: builtins.JARVIS, label: 'JARVIS (default)' };
}

/**
 * Builds a real Porcupine-backed listener, or null if it cannot be created.
 *
 * Returns null — rather than throwing — for every failure mode (no access key,
 * bad key, native module missing, no microphone). Wake-word activation is a
 * bonus; its absence must never stop Flick from starting, and the hotkey path
 * keeps working regardless.
 */
export function createPorcupineListener(options: {
  accessKey: string;
  wakeWord: string | undefined;
  onWake: () => void;
}): WakeWordListener | null {
  const accessKey = options.accessKey?.trim();
  if (!accessKey) {
    return null;
  }

  let Porcupine: new (
    accessKey: string,
    keywords: unknown[],
    sensitivities: number[],
  ) => {
    frameLength: number;
    process(frame: Int16Array): number;
    release(): void;
  };
  let BuiltinKeyword: Record<string, unknown>;
  let PvRecorder: new (
    frameLength: number,
    deviceIndex?: number,
  ) => {
    start(): void;
    stop(): void;
    release(): void;
    read(): Promise<Int16Array>;
    isRecording: boolean;
  };

  try {
    // Required lazily so a missing native module degrades to "no wake word"
    // rather than a startup crash.
    ({ Porcupine, BuiltinKeyword } = require('@picovoice/porcupine-node'));
    ({ PvRecorder } = require('@picovoice/pvrecorder-node'));
  } catch (err) {
    safeError('[Wake] Porcupine native module unavailable:', err);
    return null;
  }

  const { keyword, label } = resolveKeyword(options.wakeWord, BuiltinKeyword);

  let porcupine: InstanceType<typeof Porcupine>;
  let recorder: InstanceType<typeof PvRecorder>;
  try {
    porcupine = new Porcupine(accessKey, [keyword], [0.5]);
    recorder = new PvRecorder(porcupine.frameLength, -1);
  } catch (err) {
    // Almost always an invalid or expired access key.
    safeError('[Wake] could not initialise Porcupine (check the access key):', err);
    return null;
  }

  safeLog(`[Wake] wake word ready: ${label}`);

  const engine: WakeEngine = {
    frameLength: porcupine.frameLength,
    process: (frame) => porcupine.process(frame),
    release: () => porcupine.release(),
  };

  const frameRecorder: FrameRecorder = {
    get isRecording() {
      return recorder.isRecording;
    },
    start: () => recorder.start(),
    stop: () => recorder.stop(),
    release: () => recorder.release(),
    read: () => recorder.read(),
  };

  return new WakeWordListener(engine, frameRecorder, options.onWake);
}
