import {
  ClassifiedIntent,
  ClassificationResult,
  ClassificationError,
  ActionType,
} from '../../shared/types';
import { LLMService } from './llm/llm-service';
import { LLMErrorKind } from './llm/providers/llm-provider';

const VALID_ACTIONS: ActionType[] = [
  'open_application',
  'open_url',
  'type_text',
  'web_search',
  'open_path',
  'system_control',
  'browser_task',
];

const SYSTEM_PROMPT = `You are a voice command classifier. Given a user's spoken command, classify it into a structured action.

Return a JSON object with exactly these fields:
- "action": one of "open_application", "open_url", "type_text", "web_search", "open_path", "system_control", "browser_task"
- "target": the target of the action (app name, URL, text to type, search query, file path, control action, or task description)
- "confidence": a number between 0.0 and 1.0 indicating how confident you are in the classification
- "parameters": an optional object with additional context (e.g., volume level, delay)

Action type guidance:
- "open_application": ONLY for launching a desktop application with NO further web interaction. Example: "open Notepad", "open Calculator", "launch Spotify". Do NOT use this when the command mentions a website, URL, login, or any web-based action.
- "open_url": Simple URL navigation — just opening a page with no further interaction. Example: "open google.com", "go to youtube.com"
- "browser_task": Complex web interactions requiring multiple steps beyond just opening a page. Use this when the command requires ANY of: logging in, navigating within a site, clicking buttons, reading specific content, filling forms, checking status, or performing actions on a website. Interaction verbs include: check, find, look up, submit, fill, click, summarize, review, read, login, sign in, sign up, register, download, upload, send, reply, create, delete, update, edit.
- IMPORTANT: If a command mentions BOTH opening something AND doing an action (e.g., "open Chrome and login to Teams", "open Gmail and check my inbox"), classify it as "browser_task" — the compound action requires browser automation.
- IMPORTANT: If the command mentions a web service by name (Teams, Gmail, Azure, GitHub, Jira, Slack, etc.) with any action verb, classify as "browser_task".

Examples:
- "open Chrome" → { "action": "open_application", "target": "chrome", "confidence": 0.95, "parameters": {} }
- "go to github.com" → { "action": "open_url", "target": "github.com", "confidence": 0.9, "parameters": {} }
- "open google.com" → { "action": "open_url", "target": "google.com", "confidence": 0.9, "parameters": {} }
- "type hello world" → { "action": "type_text", "target": "hello world", "confidence": 0.9, "parameters": {} }
- "search for TypeScript tutorials" → { "action": "web_search", "target": "TypeScript tutorials", "confidence": 0.9, "parameters": {} }
- "open documents" → { "action": "open_path", "target": "documents", "confidence": 0.85, "parameters": {} }
- "mute" → { "action": "system_control", "target": "mute", "confidence": 0.95, "parameters": {} }

System control targets (use action "system_control"): "volume_up", "volume_down", "mute", "media_play_pause", "media_next", "media_previous", "media_stop", "screenshot", "lock_screen", "brightness_up", "brightness_down".
- "volume up" / "louder" → target "volume_up"; "volume down" / "quieter" → "volume_down"
- "pause"/"play"/"resume the music" → "media_play_pause"; "next track"/"skip song" → "media_next"; "previous track"/"go back a song" → "media_previous"
- "lock my screen"/"lock the computer" → "lock_screen"
- "brightness up"/"brighter" → "brightness_up"; "brightness down"/"dimmer" → "brightness_down"
- "take a screenshot" → "screenshot"

More examples:
- "lock my screen" → { "action": "system_control", "target": "lock_screen", "confidence": 0.95, "parameters": {} }
- "pause the music" → { "action": "system_control", "target": "media_play_pause", "confidence": 0.9, "parameters": {} }
- "next track" → { "action": "system_control", "target": "media_next", "confidence": 0.9, "parameters": {} }
- "turn the brightness down" → { "action": "system_control", "target": "brightness_down", "confidence": 0.9, "parameters": {} }
- "go to Azure DevOps and check my active stories" → { "action": "browser_task", "target": "Azure DevOps - check active stories", "confidence": 0.9, "parameters": {} }
- "find the latest PR on GitHub and summarize it" → { "action": "browser_task", "target": "GitHub - find latest PR", "confidence": 0.9, "parameters": {} }
- "check my email on Gmail" → { "action": "browser_task", "target": "Gmail - check email", "confidence": 0.9, "parameters": {} }
- "open Chrome and login to Teams" → { "action": "browser_task", "target": "Microsoft Teams - login", "confidence": 0.9, "parameters": {} }
- "login to my Azure account" → { "action": "browser_task", "target": "Azure - login", "confidence": 0.9, "parameters": {} }
- "open Teams and check my messages" → { "action": "browser_task", "target": "Microsoft Teams - check messages", "confidence": 0.9, "parameters": {} }`;

/**
 * Sends command text to the active LLM provider for structured intent
 * classification via the shared {@link LLMService}.
 */
export class IntentClassifier {
  constructor(private llm: LLMService) {}

  async classify(commandText: string): Promise<ClassificationResult> {
    const result = await this.llm.textComplete(SYSTEM_PROMPT, commandText, true);

    if (!result.ok) {
      return this.failure(
        this.mapErrorKind(result.error.kind),
        result.error.message,
        result.error.httpStatus
      );
    }

    return this.parseResponse(result.text);
  }

  /**
   * Map an LLMService error kind to the ClassificationError.type used by the
   * rest of the agent pipeline.
   */
  private mapErrorKind(kind: LLMErrorKind): ClassificationError['type'] {
    switch (kind) {
      case 'missing_key':
      case 'invalid_key':
        return 'invalid_key';
      case 'timeout':
        return 'timeout';
      case 'network':
        return 'network';
      default:
        return 'api_error';
    }
  }

  private parseResponse(content: string): ClassificationResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return this.failure('parse_error', 'Invalid JSON in response');
    }

    if (!parsed || typeof parsed !== 'object') {
      return this.failure('parse_error', 'Response is not a JSON object');
    }

    const obj = parsed as Record<string, unknown>;

    // Validate required fields
    if (!('action' in obj) || !('target' in obj) || !('confidence' in obj)) {
      return this.failure(
        'parse_error',
        'Missing required fields: action, target, confidence'
      );
    }

    const { action, target, confidence, parameters } = obj;

    if (typeof action !== 'string' || !VALID_ACTIONS.includes(action as ActionType)) {
      return this.failure('parse_error', `Invalid action type: ${action}`);
    }

    if (typeof target !== 'string') {
      return this.failure('parse_error', 'Target must be a string');
    }

    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
      return this.failure('parse_error', 'Confidence must be a number between 0 and 1');
    }

    const intent: ClassifiedIntent = {
      action: action as ActionType,
      target,
      confidence,
    };

    if (parameters !== undefined && parameters !== null && typeof parameters === 'object') {
      intent.parameters = parameters as Record<string, unknown>;
    }

    return { success: true, intent };
  }

  private failure(
    type: ClassificationError['type'],
    message: string,
    httpStatus?: number
  ): ClassificationResult {
    const error: ClassificationError = { type, message };
    if (httpStatus !== undefined) {
      error.httpStatus = httpStatus;
    }
    return { success: false, error };
  }
}
