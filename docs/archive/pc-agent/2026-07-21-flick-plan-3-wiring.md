# Flick Plan 3 — Wiring the Tool Loop Into the App

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multi-step spoken instructions actually work in the running app, replacing single-shot intent classification.

**Architecture:** A `TurnFn` adapter turns the existing provider-agnostic `LLMService` into the model call the loop needs, using JSON mode rather than per-provider function calling. `AgentService` then runs `ToolLoop` instead of `IntentClassifier`.

**Tech Stack:** TypeScript 5.3 (CommonJS, ES2022, strict), Electron 28, Vitest.

**Source spec:** `documantation/2026-07-21-flick-mcp-agent-design.md` §6.2, §6.3

## Global Constraints

- All new code is TypeScript, `strict: true`, CommonJS output, ES2022 target.
- Work happens in `apps/electron/`. Run every command from that directory.
- API keys never live or execute in the renderer process. (Spec §7.1)
- **The language boundary (spec §6.3) is enforced in the adapter's system prompt:**
  understand any language, emit English tool names and arguments, reply in the
  user's language.
- Commit after every task. Never commit a failing test.

## Why JSON mode instead of native function calling

`LLMService.textComplete(systemPrompt, userMessage, jsonMode, maxTokens)` is the only
completion surface, and none of the five providers expose native tool calling through it.

Adding native function calling would mean changing every provider adapter and diverging
their behaviour, since each vendor's schema differs. JSON mode works identically across
OpenAI, Gemini, DeepSeek, Anthropic and Qwen today, for one prompt's worth of effort.

Trade-off accepted: JSON mode is less reliable than native tool calling — the model can
return malformed JSON. The adapter therefore treats a parse failure as a normal turn with
no tool calls rather than an exception, so a bad response degrades to "Flick didn't
understand" instead of a crash.

## Plan Sequence

| Plan | Scope | Status |
|---|---|---|
| 1 — Input pipeline | Language layer, detector, multilingual ASR, Qwen | done, merged |
| 2 — Tool loop | Registry, permission gate, desktop tools, loop | done |
| **3 — Wiring** | LLM turn adapter, AgentService integration | **this document** |
| 4 — Confirm dialog UI | Renderer prompt + IPC for PermissionGate | not yet written |
| 5 — MCP SDK + Alibaba ASR | Third-party servers, fast cloud transcription | not yet written |
| 6 — Capabilities | Spotify, Gmail, WhatsApp, tutor, weather | not yet written |

**Until Plan 4 lands, `PermissionGate` is constructed with an auto-approve confirm
function.** Every desktop tool is side-effecting, so a gate that cannot prompt would block
everything. This is a deliberate, temporary state and is called out in the code.

---

### Task 1: LLM Turn Adapter

**Files:**
- Create: `apps/electron/src/main/agent/llm-turn-adapter.ts`
- Create: `apps/electron/src/main/agent/llm-turn-adapter.test.ts`

**Interfaces:**
- Consumes: `LLMService`, `ToolRegistry`, `LoopMessage`, `LoopTurn` from `./tool-loop`
- Produces:
  - `buildToolSystemPrompt(registry: ToolRegistry): string`
  - `createLlmTurnFn(llm: LLMService, registry: ToolRegistry): TurnFn`

- [ ] **Step 1: Write the failing tests**

