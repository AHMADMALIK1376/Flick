import { v4 as uuidv4 } from 'uuid';
import { CommandDetector } from './command-detector';
import { IntentClassifier } from './intent-classifier';
import { ActionExecutor } from './action-executor';
import { AgentStore } from './agent-store';
import { LLMService } from './llm/llm-service';
import { ProviderId } from './llm/providers/llm-provider';
import {
  AgentResult,
  ActionLogEntry,
  BrowserTaskNotifier,
  ChatResponse,
  ChatResponseStatus,
} from '../../shared/types';

export interface AgentNotifier {
  notifySuccess(msg: string): void;
  notifyError(msg: string): void;
  notifyUnrecognized(text: string): void;
}

/** Confidence threshold below which a classified command is treated as unrecognized. */
const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Orchestrates the full agent pipeline:
 * CommandDetector → IntentClassifier → ActionExecutor → AgentStore
 *
 * Owns the shared {@link LLMService} instance and wires it into the
 * IntentClassifier and ActionExecutor so all model access flows through one
 * provider-agnostic layer with instant model/key switching.
 */
export class AgentService {
  private commandDetector: CommandDetector;
  private intentClassifier: IntentClassifier;
  private actionExecutor: ActionExecutor;
  private agentStore: AgentStore;
  private notifier: AgentNotifier;
  private llmService: LLMService;

  private enabled: boolean = false;

  constructor(notifier: AgentNotifier) {
    this.notifier = notifier;
    this.llmService = new LLMService();
    this.commandDetector = new CommandDetector();
    this.intentClassifier = new IntentClassifier(this.llmService);
    this.actionExecutor = new ActionExecutor();
    this.actionExecutor.setLLMService(this.llmService);
    this.agentStore = new AgentStore();
  }

  /**
   * Full pipeline (voice path): detect command → classify intent → execute
   * action → log result.
   *
   * Returns { handled: true } if the text was processed as a command, or
   * { handled: false } if it should flow through normal dictation. Any LLM
   * failure falls back to dictation so speech is never lost.
   */
  async process(text: string): Promise<AgentResult> {
    // If agent mode is disabled, pass through immediately
    if (!this.enabled) {
      return { handled: false };
    }

    // Run command detection (local, no network)
    const detection = this.commandDetector.detect(text);
    if (!detection.isCommand) {
      return { handled: false };
    }

    // Classify intent via the active LLM provider. The LLMService handles
    // missing/invalid keys internally and returns them as errors.
    const classification = await this.intentClassifier.classify(text);

    if (!classification.success) {
      const error = classification.error;

      // Invalid/missing key → disable agent mode and surface the issue
      if (error.type === 'invalid_key') {
        this.enabled = false;
        this.notifier.notifyError('API key issue. Agent mode disabled.');
        return { handled: false };
      }

      // Any other error → notify and fall back to dictation
      this.notifier.notifyError(error.message);
      return { handled: false };
    }

    const intent = classification.intent;

    // Confidence threshold check
    if (intent.confidence < CONFIDENCE_THRESHOLD) {
      this.notifier.notifyUnrecognized(text);
      return { handled: false };
    }

    // Execute the action
    const startTime = Date.now();
    const executionResult = await this.actionExecutor.execute(intent);
    const durationMs = Date.now() - startTime;

    // Create log entry
    const logEntry: ActionLogEntry = {
      id: uuidv4(),
      timestamp: Date.now(),
      commandText: text,
      intentType: intent.action,
      target: intent.target,
      status: executionResult.success ? 'success' : 'error',
      durationMs,
    };

    if (!executionResult.success && executionResult.error) {
      logEntry.errorMessage = executionResult.error;
    }

    // Store in action log
    this.agentStore.addEntry(logEntry);

    // Send notification
    if (executionResult.success) {
      const message = this.buildSuccessMessage(intent.action, intent.target);
      this.notifier.notifySuccess(message);
    } else {
      this.notifier.notifyError(executionResult.error || 'Action failed');
    }

    return { handled: true, action: logEntry };
  }

