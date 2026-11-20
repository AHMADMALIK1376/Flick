import { execFile } from 'child_process';

/**
 * Talks to a running Microsoft PowerPoint on Windows through its COM
 * automation interface, via PowerShell. Two questions only:
 *
 *  - Which slide is on screen? (so answers favour what the audience is looking at)
 *  - Which file is open? (so the presenter can load their deck in one click)
 *
 * Read-only: Flick never changes the presentation. On other platforms, or when
 * PowerPoint is not running, every answer is simply null.
 */

export type ScriptRunner = (script: string, timeoutMs: number) => Promise<string>;

const SLIDE_TIMEOUT_MS = 4_000;
const PATH_TIMEOUT_MS = 6_000;
/** A slide number older than this is re-read rather than reused. */
const SLIDE_CACHE_MS = 15_000;

/**
 * Gets the running PowerPoint, or exits quietly when there is none. Prefers
 * the slideshow window (presenting), then the editing window.
 */
const ATTACH = `
$ErrorActionPreference = 'Stop'
try { $pp = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') } catch { exit 0 }
`;

const CURRENT_SLIDE_SCRIPT = `${ATTACH}
try {
  if ($pp.SlideShowWindows.Count -gt 0) { $pp.SlideShowWindows.Item(1).View.Slide.SlideIndex; exit 0 }
} catch {}
try {
  if ($pp.Windows.Count -gt 0) { $pp.ActiveWindow.View.Slide.SlideIndex }
} catch {}
`;

const ACTIVE_PATH_SCRIPT = `${ATTACH}
try {
  if ($pp.SlideShowWindows.Count -gt 0) { $pp.SlideShowWindows.Item(1).Presentation.FullName; exit 0 }
} catch {}
try {
  if ($pp.Presentations.Count -gt 0) { $pp.ActivePresentation.FullName }
} catch {}
`;

export const runPowerShell: ScriptRunner = (script, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: timeoutMs, windowsHide: true },
      // Any failure means "no answer" — this is an enhancement, never a blocker.
      (_err, stdout) => resolve(String(stdout ?? '').trim()),
    );
  });

export class PowerPointBridge {
  private cached: { slide: number | null; at: number } | null = null;
  private inFlight: Promise<number | null> | null = null;

  constructor(
    private readonly run: ScriptRunner = runPowerShell,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly now: () => number = Date.now,
  ) {}

  get supported(): boolean {
    return this.platform === 'win32';
  }

  /**
   * Starts reading the current slide in the background. Called when the
   * presenter starts speaking, so the answer does not wait on PowerShell.
   */
  prefetchCurrentSlide(): void {
    if (this.supported && !this.inFlight) void this.readCurrentSlide();
  }

  /**
   * The slide on screen, from a recent read when there is one. `fresh` skips
   * the cache: explaining "this slide" must use the slide showing right now,
   * not one from fifteen seconds ago.
   */
  async currentSlide(opts: { fresh?: boolean } = {}): Promise<number | null> {
    if (!this.supported) return null;
    // A read already under way (prefetched when recording started) is fresher
    // than any cached value.
    if (this.inFlight) return this.inFlight;
    if (!opts.fresh && this.cached && this.now() - this.cached.at < SLIDE_CACHE_MS) return this.cached.slide;
    return this.readCurrentSlide();
  }

  /** Full path of the presentation open in PowerPoint, if any. */
  async activePresentationPath(): Promise<string | null> {
    if (!this.supported) return null;
    return lastLine(await this.run(ACTIVE_PATH_SCRIPT, PATH_TIMEOUT_MS)) || null;
  }

  private readCurrentSlide(): Promise<number | null> {
    this.inFlight = this.run(CURRENT_SLIDE_SCRIPT, SLIDE_TIMEOUT_MS)
      .then((out) => {
        const n = parseInt(lastLine(out), 10);
        const slide = Number.isInteger(n) && n > 0 ? n : null;
        this.cached = { slide, at: this.now() };
        return slide;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}

/** Last non-empty line of script output — the value, after any warnings. */
function lastLine(out: string): string {
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? '';
}