Create `apps/electron/src/main/agent/llm-turn-adapter.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildToolSystemPrompt, createLlmTurnFn } from './llm-turn-adapter';
import { ToolRegistry } from './tools/tool-registry';
import type { LLMService } from './llm/llm-service';

function registry() {
  const r = new ToolRegistry();
  r.register(
    {
      name: 'open_application',
      description: 'Launch an app.',
      sideEffecting: true,
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
    async () => ({ ok: true, content: 'ok' })
  );
  return r;
}

function llmReturning(text: string): LLMService {
  return {
    textComplete: vi.fn().mockResolvedValue({ ok: true, text }),
  } as unknown as LLMService;
}

describe('buildToolSystemPrompt', () => {
  it('lists every registered tool', () => {
    expect(buildToolSystemPrompt(registry())).toContain('open_application');
  });

  it('states the language boundary', () => {
    const prompt = buildToolSystemPrompt(registry());
    expect(prompt).toMatch(/english/i);
    expect(prompt).toMatch(/urdu/i);
  });
});

describe('createLlmTurnFn', () => {
  it('parses tool calls from the model response', async () => {
    const turn = createLlmTurnFn(
      llmReturning(
        '{"tool_calls":[{"name":"open_application","args":{"name":"spotify"}}]}'
      ),
      registry()
    );

    const result = await turn([{ role: 'user', content: 'open spotify' }]);

    expect(result.toolCalls).toEqual([
      { name: 'open_application', args: { name: 'spotify' } },
    ]);
  });

  it('parses a final message when there are no tool calls', async () => {
    const turn = createLlmTurnFn(
      llmReturning('{"tool_calls":[],"final_message":"Lahore is 34 degrees."}'),
      registry()
    );

    const result = await turn([{ role: 'user', content: 'weather' }]);

    expect(result.toolCalls).toEqual([]);
    expect(result.finalMessage).toBe('Lahore is 34 degrees.');
  });

  it('strips markdown fences before parsing', async () => {
    const turn = createLlmTurnFn(
      llmReturning('```json\n{"tool_calls":[],"final_message":"hi"}\n```'),
      registry()
    );

    const result = await turn([{ role: 'user', content: 'hi' }]);

    expect(result.finalMessage).toBe('hi');
  });

  it('degrades to a spoken error when the model returns malformed JSON', async () => {
    const turn = createLlmTurnFn(llmReturning('not json at all'), registry());

    const result = await turn([{ role: 'user', content: 'x' }]);

    expect(result.toolCalls).toEqual([]);
    expect(result.finalMessage).toMatch(/didn't understand|could not/i);
  });

  it('degrades to a spoken error when the provider fails', async () => {
    const llm = {
      textComplete: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { kind: 'network', message: 'offline' } }),
    } as unknown as LLMService;

    const result = await createLlmTurnFn(llm, registry())([
      { role: 'user', content: 'x' },
    ]);

    expect(result.toolCalls).toEqual([]);
    expect(result.finalMessage).toContain('offline');
  });

  it('drops malformed tool call entries rather than passing them on', async () => {
    const turn = createLlmTurnFn(
      llmReturning('{"tool_calls":[{"noname":true},{"name":"open_application"}]}'),
      registry()
    );

    const result = await turn([{ role: 'user', content: 'x' }]);

    expect(result.toolCalls).toEqual([{ name: 'open_application', args: {} }]);
  });

  it('sends the conversation history to the model', async () => {
    const llm = llmReturning('{"tool_calls":[]}');
    const turn = createLlmTurnFn(llm, registry());

    await turn([
      { role: 'user', content: 'open spotify' },
      { role: 'tool', content: '{"tool":"open_application","result":{"ok":true}}' },
    ]);

    const userMessage = (llm.textComplete as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(userMessage).toContain('open spotify');
    expect(userMessage).toContain('open_application');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./llm-turn-adapter"`

- [ ] **Step 3: Write the implementation**

Create `apps/electron/src/main/agent/llm-turn-adapter.ts`:

```ts
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
    .map((t) => `- ${t.name}: ${t.description}\n  arguments: ${JSON.stringify(t.input_schema.properties)}`)
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
- Never invent a tool that is not listed above.`;
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
    const userMessage = history
      .map((m) => `[${m.role}] ${m.content}`)
      .join('\n');

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 84 passed

- [ ] **Step 5: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add apps/electron/src/main/agent/
git commit -m "feat(agent): adapt LLMService into a tool-loop turn function"
```

---

### Task 2: AgentService Integration

Replaces the single-shot `IntentClassifier` path with the loop. `CommandDetector` stays —
it is the gate that keeps dictation off the paid path.

**Files:**
- Modify: `apps/electron/src/main/agent/agent-service.ts`
- Create: `apps/electron/src/main/agent/agent-service.test.ts`

**Interfaces:**
- Consumes: `ToolLoop`, `ToolRegistry`, `PermissionGate`, `createLlmTurnFn`, `registerDesktopTools`
- Produces: `AgentService.process(text)` unchanged in signature, multi-step in behaviour

- [ ] **Step 1: Write the failing tests**

Create `apps/electron/src/main/agent/agent-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentService } from './agent-service';

function notifier() {
  return {
    notifySuccess: vi.fn(),
    notifyError: vi.fn(),
    notifyUnrecognized: vi.fn(),
  };
}

