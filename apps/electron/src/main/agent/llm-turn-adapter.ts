import type { LLMService } from './llm/llm-service';
import type { LoopMessage, LoopTurn, ToolCall, TurnFn } from './tool-loop';
import type { ToolRegistry } from './tools/tool-registry';

/** Generous ceiling — tool-call JSON is small, but plans can be wordy. */
const MAX_TOKENS = 800;

/**
 * Builds the system prompt for one turn of the tool loop.
 *
 * Encodes the language boundary from spec §6.3: understand any language, emit
 * English tool names and arguments, reply in the user's language. That keeps
 * the entire execution layer language-agnostic.
 */
export function buildToolSystemPrompt(registry: ToolRegistry): string {
  const tools = registry
    .describeForModel()
    .map(
      (t) =>
        `- ${t.name}: ${t.description}\n  arguments: ${JSON.stringify(
          t.input_schema.properties
        )}`
    )
    .join('\n');

  return `You are Flick, a voice assistant that controls a Windows computer for a student in Pakistan.

You will receive the user's request and the results of any tools you have already run. Decide what to do next.

AVAILABLE TOOLS:
${tools}

LANGUAGE RULES:
- The user may speak English, Urdu script, or Roman Urdu ("chrome open karo").
- Understand all three.
- Tool names and tool arguments must ALWAYS be in English, regardless of what the user spoke.
- Your "final_message" must be written in the SAME language the user used.

RESPONSE FORMAT — reply with JSON only, no prose and no markdown fences:
{"tool_calls":[{"name":"<tool>","args":{...}}],"final_message":"<what to tell the user>"}

- To act, put one or more calls in "tool_calls".
- When the task is finished, return an empty "tool_calls" array and a "final_message".
- Break multi-step requests into several tool calls, one step at a time.
- Never invent a tool that is not listed above.
- Use the single most direct tool for each step. Never call two tools that
  achieve the same goal — for a site search, either open_url with a search URL
  or web_search, never both.
- The user is speaking, so a request may be transcribed loosely. Act on the
  clear intent rather than asking for clarification when the meaning is obvious.`;
}

/** Removes ```json fences some models add despite being told not to. */
function stripFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

function parseToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry): ToolCall[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { name, args } = entry as { name?: unknown; args?: unknown };
    if (typeof name !== 'string' || !name) return [];
    return [
      {
        name,
        args:
          typeof args === 'object' && args !== null
            ? (args as Record<string, unknown>)
            : {},
      },
    ];
  });
}

/**
 * Adapts the provider-agnostic LLMService into the TurnFn the loop needs.
 *
 * Never throws. A provider error or malformed response becomes a turn with no
 * tool calls and a spoken explanation, so the loop ends cleanly instead of
 * crashing the agent.
 */
export function createLlmTurnFn(
  llm: LLMService,
  registry: ToolRegistry
): TurnFn {
  const systemPrompt = buildToolSystemPrompt(registry);

  return async (history: LoopMessage[]): Promise<LoopTurn> => {
    const userMessage = history.map((m) => `[${m.role}] ${m.content}`).join('\n');

    const result = await llm.textComplete(
      systemPrompt,
      userMessage,
      true,
      MAX_TOKENS
    );

    if (!result.ok) {
      return {
        toolCalls: [],
        finalMessage: `I could not reach the AI provider: ${result.error.message}`,
      };
    }

    let parsed: { tool_calls?: unknown; final_message?: unknown };
    try {
      parsed = JSON.parse(stripFences(result.text));
    } catch {
      return {
        toolCalls: [],
        finalMessage: "I didn't understand that. Could you say it again?",
      };
    }

    return {
      toolCalls: parseToolCalls(parsed.tool_calls),
      finalMessage:
        typeof parsed.final_message === 'string'
          ? parsed.final_message
          : undefined,
    };
  };
}
