import { shell, app, clipboard } from 'electron';
import { exec } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import {
  ClassifiedIntent,
  ExecutionResult,
  BrowserTaskNotifier,
  BrowserTaskResult,
} from '../../shared/types';
import { BrowserAgent } from './browser-agent';
import { LLMService } from './llm/llm-service';

/**
 * Application name mapping for Windows `start` command.
 * Maps common spoken names to their executable/start-command names.
 */
const APP_NAME_MAP: Record<string, string> = {
  'chrome': 'chrome',
  'google chrome': 'chrome',
  'firefox': 'firefox',
  'notepad': 'notepad',
  'calculator': 'calc',
  'spotify': 'spotify',
  'vscode': 'code',
  'visual studio code': 'code',
  'file explorer': 'explorer',
  'explorer': 'explorer',
  'word': 'winword',
  'excel': 'excel',
  'powerpoint': 'powerpnt',
  'terminal': 'wt',
  'command prompt': 'cmd',
  'task manager': 'taskmgr',
};

/**
 * Folder alias mapping — resolves spoken folder names to full paths.
 */
function getFolderAliases(): Record<string, string> {
  const home = os.homedir();
  return {
    'documents': path.join(home, 'Documents'),
    'my documents': path.join(home, 'Documents'),
    'downloads': path.join(home, 'Downloads'),
    'desktop': path.join(home, 'Desktop'),
    'pictures': path.join(home, 'Pictures'),
    'music': path.join(home, 'Music'),
    'videos': path.join(home, 'Videos'),
  };
}

/** Timeout in milliseconds for child_process operations */
const EXEC_TIMEOUT_MS = 5000;

/**
 * Wraps child_process.exec in a Promise with a 5-second timeout.
 */
