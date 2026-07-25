import { chromium, BrowserContext, Page } from 'playwright';
import { app } from 'electron';
import path from 'path';
import {
  BrowserTaskRequest,
  BrowserTaskResult,
  BrowserAgentConfig,
  BrowserTaskNotifier,
  BrowserTaskProgressMessage,
  ReactStep,
} from '../../shared/types';
import { ReactLoop } from './react-loop';
import { LLMService } from './llm/llm-service';
import { AcademicAssistant } from './academic-assistant';

/** URL patterns that indicate a login/authentication page */
const LOGIN_URL_PATTERNS = [
  '/login',
  '/signin',
  '/sign-in',
  '/auth',
  '/sso',
  '/oauth',
  '/authenticate',
  '/account/login',
];

/**
 * Manages a persistent Playwright browser and orchestrates browser task execution.
 * The ReactLoop does the heavy lifting — BrowserAgent manages the browser lifecycle
 * and wires things together.
 */
export class BrowserAgent {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: BrowserAgentConfig;
  private notifier: BrowserTaskNotifier;
  private llm: LLMService;
  private isRunning: boolean = false;
  private academicAssistant: AcademicAssistant;

  constructor(config: BrowserAgentConfig, notifier: BrowserTaskNotifier, llm: LLMService) {
    this.config = {
      ...config,
      userDataDir: config.userDataDir || path.join(app.getPath('userData'), 'browser-data'),
    };
    this.notifier = notifier;
    this.llm = llm;
    this.academicAssistant = new AcademicAssistant(llm, notifier);
  }

