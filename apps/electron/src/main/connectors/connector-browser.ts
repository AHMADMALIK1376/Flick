import { chromium, type BrowserContext } from 'playwright';
import { safeError, safeLog } from '../logging';

/**
 * A visible browser window the user drives to log into a service.
 *
 * Uses the same persistent profile directory as the browser agent, so a login
 * completed here is saved to disk and reused by browser_task. Only one login
 * window is open at a time, and it must not run while the agent's own browser
 * holds the profile — the caller shuts that down first (the profile directory
 * can be held by only one Chromium at a time).
 */
export class ConnectorLoginBrowser {
  private context: BrowserContext | null = null;

  constructor(private readonly userDataDir: string) {}

  /**
   * Opens the service's page in a visible window for the user to sign in.
   * Resolves once the page has been opened, not when login is finished — the
   * user signals completion separately.
   */
  async open(homeUrl: string): Promise<void> {
    await this.close();

    this.context = await this.launch();

    this.context.on('close', () => {
      this.context = null;
    });

    const page = this.context.pages()[0] ?? (await this.context.newPage());
    // 'commit' resolves as soon as navigation starts — we only need the page
    // open for the user, not fully loaded, and some sites never go idle.
    await page.goto(homeUrl, { waitUntil: 'commit' }).catch(() => {});
    await page.bringToFront();

    safeLog(`[Connectors] login window opened at ${homeUrl}`);
  }

  /**
   * Closes the login window, flushing the session to disk so browser_task can
   * reuse it. Safe to call when nothing is open.
   */
  async close(): Promise<void> {
    if (!this.context) return;
    try {
      await this.context.close();
    } catch (err) {
      safeError('[Connectors] error closing login window:', err);
    } finally {
      this.context = null;
    }
  }

  get isOpen(): boolean {
    return this.context !== null;
  }

  /**
   * Launches a login window that looks like an ordinary browser.
   *
   * Google (and some others) refuse sign-in from a browser they detect as
   * automated. Two things defeat that detection: using the real installed
   * Chrome rather than Playwright's bundled Chromium, and removing the
   * --enable-automation flag that sets navigator.webdriver and shows the
   * "controlled by automated software" banner.
   *
   * Falls back to bundled Chromium (still with the flags stripped) if Chrome
   * is not installed — logins to less strict sites still work there.
   */
  private async launch(): Promise<BrowserContext> {
    const options = {
      headless: false,
      viewport: null,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--start-maximized',
        '--disable-blink-features=AutomationControlled',
      ],
    };

    try {
      return await chromium.launchPersistentContext(this.userDataDir, {
        ...options,
        channel: 'chrome',
      });
    } catch (err) {
      safeError(
        '[Connectors] real Chrome unavailable, falling back to bundled Chromium:',
        err,
      );
      return chromium.launchPersistentContext(this.userDataDir, options);
    }
  }
}
