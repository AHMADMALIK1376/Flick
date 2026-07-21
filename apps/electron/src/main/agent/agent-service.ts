import { v4 as uuidv4 } from 'uuid';
import { CommandDetector } from './command-detector';
import { ActionExecutor } from './action-executor';
import { AgentStore } from './agent-store';
import { LLMService } from './llm/llm-service';
import { ToolRegistry } from './tools/tool-registry';
import { PermissionGate } from './tools/permission-gate';
import { registerDesktopTools } from './tools/desktop-tools';
import { ToolLoop } from './tool-loop';
import { createLlmTurnFn } from './llm-turn-adapter';
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

/**
 * Orchestrates the full agent pipeline:
 * CommandDetector → ToolLoop → ToolRegistry → ActionExecutor → AgentStore
 *
 * CommandDetector is a gate, not a classifier: it decides only whether a
 * transcript is worth an LLM call at all, so plain dictation still reaches the
 * clipboard for free. Everything past that gate runs through the tool loop, so
 * one utterance can drive several actions.
 *
 * Owns the shared {@link LLMService} instance so all model access flows through
 * one provider-agnostic layer with instant model/key switching.
 */
export class AgentService {
  private commandDetector: CommandDetector;
  private actionExecutor: ActionExecutor;
  private agentStore: AgentStore;
  private notifier: AgentNotifier;
  private llmService: LLMService;
  private toolRegistry: ToolRegistry;
  private toolLoop: ToolLoop;

  private enabled: boolean = false;

  constructor(notifier: AgentNotifier) {
    this.notifier = notifier;
    this.llmService = new LLMService();
    this.commandDetector = new CommandDetector();
    this.actionExecutor = new ActionExecutor();
    this.actionExecutor.setLLMService(this.llmService);
    this.agentStore = new AgentStore();

    this.toolRegistry = new ToolRegistry();
    registerDesktopTools(this.toolRegistry, this.actionExecutor);

    // TEMPORARY: auto-approve until the confirm dialog lands. Every desktop
    // tool is side-effecting, so a gate that cannot prompt would block
    // every action.
    const gate = new PermissionGate(async () => true);

    this.toolLoop = new ToolLoop(
      this.toolRegistry,
      gate,
      createLlmTurnFn(this.llmService, this.toolRegistry)
    );
  }

  /** Names of every registered tool. Used by tests and the dashboard. */
  getToolNames(): string[] {
    return this.toolRegistry.list().map((t) => t.name);
  }

  /**
   * Full pipeline (voice path): detect command → run tool loop → log result.
   *
   * Returns { handled: true } if the text was processed as a command, or
   * { handled: false } if it should flow through normal dictation. Any LLM
   * failure falls back to dictation so speech is never lost.
   */
  async process(text: string): Promise<AgentResult> {
    // If agent mode is disabled, pass through immediately
    if (!this.enabled) {
      console.log('[Agent] mode is OFF — passing through as dictation.');
      return { handled: false };
    }

    // Run command detection (local, no network)
    const detection = this.commandDetector.detect(text);
    console.log(
      `[Agent] detect "${text}" -> isCommand=${detection.isCommand} ` +
        `language=${detection.language} matched=${detection.matchedPattern ?? '-'}`
    );
    if (!detection.isCommand) {
      return { handled: false };
    }

    // Run the multi-step tool loop. The model may call several tools in
    // sequence, so one utterance can drive several actions.
    const startTime = Date.now();
    const outcome = await this.toolLoop.run(text, detection.language);
    const durationMs = Date.now() - startTime;

    console.log(
      `[Agent] loop finished in ${durationMs}ms: ${outcome.steps.length} step(s)` +
        `${outcome.stoppedReason ? ` stopped=${outcome.stoppedReason}` : ''}` +
        ` final="${outcome.finalMessage ?? ''}"`
    );
    for (const step of outcome.steps) {
      console.log(
        `[Agent]   ${step.call.name}(${JSON.stringify(step.call.args)}) -> ` +
          (step.result.ok ? 'ok' : `ERROR: ${step.result.error}`)
      );
    }

    // One log entry per tool call, so the Agent panel shows each step.
    let lastEntry: ActionLogEntry | undefined;
    for (const step of outcome.steps) {
      const entry: ActionLogEntry = {
        id: uuidv4(),
        timestamp: Date.now(),
        commandText: text,
        // Desktop tool names currently coincide with ActionType. This cast
        // must be revisited when tools outside that union are registered.
        intentType: step.call.name as ActionLogEntry['intentType'],
        target: JSON.stringify(step.call.args),
        status: step.result.ok ? 'success' : 'error',
        durationMs,
      };
      if (!step.result.ok) {
        entry.errorMessage = step.result.error;
      }
      this.agentStore.addEntry(entry);
      lastEntry = entry;
    }

    // Model neither acted nor spoke — treat as unrecognized and let the text
    // fall through to dictation so speech is never lost.
    if (outcome.steps.length === 0 && !outcome.finalMessage) {
      this.notifier.notifyUnrecognized(text);
      return { handled: false };
    }

    const firstFailure = outcome.steps.find((s) => !s.result.ok);
    if (firstFailure && !firstFailure.result.ok) {
      this.notifier.notifyError(firstFailure.result.error);
    } else if (outcome.finalMessage) {
      this.notifier.notifySuccess(outcome.finalMessage);
    }

    return { handled: true, action: lastEntry };
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

    // Same multi-step tool loop as the voice path, so typed and spoken
    // commands behave identically.
    const startTime = Date.now();
    const outcome = await this.toolLoop.run(text, detection.language);
    const durationMs = Date.now() - startTime;

    let lastCall: string | undefined;
    for (const step of outcome.steps) {
      const entry: ActionLogEntry = {
        id: uuidv4(),
        timestamp: Date.now(),
        commandText: text,
        // Desktop tool names currently coincide with ActionType. This cast
        // must be revisited when tools outside that union are registered.
        intentType: step.call.name as ActionLogEntry['intentType'],
        target: JSON.stringify(step.call.args),
        status: step.result.ok ? 'success' : 'error',
        durationMs,
      };
      if (!step.result.ok) {
        entry.errorMessage = step.result.error;
      }
      this.agentStore.addEntry(entry);
      lastCall = step.call.name;
    }

    if (outcome.steps.length === 0 && !outcome.finalMessage) {
      return {
        status: 'low_confidence',
        message: 'I am not confident I understood that command.',
      };
    }

    const firstFailure = outcome.steps.find((s) => !s.result.ok);
    if (firstFailure && !firstFailure.result.ok) {
      return {
        status: 'error' as ChatResponseStatus,
        message: firstFailure.result.error,
        ...(lastCall ? { actionType: lastCall as ActionLogEntry['intentType'] } : {}),
      };
    }

    return {
      status: 'success' as ChatResponseStatus,
      message: outcome.finalMessage ?? 'Done.',
      ...(lastCall ? { actionType: lastCall as ActionLogEntry['intentType'] } : {}),
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