function execAsync(command: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: EXEC_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Executes classified intents using platform-appropriate methods (Windows).
 * All system actions use PowerShell/child_process or Electron shell APIs.
 */
export class ActionExecutor {
  private browserAgent: BrowserAgent | null = null;
  private browserConfig: { headless: boolean; userDataDir?: string } = {
    headless: false,
  };
  private browserNotifier: BrowserTaskNotifier | null = null;
  private llm: LLMService | null = null;
  private currentAbortController: AbortController | null = null;
  /** Runs before a browser task launches, to free the shared browser profile. */
  private beforeBrowserTask: (() => Promise<void>) | null = null;

  /** Sets a hook run before each browser task (e.g. close a login window). */
  setBeforeBrowserTask(fn: () => Promise<void>): void {
    this.beforeBrowserTask = fn;
  }

  /**
   * Sets the shared LLMService used for browser-task LLM access.
   * Propagates to an existing BrowserAgent's config-driven creation on next use.
   */
  setLLMService(llm: LLMService): void {
    this.llm = llm;
  }

  /**
   * Sets the notifier used for browser task progress/result communication.
   * Also creates the BrowserAgent instance if an LLMService is available.
   */
  setBrowserNotifier(notifier: BrowserTaskNotifier): void {
    this.browserNotifier = notifier;
    if (this.llm) {
      this.browserAgent = new BrowserAgent(
        {
          headless: this.browserConfig.headless,
          userDataDir:
            this.browserConfig.userDataDir ??
            path.join(app.getPath('userData'), 'browser-data'),
          viewport: { width: 1280, height: 720 },
          maxSteps: 15,
        },
        notifier,
        this.llm
      );
    }
  }

  /**
   * Updates the browser agent configuration (headless mode).
   */
  setBrowserConfig(config: { headless: boolean; userDataDir?: string }): void {
    this.browserConfig = config;
    if (this.browserAgent) {
      this.browserAgent.updateConfig({
        headless: config.headless,
      });
    }
  }

  /**
   * Cancels the currently running browser task by aborting its AbortController.
   */
  cancelBrowserTask(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }

  /**
   * Gracefully shuts down the browser agent and releases resources.
   */
  async shutdownBrowser(): Promise<void> {
    if (this.browserAgent) {
      await this.browserAgent.shutdown();
    }
  }

  async execute(intent: ClassifiedIntent): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      switch (intent.action) {
        case 'open_application':
          await this.openApplication(intent.target);
          break;
        case 'open_url':
          await this.openUrl(intent.target);
          break;
        case 'type_text':
          await this.typeText(intent.target);
          break;
        case 'web_search':
          await this.webSearch(intent.target);
          break;
        case 'open_path':
          await this.openPath(intent.target);
          break;
        case 'system_control':
          await this.systemControl(intent.target);
          break;
        case 'browser_task':
          return await this.executeBrowserTask(intent);
        default:
          throw new Error(`Unknown action type: ${intent.action}`);
      }

      return {
        success: true,
        action: intent.action,
        target: intent.target,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        action: intent.action,
        target: intent.target,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Opens an application using the Windows `start` command.
   * For Chrome/Firefox, launches with the user's default profile.
   * Looks up the app name in APP_NAME_MAP, falls back to using the target directly.
   */
  private async openApplication(target: string): Promise<void> {
    const normalizedTarget = target.toLowerCase().trim();
    const appName = APP_NAME_MAP[normalizedTarget] || normalizedTarget;

    // For Chrome, launch with the user's default profile
    if (appName === 'chrome') {
      const userDataDir = path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
      await execAsync(`start "" "chrome" "--profile-directory=Default" "--user-data-dir=${userDataDir}"`);
      return;
    }

    await execAsync(`start "" "${appName}"`);
  }

  /**
   * Opens a URL in the default browser via Electron's shell.openExternal.
   * Prepends https:// if no protocol is specified.
   */
  private async openUrl(target: string): Promise<void> {
    let url = target.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    await shell.openExternal(url);
  }

  /**
   * Types text using PowerShell clipboard paste approach.
   * Sets clipboard content then simulates Ctrl+V via SendKeys.
   */
  private async typeText(target: string): Promise<void> {
    // Set the clipboard through Electron, not through a shell command. The old
    // approach interpolated the text into a single-quoted PowerShell string,
    // which shattered on newlines (a multi-line letter) and was fragile with
    // quotes. clipboard.writeText handles newlines, quotes, and unicode with no
    // escaping at all.
    clipboard.writeText(target);

    // Give the clipboard a moment to settle before pasting.
    await new Promise((resolve) => setTimeout(resolve, 60));

    // The paste command now contains no user text — only a fixed key combo —
    // so nothing the user dictates can break it.
    const command =
      'powershell -Command "Add-Type -AssemblyName System.Windows.Forms; ' +
      "[System.Windows.Forms.SendKeys]::SendWait('^v')\"";
    await execAsync(command);
  }

  /**
   * Performs a web search by opening Google with the encoded query.
   */
  private async webSearch(target: string): Promise<void> {
    const encodedQuery = encodeURIComponent(target);
    const searchUrl = `https://www.google.com/search?q=${encodedQuery}`;
    await shell.openExternal(searchUrl);
  }

  /**
   * Opens a folder path. Resolves known folder aliases (documents, downloads, etc.)
   * using os.homedir(), then opens via shell.openPath.
   */
  private async openPath(target: string): Promise<void> {
    const folderAliases = getFolderAliases();
    const normalizedTarget = target.toLowerCase().trim();
    const resolvedPath = folderAliases[normalizedTarget] || target;

    const result = await shell.openPath(resolvedPath);
    if (result) {
      // shell.openPath returns an empty string on success, error message on failure
      throw new Error(result);
    }
  }

  /**
   * Executes system control actions: volume, media transport keys, screenshot,
   * screen lock and monitor brightness.
   *
   * Media/volume keys are sent as virtual key char codes via WScript.Shell.
   * Brightness uses WMI (laptop/integrated displays only).
   */
  private async systemControl(target: string): Promise<void> {
    const normalizedTarget = target.toLowerCase().trim().replace(/\s+/g, '_');

    // Volume + media transport keys map to virtual-key char codes.
    const mediaKeyCodes: Record<string, number> = {
      volume_up: 175,
      volume_down: 174,
      mute: 173,
      media_play_pause: 179,
      media_play: 179,
      media_pause: 179,
      media_next: 176,
      media_previous: 177,
      media_prev: 177,
      media_stop: 178,
    };

    const code = mediaKeyCodes[normalizedTarget];
    if (code !== undefined) {
      await execAsync(
        `powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]${code})"`
      );
      return;
    }

    switch (normalizedTarget) {
      case 'screenshot':
        await shell.openExternal('ms-screenclip:');
        break;
      case 'lock_screen':
      case 'lock':
        await execAsync('rundll32.exe user32.dll,LockWorkStation');
        break;
      case 'brightness_up':
        await this.adjustBrightness(10);
        break;
      case 'brightness_down':
        await this.adjustBrightness(-10);
        break;
      default:
        throw new Error(`Unknown system control action: ${target}`);
    }
  }

  /**
   * Adjusts monitor brightness by a relative delta (clamped 0–100) using WMI.
   * Only supported on displays exposing WmiMonitorBrightnessMethods (typically
   * laptop/integrated panels); throws a clear error otherwise.
   */
  private async adjustBrightness(delta: number): Promise<void> {
    const script =
      '$ErrorActionPreference=\'Stop\';' +
      'try {' +
      '$cur=(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness;' +
      `$new=[Math]::Max(0,[Math]::Min(100,$cur+(${delta})));` +
      '(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,$new)' +
      '} catch { Write-Error \'Brightness control is not supported on this display.\'; exit 1 }';
    await execAsync(`powershell -NoProfile -Command "${script}"`);
  }

  /**
   * Executes a browser task by delegating to the BrowserAgent.
   * Creates the agent on-demand if not already initialized.
   */
  private async executeBrowserTask(intent: ClassifiedIntent): Promise<ExecutionResult> {
    const startTime = Date.now();
    try {
      const result = await this.runBrowserTask(intent.target);
      return {
        success: result.status === 'completed',
        action: intent.action,
        target: intent.target,
        error: result.error,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        action: intent.action,
        target: intent.target,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Runs a browser task and returns the full result, including anything the
   * agent read off the page.
   *
   * The tool layer needs `result`/`structuredData` — a bare success flag tells
   * the model nothing about what the browser actually found, which is useless
   * for anything that reads a page rather than just clicking through it.
   */
  async runBrowserTask(command: string): Promise<BrowserTaskResult> {
    {
      // Release the shared browser profile before launching. A connector login
      // window may still hold it, and only one Chromium can own the profile
      // directory at a time — running both leaves them fighting over it.
      if (this.beforeBrowserTask) {
        await this.beforeBrowserTask();
      }

      // Create BrowserAgent on-demand if not already set up
      if (!this.browserAgent) {
        if (!this.browserNotifier) {
          throw new Error('Browser notifier not configured. Cannot execute browser task.');
        }
        if (!this.llm) {
          throw new Error('LLM service not configured. Cannot execute browser task.');
        }
        this.browserAgent = new BrowserAgent(
          {
            headless: this.browserConfig.headless,
            userDataDir:
            this.browserConfig.userDataDir ??
            path.join(app.getPath('userData'), 'browser-data'),
            viewport: { width: 1280, height: 720 },
            maxSteps: 15,
          },
          this.browserNotifier,
          this.llm
        );
      }

      // Generate a unique task ID
      const taskId = Date.now().toString(36);

      // Create AbortController for cancellation support
      this.currentAbortController = new AbortController();
      const signal = this.currentAbortController.signal;

      // Execute the browser task
      try {
        const result: BrowserTaskResult = await this.browserAgent.executeTask(
          { command, taskId },
          signal
        );
        return result;
      } finally {
        this.currentAbortController = null;
      }
    }
  }
}