  /**
   * Execute a browser task. Returns when task completes, fails, or is cancelled.
   * Detects academic/LMS tasks and routes them to the AcademicAssistant.
   */
  async executeTask(request: BrowserTaskRequest, signal: AbortSignal): Promise<BrowserTaskResult> {
    this.isRunning = true;

    try {
      // Ensure browser is ready
      await this.ensureBrowser();

      if (!this.page) {
        return {
          taskId: request.taskId,
          status: 'failed',
          stepsCompleted: 0,
          error: 'Failed to initialize browser page',
        };
      }

      // Detect if this is an academic/LMS task
      if (this.isAcademicTask(request.command)) {
        return await this.executeAcademicTask(request, signal);
      }

      // Create a ReactLoop for this task
      const reactLoop = new ReactLoop({
        maxSteps: this.config.maxSteps,
        llm: this.llm,
      });

      // Run the loop with progress forwarding to notifier
      const result = await reactLoop.run(
        this.page,
        request.command,
        signal,
        (step: ReactStep) => {
          // Forward progress to notifier
          const progress: BrowserTaskProgressMessage = {
            taskId: request.taskId,
            stepNumber: step.stepNumber,
            totalStepsLimit: this.config.maxSteps,
            action: step.action.type,
            description: step.action.description,
            status: 'acting',
            thumbnail: step.screenshot,
          };
          this.notifier.sendProgress(progress);

          // Login detection after each step
          this.detectLogin(request.taskId);
        }
      );

      // Override taskId with the request's taskId for consistency
      const finalResult: BrowserTaskResult = {
        ...result,
        taskId: request.taskId,
      };

      // Send result via notifier
      this.notifier.sendResult(finalResult);

      return finalResult;
    } catch (error) {
      const failedResult: BrowserTaskResult = {
        taskId: request.taskId,
        status: 'failed',
        stepsCompleted: 0,
        error: error instanceof Error ? error.message : String(error),
      };

      this.notifier.sendResult(failedResult);
      return failedResult;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Execute an academic LMS task using the AcademicAssistant.
   * Handles LMS navigation, login waiting, extraction, answer generation, and PDF creation.
   */
  private async executeAcademicTask(request: BrowserTaskRequest, signal: AbortSignal): Promise<BrowserTaskResult> {
    if (!this.page) {
      return {
        taskId: request.taskId,
        status: 'failed',
        stepsCompleted: 0,
        error: 'No browser page available',
      };
    }

    // Extract URL from command if present, otherwise use current page
    const urlMatch = request.command.match(/https?:\/\/[^\s]+/);
    const lmsUrl = urlMatch ? urlMatch[0] : this.page.url();

    const result = await this.academicAssistant.runAcademicWorkflow(this.page, lmsUrl, signal);

    const taskResult: BrowserTaskResult = {
      taskId: request.taskId,
      status: result.success ? 'completed' : 'failed',
      stepsCompleted: result.pdfsCreated.length,
      result: result.success
        ? `Generated ${result.pdfsCreated.length} PDF(s): ${result.pdfsCreated.join(', ')}`
        : undefined,
      error: result.error,
    };

    this.notifier.sendResult(taskResult);
    return taskResult;
  }

  /**
   * Detect if a command is an academic/LMS-related task.
   */
  private isAcademicTask(command: string): boolean {
    const lowerCommand = command.toLowerCase();
    const academicKeywords = [
      'assignment', 'course', 'lms', 'blackboard', 'canvas',
      'moodle', 'homework', 'academic', 'university', 'submit',
      'grades', 'syllabus', 'lecture', 'iqra', 'portal',
      'extract assignment', 'generate answer', 'pdf',
    ];
    return academicKeywords.some((keyword) => lowerCommand.includes(keyword));
  }

  /**
   * Launch or reuse the persistent browser context.
   * If context already exists and is usable, reuse it.
   * Otherwise, launch Chromium with persistent context.
   */
  private async ensureBrowser(): Promise<void> {
    // If context exists and page is usable, reuse
    if (this.context && this.page) {
      try {
        // Quick check that the page is still alive
        await this.page.evaluate(() => true);
        return;
      } catch {
        // Page is dead, need to recreate
        this.context = null;
        this.page = null;
      }
    }

    // Launch with persistent context. Uses the real installed Chrome with the
    // automation flag stripped, so sites that block automated browsers (Google
    // most strictly) treat it as a normal browser — and so it shares the same
    // browser binary as the connector login window that saved the session.
    // Falls back to bundled Chromium when Chrome is not installed.
    const launchOptions = {
      headless: this.config.headless,
      viewport: this.config.viewport,
      ignoreDefaultArgs: ['--enable-automation'],
      // --start-maximized + window position keep the automated window visible
      // and in front, so the user can watch the task instead of it running
      // hidden behind the app.
      args: [
        '--disable-blink-features=AutomationControlled',
        '--start-maximized',
        '--window-position=0,0',
      ],
    };
    console.log(
      `[Browser] launching (headless=${this.config.headless}) at ${this.config.userDataDir}`,
    );
    try {
      this.context = await chromium.launchPersistentContext(this.config.userDataDir, {
        ...launchOptions,
        channel: 'chrome',
      });
      console.log('[Browser] using real Chrome');
    } catch (err) {
      console.warn('[Browser] real Chrome unavailable, using bundled Chromium:', err instanceof Error ? err.message : err);
      this.context = await chromium.launchPersistentContext(
        this.config.userDataDir,
        launchOptions,
      );
    }

    // Get or create a page from the context
    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context.newPage();

    // Raise the window so the user can see the task run.
    if (!this.config.headless) {
      await this.page.bringToFront().catch(() => {});
    }

    // Set up crash detection
    this.context.on('close', () => {
      this.context = null;
      this.page = null;
    });
  }

  /**
   * Gracefully close browser and release resources.
   */
  async shutdown(): Promise<void> {
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // Ignore errors during shutdown
      }
      this.context = null;
      this.page = null;
    }
  }

  /**
   * Check if a task is currently running.
   */
  isTaskRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Update config fields (e.g., when settings change).
   */
  updateConfig(config: Partial<BrowserAgentConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Login detection heuristic.
   * Checks if the current URL contains common login patterns.
   * For MVP, just detect and notify — don't actually pause.
   */
  private detectLogin(taskId: string): void {
    if (!this.page) return;

    try {
      const currentUrl = this.page.url().toLowerCase();
      const isLoginPage = LOGIN_URL_PATTERNS.some((pattern) => currentUrl.includes(pattern));

      if (isLoginPage) {
        this.notifier.sendLoginRequired(taskId, this.page.url());
      }
    } catch {
      // Ignore errors in login detection — it's a best-effort heuristic
    }
  }
}
