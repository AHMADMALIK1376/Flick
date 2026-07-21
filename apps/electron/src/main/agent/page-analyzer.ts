import { Page } from 'playwright';
import {
  BrowserAction,
  BrowserActionType,
  ReactStep,
  AnalysisResult,
} from '../../shared/types';
import { LLMService } from './llm/llm-service';

const VALID_ACTION_TYPES: BrowserActionType[] = [
  'navigate_to_url',
  'click_element',
  'type_into_element',
  'scroll_page',
  'read_page_content',
  'take_screenshot',
  'wait_for_load',
  'task_complete',
  'task_failed',
];

/**
 * Condensed system prompt sent only on step 1 (with plan generation merged in).
 * Keeps token usage minimal while providing full context on first call.
 */
const INITIAL_SYSTEM_PROMPT = `You are a browser automation agent. Analyze screenshots and decide the next action.

Respond with JSON:
{"action":"<type>","target":"<selector_or_url>","value":"<text>","reasoning":"<brief>","is_task_complete":false,"extracted_data":"","confidence":0.8,"plan":"<2-3 step plan>"}

Actions: navigate_to_url, click_element, type_into_element, scroll_page, read_page_content, wait_for_load, task_complete, task_failed
Rules: Use descriptive selectors. Set is_task_complete=true only when done. Include a brief plan on first response.`;

/**
 * Shorter follow-up prompt for steps 2+. Omits plan instruction and guidelines
 * since the model already has context from step 1.
 */
const FOLLOWUP_SYSTEM_PROMPT = `Browser automation agent. Analyze screenshot, pick next action.
JSON: {"action":"<type>","target":"<sel>","value":"<txt>","reasoning":"<why>","is_task_complete":false,"extracted_data":"","confidence":0.8}
Actions: navigate_to_url, click_element, type_into_element, scroll_page, read_page_content, wait_for_load, task_complete, task_failed`;

/** Maximum number of previous steps to include in context. */
const MAX_HISTORY_STEPS = 3;

/**
 * Uses the shared {@link LLMService} (vision-capable model) to analyze web page
 * screenshots and determine the next browser action to take.
 *
 * Optimized for minimal token usage:
 * - Plan generation merged into first screenshot analysis (no separate API call)
 * - Condensed system prompt on step 1, shorter follow-up prompt on subsequent steps
 * - Only last 3 steps sent as context
 */
export class PageAnalyzer {
  /**
   * Set to the fallback provider id when the most recent vision request was
   * served by a fallback provider (because the active model lacks vision).
   * BrowserAgent reads this to surface a notification to the user.
   */
  lastFallbackProviderId?: string;

  /** Stored plan from the first analysis response. */
  private currentPlan?: string;

  constructor(private llm: LLMService) {}

  /**
   * Generate a high-level plan for executing the user's command.
   * Now a no-op that returns a placeholder — plan is generated inline
   * during the first analyzeScreenshot call to save an API round-trip.
   */
  async generatePlan(command: string): Promise<string> {
    // Plan is now generated as part of the first vision call.
    // Return the command itself as the "plan" for backward compatibility.
    return command;
  }