  /**
   * Chat path: process a typed command and return a structured
   * {@link ChatResponse} for the conversation history. Unlike the voice path,
   * this never falls back to dictation — every outcome maps to a status.
   */
  async processChatCommand(text: string): Promise<ChatResponse> {
    // Agent mode must be enabled to process typed commands
    if (!this.enabled) {
      return {
        status: 'disabled',
        message: 'AI agent mode must be enabled in Settings to process commands.',
      };
    }

    // Local command detection — non-commands are not executed
    const detection = this.commandDetector.detect(text);
    if (!detection.isCommand) {
      return {
        status: 'not_command',
        message: 'That does not look like a command I can execute.',
      };
    }

    // Classify intent via the active LLM provider
    const classification = await this.intentClassifier.classify(text);
    if (!classification.success) {
      return {
        status: 'error',
        message: classification.error.message,
      };
    }

    const intent = classification.intent;

    // Confidence threshold check
    if (intent.confidence < CONFIDENCE_THRESHOLD) {
      return {
        status: 'low_confidence',
        message: 'I am not confident I understood that command.',
      };
    }

    // Execute the action
    const startTime = Date.now();
    const executionResult = await this.actionExecutor.execute(intent);
    const durationMs = Date.now() - startTime;

    // Record an action log entry identical in shape to voice commands
    const logEntry: ActionLogEntry = {
      id: uuidv4(),
      timestamp: Date.now(),
      commandText: text,
      intentType: intent.action,
      target: intent.target,
      status: executionResult.success ? 'success' : 'error',
      durationMs,
    };

    if (!executionResult.success && executionResult.error) {
      logEntry.errorMessage = executionResult.error;
    }

    this.agentStore.addEntry(logEntry);

    const status: ChatResponseStatus = executionResult.success ? 'success' : 'error';
    const message = executionResult.success
      ? this.buildSuccessMessage(intent.action, intent.target)
      : executionResult.error || 'Action failed';

    return {
      status,
      message,
      actionType: intent.action,
    };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Switch the active LLM provider/model. Applies to the next request
   * immediately (instant switching).
   */
  setActiveSelection(provider: ProviderId, model: string): void {
    this.llmService.setActiveSelection(provider, model);
  }

  /**
   * Store the API key for a specific provider. Applies to that provider's next
   * request.
   */
  setProviderApiKey(providerId: ProviderId, key: string): void {
    this.llmService.setApiKey(providerId, key);
  }

  /**
   * Returns the shared LLMService instance. Used by main.ts for wiring
   * settings (selection/keys) into the service.
   */
  getLLMService(): LLMService {
    return this.llmService;
  }

  getLog(): ActionLogEntry[] {
    return this.agentStore.getEntries();
  }

  clearLog(): void {
    this.agentStore.clearLog();
  }

  /**
   * Sets up the browser task notifier that sends progress/result messages to
   * the renderer.
   */
  setupBrowserNotifier(notifier: BrowserTaskNotifier): void {
    this.actionExecutor.setBrowserNotifier(notifier);
  }

  /**
   * Updates the browser agent configuration (headless mode).
   */
  setBrowserConfig(config: { headless: boolean }): void {
    this.actionExecutor.setBrowserConfig({ headless: config.headless });
  }

  /**
   * Cancels the currently running browser task.
   */
  cancelBrowserTask(): void {
    this.actionExecutor.cancelBrowserTask();
  }

  /**
   * Gracefully shuts down the browser agent and releases resources.
   */
  async shutdownBrowser(): Promise<void> {
    await this.actionExecutor.shutdownBrowser();
  }

  /**
   * Builds a human-readable success message based on the action type and target.
   */
  private buildSuccessMessage(action: string, target: string): string {
    switch (action) {
      case 'open_application':
        return `Opened ${target}`;
      case 'open_url':
        return `Opened ${target}`;
      case 'type_text':
        return `Typed text`;
      case 'web_search':
        return `Searching for "${target}"`;
      case 'open_path':
        return `Opened ${target}`;
      case 'system_control':
        return `Executed ${target}`;
      case 'browser_task':
        return `Completed task: ${target}`;
      default:
        return `Action completed: ${target}`;
    }
  }
}
