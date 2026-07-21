import { Page } from 'playwright';
import {
  BrowserAction,
  BrowserActionType,
  BrowserTaskResult,
  ReactStep,
  ReactLoopStatus,
  AnalysisResult,
} from '../../shared/types';
import { PageAnalyzer } from './page-analyzer';
import { LLMService } from './llm/llm-service';

export interface ReactLoopConfig {
  maxSteps: number;
  llm: LLMService;
}

/** Standard resolution for screenshots (reduced for token savings). */
const STANDARD_RESOLUTION = { width: 640, height: 480 };

/** High resolution used only on retry when confidence is low. */
const RETRY_RESOLUTION = { width: 1280, height: 720 };

/** Confidence threshold below which a retry with higher resolution is attempted. */
const LOW_CONFIDENCE_THRESHOLD = 0.4;

/**
 * Executes the ReAct (Reason + Act) cycle for browser automation tasks.
 * Each iteration: Observe → Decide → Act
 *
 * Optimized for minimal token usage:
 * - Screenshots at 640x480 (upgraded to 1280x720 only on retry)
 * - Only last 3 steps sent as history context
 * - Plan generation merged into first analysis call
 * - Token budget enforcement via LLMService
 */
export class ReactLoop {
  private steps: ReactStep[] = [];
  private status: ReactLoopStatus = 'planning';
  private pageAnalyzer: PageAnalyzer;
  private config: ReactLoopConfig;

  constructor(config: ReactLoopConfig) {
    this.config = config;
    this.pageAnalyzer = new PageAnalyzer(config.llm);
  }