describe('AgentService', () => {
  let service: AgentService;
  let notify: ReturnType<typeof notifier>;

  beforeEach(() => {
    notify = notifier();
    service = new AgentService(notify);
  });

  it('passes dictation through without handling it', async () => {
    service.setEnabled(true);

    const result = await service.process('the meeting went well today');

    expect(result.handled).toBe(false);
  });

  it('passes everything through while disabled', async () => {
    service.setEnabled(false);

    const result = await service.process('open chrome');

    expect(result.handled).toBe(false);
  });

  it('registers the desktop tools on construction', () => {
    expect(service.getToolNames()).toContain('open_application');
    expect(service.getToolNames()).toContain('open_path');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `service.getToolNames is not a function`

- [ ] **Step 3: Read the current AgentService**

Read `apps/electron/src/main/agent/agent-service.ts` in full before editing. The
constructor wires `LLMService`, `CommandDetector`, `IntentClassifier`, `ActionExecutor`
and `AgentStore`; `process()` runs detect → classify → execute → log → notify. Keep the
detector, the store, the notifier calls and the `AgentResult` shape. Replace only the
classify-and-execute middle.

- [ ] **Step 4: Add the tool loop to the constructor**

In `apps/electron/src/main/agent/agent-service.ts`, add these imports:

```ts
import { ToolRegistry } from './tools/tool-registry';
import { PermissionGate } from './tools/permission-gate';
import { registerDesktopTools } from './tools/desktop-tools';
import { ToolLoop } from './tool-loop';
import { createLlmTurnFn } from './llm-turn-adapter';
```

Add these fields to the class:

```ts
  private toolRegistry: ToolRegistry;
  private toolLoop: ToolLoop;
```

and at the end of the constructor, after `this.agentStore = new AgentStore();`:

```ts
    this.toolRegistry = new ToolRegistry();
    registerDesktopTools(this.toolRegistry, this.actionExecutor);

    // TEMPORARY: auto-approve until the confirm dialog lands in Plan 4. Every
    // desktop tool is side-effecting, so a gate that cannot prompt would block
    // every action.
    const gate = new PermissionGate(async () => true);

    this.toolLoop = new ToolLoop(
      this.toolRegistry,
      gate,
      createLlmTurnFn(this.llmService, this.toolRegistry)
    );
```

- [ ] **Step 5: Add the tool-name accessor**

Add this method to `AgentService`:

```ts
  /** Names of every registered tool. Used by tests and the dashboard. */
  getToolNames(): string[] {
    return this.toolRegistry.list().map((t) => t.name);
  }
```

- [ ] **Step 6: Replace the classify-and-execute body of process()**

Replace everything in `process()` after the `if (!detection.isCommand) { return { handled: false }; }` guard with:

```ts
    const startTime = Date.now();
    const outcome = await this.toolLoop.run(text, detection.language);
    const durationMs = Date.now() - startTime;

    // Log one entry per tool call so the Agent panel shows each step.
    for (const step of outcome.steps) {
      this.agentStore.addEntry({
        id: uuidv4(),
        timestamp: Date.now(),
        commandText: text,
        intentType: step.call.name as never,
        target: JSON.stringify(step.call.args),
        status: step.result.ok ? 'success' : 'error',
        durationMs,
        ...(step.result.ok ? {} : { errorMessage: step.result.error }),
      });
    }

    if (outcome.steps.length === 0 && !outcome.finalMessage) {
      this.notifier.notifyUnrecognized(text);
      return { handled: false };
    }

    const failed = outcome.steps.filter((s) => !s.result.ok);
    if (failed.length > 0) {
      this.notifier.notifyError(
        failed[0].result.ok ? 'Action failed' : failed[0].result.error
      );
    } else if (outcome.finalMessage) {
      this.notifier.notifySuccess(outcome.finalMessage);
    }

    return { handled: true };
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 87 passed

- [ ] **Step 8: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: exit 0. `IntentClassifier` may now be unused — if `noUnusedLocals` were on this
would error; it is off, so remove the unused field and import by hand.

- [ ] **Step 9: Commit**

```bash
git add apps/electron/src/main/agent/
git commit -m "feat(agent): run the tool loop instead of single-shot classification"
```

---

## Definition of Done for Plan 3

- [ ] `npm test` passes with 87 tests
- [ ] `npx tsc --noEmit` exits 0
- [ ] `npm run build` exits 0
- [ ] Launching the app and saying "open chrome" still opens Chrome
- [ ] Saying "open notepad and type hello" performs two actions

## What Plan 3 Does Not Cover

- The confirm dialog — `PermissionGate` auto-approves until Plan 4
- MCP SDK and third-party servers — Plan 5
- `AlibabaASRProvider` — Plan 5, and still the top performance risk
- Spotify playlist control, Gmail, WhatsApp — Plan 6