  /**
   * Analyze a screenshot and determine the next action to take.
   * On step 1, uses the full initial prompt (which also generates a plan).
   * On subsequent steps, uses a shorter follow-up prompt with only the last 3 steps.
   */
  async analyzeScreenshot(
    screenshot: Buffer,
    taskContext: string,
    previousSteps: ReactStep[]
  ): Promise<AnalysisResult> {
    const isFirstStep = previousSteps.length === 0;
    const systemPrompt = isFirstStep ? INITIAL_SYSTEM_PROMPT : FOLLOWUP_SYSTEM_PROMPT;

    // Only send last 3 steps to minimize token usage
    const recentSteps = previousSteps.slice(-MAX_HISTORY_STEPS);
    const stepsDescription = this.formatPreviousSteps(recentSteps);

    let userMessage: string;
    if (isFirstStep) {
      userMessage = `Task: ${taskContext}\nAnalyze screenshot and provide your plan + first action.`;
    } else {
      userMessage = `Task: ${taskContext}${stepsDescription ? `\nRecent steps:\n${stepsDescription}` : ''}\nNext action?`;
    }

    const { result, fallbackProviderId } = await this.llm.visionComplete(
      systemPrompt,
      userMessage,
      screenshot.toString('base64'),
      true
    );

    // Record fallback usage so BrowserAgent can notify the user.
    this.lastFallbackProviderId = fallbackProviderId;

    if (!result.ok) {
      if (result.error.kind === 'no_vision_provider') {
        throw new Error(
          'No vision-capable provider is configured. Add an API key for a vision-capable provider (OpenAI or Gemini) to run browser tasks.'
        );
      }
      throw new Error(result.error.message);
    }

    const analysis = this.parseVisionResponse(result.text);

    // Store plan from first response if present
    if (isFirstStep && analysis.plan) {
      this.currentPlan = analysis.plan;
    }

    return analysis;
  }

  /**
   * Retry analysis with a higher resolution screenshot (1280x720).
   * Used when the standard resolution analysis fails or is uncertain.
   */
  async retryWithHighRes(
    page: Page,
    taskContext: string,
    previousSteps: ReactStep[]
  ): Promise<AnalysisResult> {
    const highResScreenshot = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: 1280, height: 720 },
    });

    const result = await this.analyzeScreenshot(
      highResScreenshot,
      taskContext,
      previousSteps
    );

    return result;
  }

  /** Get the plan generated during the first analysis. */
  getPlan(): string | undefined {
    return this.currentPlan;
  }

  /**
   * Parse the vision JSON response into an AnalysisResult.
   */
  private parseVisionResponse(content: string): AnalysisResult & { plan?: string } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`Failed to parse vision response as JSON: ${content.slice(0, 200)}`);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Vision response is not a JSON object');
    }

    const obj = parsed as Record<string, unknown>;

    // Validate action type
    const actionType = obj.action as string;
    if (!actionType || !VALID_ACTION_TYPES.includes(actionType as BrowserActionType)) {
      throw new Error(`Invalid action type in vision response: ${actionType}`);
    }

    // Validate confidence
    const confidence =
      typeof obj.confidence === 'number' ? obj.confidence : 0.5;

    // Validate reasoning
    const reasoning =
      typeof obj.reasoning === 'string' ? obj.reasoning : 'No reasoning provided';

    // Build the BrowserAction
    const action: BrowserAction = {
      type: actionType as BrowserActionType,
      description: reasoning,
    };

    if (typeof obj.target === 'string' && obj.target.length > 0) {
      action.target = obj.target;
    }

    if (typeof obj.value === 'string' && obj.value.length > 0) {
      action.value = obj.value;
    }

    // Build the AnalysisResult
    const result: AnalysisResult & { plan?: string } = {
      action,
      reasoning,
      isTaskComplete: obj.is_task_complete === true,
      confidence: Math.max(0, Math.min(1, confidence)),
    };

    if (typeof obj.extracted_data === 'string' && obj.extracted_data.length > 0) {
      result.extractedData = obj.extracted_data;
    }

    // Extract plan if present (first step response)
    if (typeof obj.plan === 'string' && obj.plan.length > 0) {
      result.plan = obj.plan;
    }

    return result;
  }

  /**
   * Format previous steps into a compact summary for the prompt.
   */
  private formatPreviousSteps(steps: ReactStep[]): string {
    if (steps.length === 0) return '';

    return steps
      .map(
        (step) =>
          `${step.stepNumber}: ${step.action.type}${step.action.target ? ` → "${step.action.target}"` : ''} — ${step.observation.slice(0, 80)}`
      )
      .join('\n');
  }
}