  /**
   * Run the ReAct loop for a given task.
   * Emits progress via the onProgress callback.
   * Respects the AbortSignal for cancellation.
   */
  async run(
    page: Page,
    taskCommand: string,
    signal: AbortSignal,
    onProgress: (step: ReactStep) => void
  ): Promise<BrowserTaskResult> {
    const taskId = Date.now().toString(36);

    // Reset budget tracker for this task
    this.config.llm.budgetTracker.reset();

    // Plan generation is now merged into the first analyzeScreenshot call.
    // We pass the raw command as taskContext.
    const taskContext = taskCommand;

    // Main ReAct loop
    for (let i = 0; i < this.config.maxSteps; i++) {
      // Check abort signal before each step
      if (signal.aborted) {
        return {
          taskId,
          status: 'cancelled',
          stepsCompleted: this.steps.length,
          result: this.getLatestExtractedData(),
        };
      }

      // Check token budget
      if (this.config.llm.budgetTracker.isOverBudget()) {
        return {
          taskId,
          status: 'failed',
          stepsCompleted: this.steps.length,
          error: `Token budget exceeded ($${this.config.llm.budgetTracker.getEstimatedCost().toFixed(4)} >= $${this.config.llm.budgetTracker.getBudgetLimit().toFixed(2)} limit). Task stopped to prevent excessive API costs.`,
        };
      }

      // Observe: Take screenshot at reduced resolution (640x480)
      this.status = 'observing';
      let screenshot: Buffer;
      try {
        screenshot = await page.screenshot({
          type: 'png',
          clip: { x: 0, y: 0, ...STANDARD_RESOLUTION },
        });
      } catch (error) {
        return {
          taskId,
          status: 'failed',
          stepsCompleted: this.steps.length,
          error: `Failed to capture screenshot: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      // Decide: Send screenshot to GPT-4o vision (only last 3 steps as context)
      this.status = 'deciding';
      let analysis: AnalysisResult;
      try {
        analysis = await this.pageAnalyzer.analyzeScreenshot(
          screenshot,
          taskContext,
          this.steps.slice(-3) // Only send last 3 steps
        );

        // If confidence is low, retry with higher resolution
        if (analysis.confidence < LOW_CONFIDENCE_THRESHOLD && !analysis.isTaskComplete) {
          const retryScreenshot = await page.screenshot({
            type: 'png',
            clip: { x: 0, y: 0, ...RETRY_RESOLUTION },
          });
          analysis = await this.pageAnalyzer.analyzeScreenshot(
            retryScreenshot,
            taskContext,
            this.steps.slice(-3)
          );
        }
      } catch (error) {
        return {
          taskId,
          status: 'failed',
          stepsCompleted: this.steps.length,
          error: `Analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      // If task is complete, return success
      if (analysis.isTaskComplete) {
        this.status = 'complete';
        return {
          taskId,
          status: 'completed',
          result: analysis.extractedData || analysis.reasoning,
          stepsCompleted: this.steps.length,
          confidence: analysis.confidence,
        };
      }

      // If task failed according to GPT-4o
      if (analysis.action.type === 'task_failed') {
        this.status = 'failed';
        return {
          taskId,
          status: 'failed',
          stepsCompleted: this.steps.length,
          error: analysis.reasoning,
        };
      }

      // Act: Execute the browser action
      this.status = 'acting';
      const observation = await this.executeAction(page, analysis.action);

      // Create ReactStep and emit progress
      const step: ReactStep = {
        stepNumber: i + 1,
        action: analysis.action,
        observation,
        screenshot: screenshot.toString('base64'),
        timestamp: Date.now(),
      };

      this.steps.push(step);
      onProgress(step);

      // Wait briefly for page to settle
      await this.delay(500);
    }

    // Loop exhausted maxSteps — return partial result
    this.status = 'complete';
    return {
      taskId,
      status: 'partial',
      stepsCompleted: this.steps.length,
      result: this.getLatestExtractedData(),
      error: `Task did not complete within ${this.config.maxSteps} steps`,
    };
  }

  /**
   * Execute a browser action on the page.
   * Returns an observation string describing what happened.
   * Never throws — errors are returned as observation strings.
   */
  private async executeAction(page: Page, action: BrowserAction): Promise<string> {
    try {
      switch (action.type) {
        case 'navigate_to_url':
          return await this.executeNavigate(page, action.target || '');

        case 'click_element':
          return await this.executeClick(page, action.target || '');

        case 'type_into_element':
          return await this.executeType(page, action.target || '', action.value || '');

        case 'scroll_page':
          return await this.executeScroll(page, action.value || action.target || 'down');

        case 'read_page_content':
          return await this.executeReadContent(page);

        case 'wait_for_load':
          return await this.executeWaitForLoad(page);

        case 'take_screenshot':
          return 'Screenshot captured (already taken in observe step)';

        default:
          return `Unknown action type: ${action.type}`;
      }
    } catch (error) {
      return `Action failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Navigate to a URL and wait for network idle.
   */
  private async executeNavigate(page: Page, url: string): Promise<string> {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 });
      return `Navigated to ${url}`;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Timeout')) {
        return `Navigation timed out for ${url}, page may have partially loaded`;
      }
      return `Navigation failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Click an element on the page.
   * Uses smart element finding to locate the target.
   */
  private async executeClick(page: Page, target: string): Promise<string> {
    try {
      const locator = await this.findElement(page, target);
      if (locator) {
        await locator.click({ timeout: 5000 });
        return `Clicked element: ${target}`;
      }

      // Fallback: try direct click with target as selector
      await page.click(target, { timeout: 5000 });
      return `Clicked element: ${target}`;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Timeout') || error.message.includes('waiting for')) {
          return `Element not found: ${target}`;
        }
        return `Click failed: ${error.message}`;
      }
      return `Click failed: ${String(error)}`;
    }
  }

  /**
   * Type text into an element.
   * Tries page.fill first, then falls back to locator.fill.
   */
  private async executeType(page: Page, target: string, value: string): Promise<string> {
    try {
      const locator = await this.findElement(page, target);
      if (locator) {
        await locator.fill(value, { timeout: 5000 });
        return `Typed "${value}" into ${target}`;
      }

      // Fallback: try page.fill with target as selector
      await page.fill(target, value, { timeout: 5000 });
      return `Typed "${value}" into ${target}`;
    } catch (error) {
      // Second fallback: try locator approach
      try {
        await page.locator(target).fill(value, { timeout: 5000 });
        return `Typed "${value}" into ${target}`;
      } catch {
        if (error instanceof Error) {
          if (error.message.includes('Timeout') || error.message.includes('waiting for')) {
            return `Element not found: ${target}`;
          }
          return `Type failed: ${error.message}`;
        }
        return `Type failed: ${String(error)}`;
      }
    }
  }

  /**
   * Scroll the page in the specified direction.
   */
  private async executeScroll(page: Page, direction: string): Promise<string> {
    try {
      const scrollAmount = direction.toLowerCase() === 'up' ? -500 : 500;
      await page.evaluate((amount) => window.scrollBy(0, amount), scrollAmount);
      return `Scrolled page ${direction.toLowerCase() === 'up' ? 'up' : 'down'}`;
    } catch (error) {
      return `Scroll failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Read visible text content from the page.
   * Returns first 2000 characters.
   */
  private async executeReadContent(page: Page): Promise<string> {
    try {
      const content = await page.evaluate(() => document.body.innerText);
      const truncated = content.slice(0, 2000);
      return `Page content (${truncated.length} chars): ${truncated}`;
    } catch (error) {
      return `Read content failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Wait for the page to reach network idle state.
   */
  private async executeWaitForLoad(page: Page): Promise<string> {
    try {
      await page.waitForLoadState('networkidle', { timeout: 10000 });
      return 'Page loaded (network idle)';
    } catch (error) {
      if (error instanceof Error && error.message.includes('Timeout')) {
        return 'Wait for load timed out after 10 seconds';
      }
      return `Wait for load failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Smart element finding.
   * If target looks like a CSS selector, use it directly.
   * Otherwise, try text, button role, link role, and aria-label in order.
   */
  private async findElement(page: Page, target: string) {
    // Check if target looks like a CSS selector
    if (this.looksLikeCssSelector(target)) {
      const locator = page.locator(target);
      try {
        await locator.waitFor({ state: 'visible', timeout: 3000 });
        return locator;
      } catch {
        return null;
      }
    }

    // Try text-based finding strategies in order
    const strategies = [
      () => page.getByText(target, { exact: false }),
      () => page.getByRole('button', { name: target }),
      () => page.getByRole('link', { name: target }),
      () => page.locator(`[aria-label="${target}"]`),
    ];

    for (const strategy of strategies) {
      try {
        const locator = strategy();
        await locator.first().waitFor({ state: 'visible', timeout: 2000 });
        return locator.first();
      } catch {
        // Try next strategy
        continue;
      }
    }

    return null;
  }

  /**
   * Check if a target string looks like a CSS selector.
   * CSS selectors typically contain . # [ ] > characters.
   */
  private looksLikeCssSelector(target: string): boolean {
    return /[.#\[\]>]/.test(target);
  }

  /**
   * Get the latest extracted data from steps, if any.
   */
  private getLatestExtractedData(): string | undefined {
    // Return undefined if no steps have meaningful data
    return undefined;
  }

  /**
   * Delay execution for a specified number of milliseconds.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
