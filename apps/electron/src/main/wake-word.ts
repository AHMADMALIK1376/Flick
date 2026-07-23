import { safeError, safeLog } from './logging';

/**
 * Minimal shape of the Porcupine engine, so the listen loop can be tested
 * without the native module or a microphone.
 */
export interface WakeEngine {
  /** Frames Porcupine expects per process() call. */
  readonly frameLength: number;
  /** Returns the index of the detected keyword, or -1 for none. */
  process(frame: Int16Array): number;
  release(): void;
}

/**
 * Minimal shape of the microphone recorder.
 */
export interface FrameRecorder {
  start(): void;
  stop(): void;
  release(): void;
  /** Reads one frame of `frameLength` samples. */
  read(): Promise<Int16Array>;
  readonly isRecording: boolean;
}

/**
 * Listens for the wake word on the microphone and fires a callback when heard.
 *
 * The engine and recorder are injected so the loop is testable without the
 * native Porcupine module or real audio. In production they are the real
 * Porcupine and PvRecorder; in tests they are fakes.
 *
 * Deliberately tolerant: a read or process error is logged and the loop
 * continues, because a transient audio glitch must not permanently deafen the
 * assistant.
 */
/** Sentinel the loop sees when stop() unblocks a pending read. */
const STOP = Symbol('stop');

export class WakeWordListener {
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private resolveStop: (() => void) | null = null;

  constructor(
    private readonly engine: WakeEngine,
    private readonly recorder: FrameRecorder,
    private readonly onWake: () => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.recorder.start();
    this.loopPromise = this.loop();
    safeLog('[Wake] listening for the wake word');
  }

  /** Stops listening and releases the microphone. Safe to call repeatedly. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    // Unblock a read() that may never resolve on its own (a stalled mic), so
    // shutdown cannot hang waiting for the loop.
    this.resolveStop?.();
    try {
      await this.loopPromise;
    } finally {
      this.loopPromise = null;
      try {
        this.recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    safeLog('[Wake] stopped listening');
  }

  /** Releases native resources. Call once at shutdown. */
  release(): void {
    try {
      this.recorder.release();
    } catch {
      /* ignore */
    }
    try {
      this.engine.release();
    } catch {
      /* ignore */
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  private async loop(): Promise<void> {
    const stopped = new Promise<typeof STOP>((resolve) => {
      this.resolveStop = () => resolve(STOP);
    });

    while (this.running) {
      let frame: Int16Array | typeof STOP;
      try {
        // Race the read against stop() so a hung mic cannot trap the loop.
        frame = await Promise.race([this.recorder.read(), stopped]);
      } catch (err) {
        if (this.running) safeError('[Wake] mic read failed:', err);
        continue;
      }

      if (frame === STOP || !this.running) break;

      let index: number;
      try {
        index = this.engine.process(frame);
      } catch (err) {
        safeError('[Wake] process failed:', err);
        continue;
      }

      if (index >= 0 && this.running) {
        safeLog(`[Wake] wake word detected (index ${index})`);
        try {
          this.onWake();
        } catch (err) {
          safeError('[Wake] onWake handler threw:', err);
        }
      }
    }
  }
}
