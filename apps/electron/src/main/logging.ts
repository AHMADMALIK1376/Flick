/**
 * Console writes that cannot crash the app.
 *
 * Writing to stdout throws EPIPE once the receiving end is gone — a terminal
 * closed mid-run, output piped to a command that has exited. In a callback
 * that fires hundreds of times, such as download progress, that throw becomes
 * an uncaught exception and Electron kills the process with a crash dialog.
 *
 * Losing a log line is acceptable. Losing a 1.5GB download because a log line
 * could not be written is not.
 */
export function safeLog(...args: unknown[]): void {
  try {
    console.log(...args);
  } catch {
    // stdout is gone; nothing useful to do and nowhere to report it.
  }
}

export function safeError(...args: unknown[]): void {
  try {
    console.error(...args);
  } catch {
    // As above.
  }
}

/**
 * Emits a progress line only when the whole-percent value changes.
 *
 * Download callbacks fire per chunk, which produced dozens of identical "0%"
 * lines per second — noise that also multiplied the chance of hitting a broken
 * pipe.
 */
export class ProgressThrottle {
  private last = -1;

  shouldLog(percentage: number): boolean {
    if (!Number.isFinite(percentage)) {
      return false;
    }

    const whole = Math.floor(percentage);
    if (whole === this.last) {
      return false;
    }

    this.last = whole;
    return true;
  }

  /** Call when a new download starts, so its 0% line is emitted. */
  reset(): void {
    this.last = -1;
  }
}
