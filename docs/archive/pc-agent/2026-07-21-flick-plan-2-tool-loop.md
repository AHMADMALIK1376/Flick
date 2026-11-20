# Flick Plan 2 — Multi-Step Tool Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Flick carry out multi-step spoken instructions — "open Spotify, go to my playlist, play a song" — instead of one action per utterance.

**Architecture:** A tool registry with MCP-compatible JSON Schema descriptors sits in front of the existing `ActionExecutor`. `AgentService` gains a tool-use loop that calls the model, executes the tool it asks for, feeds the result back, and repeats until done. A permission gate blocks side-effecting tools until the user confirms.

**Tech Stack:** TypeScript 5.3 (CommonJS, ES2022, strict), Electron 28, Vitest.

**Source spec:** `documantation/2026-07-21-flick-mcp-agent-design.md` §6.2, §6.5

## Global Constraints

- All new code is TypeScript, `strict: true`, CommonJS output, ES2022 target.
- Work happens in `apps/electron/`. Run every command from that directory.
- API keys never live or execute in the renderer process. (Spec §7.1)
- Tool descriptors use JSON Schema so they can be handed to any provider's
  function-calling API unchanged, and so real MCP servers can be added in Plan 3
  without reshaping the registry.
- Nothing in this plan may generate submittable assignment answers. (Spec §8)
- Commit after every task. Never commit a failing test.

## Why in-process tools before real MCP

Plan 3 adds `@modelcontextprotocol/sdk` so third-party MCP servers (Gmail, Slack,
filesystem) can be plugged in without custom integration code. That is a large win, but
it depends on stdio transport working inside Electron's packaged main process, which is
its own risk.

This plan therefore builds the registry and loop against in-process tools first. The
descriptor shape is MCP-compatible from day one, so Plan 3 adds a second source of tools
rather than a rewrite.

## Plan Sequence

| Plan | Scope | Status |
|---|---|---|
| 1 — Input pipeline | Language layer, detector, multilingual ASR, Qwen | **done, merged** |
| **2 — Tool loop** | Registry, permission gate, desktop tools, multi-step loop | **this document** |
| 3 — MCP + cloud ASR | `@modelcontextprotocol/sdk` host, `AlibabaASRProvider` | not yet written |
| 4 — Capabilities | tutor, whatsapp, gmail, weather | not yet written |
| 5 — Polish | README/branding, demo script, packaging | not yet written |

---

### Task 1: Tool Registry

**Files:**
- Create: `apps/electron/src/main/agent/tools/tool-types.ts`
- Create: `apps/electron/src/main/agent/tools/tool-registry.ts`
- Create: `apps/electron/src/main/agent/tools/tool-registry.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface ToolDescriptor { name, description, inputSchema, sideEffecting }`
  - `type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>`
  - `type ToolResult = { ok: true; content: string } | { ok: false; error: string }`
  - `class ToolRegistry` with `register`, `get`, `list`, `describeForModel`

- [ ] **Step 1: Write the failing tests**

Create `apps/electron/src/main/agent/tools/tool-registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ToolRegistry } from './tool-registry';
import type { ToolDescriptor } from './tool-types';

const openApp: ToolDescriptor = {
  name: 'open_application',
  description: 'Launch an application by name.',
  sideEffecting: false,
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Application name' } },
    required: ['name'],
  },
};

describe('ToolRegistry', () => {
  it('registers and retrieves a tool', () => {
    const registry = new ToolRegistry();
    registry.register(openApp, async () => ({ ok: true, content: 'launched' }));

    expect(registry.get('open_application')).toBeDefined();
  });

  it('returns undefined for an unknown tool', () => {
    expect(new ToolRegistry().get('nope')).toBeUndefined();
  });

  it('rejects duplicate registration', () => {
    const registry = new ToolRegistry();
    registry.register(openApp, async () => ({ ok: true, content: '' }));

    expect(() =>
      registry.register(openApp, async () => ({ ok: true, content: '' }))
    ).toThrow(/already registered/i);
  });

  it('lists every registered tool', () => {
    const registry = new ToolRegistry();
    registry.register(openApp, async () => ({ ok: true, content: '' }));

    expect(registry.list().map((t) => t.name)).toEqual(['open_application']);
  });

  it('describes tools in the shape a model expects', () => {
    const registry = new ToolRegistry();
    registry.register(openApp, async () => ({ ok: true, content: '' }));

    expect(registry.describeForModel()).toEqual([
      {
        name: 'open_application',
        description: 'Launch an application by name.',
        input_schema: openApp.inputSchema,
      },
    ]);
  });

  it('invokes the handler registered for a tool', async () => {
    const registry = new ToolRegistry();
    registry.register(openApp, async (args) => ({
      ok: true,
      content: `launched ${args.name}`,
    }));

    const result = await registry.invoke('open_application', { name: 'spotify' });

    expect(result).toEqual({ ok: true, content: 'launched spotify' });
  });

  it('returns an error result when invoking an unknown tool', async () => {
    const result = await new ToolRegistry().invoke('nope', {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/unknown tool/i);
    }
  });

  it('converts a handler throw into an error result', async () => {
    const registry = new ToolRegistry();
    registry.register(openApp, async () => {
      throw new Error('spotify is not installed');
    });

    const result = await registry.invoke('open_application', { name: 'spotify' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('spotify is not installed');
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./tool-registry"`

- [ ] **Step 3: Write the type definitions**

Create `apps/electron/src/main/agent/tools/tool-types.ts`:

```ts
/** JSON Schema fragment describing a tool's arguments. */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
}

export interface ToolDescriptor {
  /** Stable identifier the model calls, e.g. "open_application". */
  name: string;
  /** Plain-language description. The model relies on this to choose correctly. */
  description: string;
  inputSchema: ToolInputSchema;
  /**
   * True when running the tool changes something outside Flick — sending a
   * message, deleting a file. Side-effecting tools pass through PermissionGate.
   */
  sideEffecting: boolean;
}

export type ToolResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<ToolResult>;

/** Tool descriptor in the shape function-calling APIs expect. */
export interface ModelToolSpec {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
}
```

- [ ] **Step 4: Write the registry**

Create `apps/electron/src/main/agent/tools/tool-registry.ts`:

```ts
import type {
  ModelToolSpec,
  ToolDescriptor,
  ToolHandler,
  ToolResult,
} from './tool-types';

interface Entry {
  descriptor: ToolDescriptor;
  handler: ToolHandler;
}

/**
 * Holds every tool Flick can call, and runs them by name.
 *
 * Descriptors are MCP-compatible JSON Schema so the same registry can later
 * aggregate tools from real MCP servers without reshaping.
 */
export class ToolRegistry {
  private readonly entries = new Map<string, Entry>();

  register(descriptor: ToolDescriptor, handler: ToolHandler): void {
    if (this.entries.has(descriptor.name)) {
      throw new Error(`Tool "${descriptor.name}" is already registered.`);
    }
    this.entries.set(descriptor.name, { descriptor, handler });
  }

  get(name: string): ToolDescriptor | undefined {
    return this.entries.get(name)?.descriptor;
  }

  list(): ToolDescriptor[] {
    return [...this.entries.values()].map((e) => e.descriptor);
  }

  /** Tool specs to hand to the model on each turn. */
  describeForModel(): ModelToolSpec[] {
    return this.list().map((d) => ({
      name: d.name,
      description: d.description,
      input_schema: d.inputSchema,
    }));
  }

  /**
   * Runs a tool by name. Never throws — a handler that throws becomes an error
   * result, so one failing tool cannot abort the agent loop.
   */
  async invoke(
    name: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const entry = this.entries.get(name);
    if (!entry) {
      return { ok: false, error: `Unknown tool "${name}".` };
    }

    try {
      return await entry.handler(args);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 54 passed

- [ ] **Step 6: Commit**

```bash
git add apps/electron/src/main/agent/tools/
git commit -m "feat(tools): add MCP-compatible tool registry"
```

---

### Task 2: Permission Gate

Voice transcription will mishear a contact name eventually. A message sent to the wrong
person is unrecoverable, so side-effecting tools confirm before running. (Spec §6.5)

**Files:**
- Create: `apps/electron/src/main/agent/tools/permission-gate.ts`
- Create: `apps/electron/src/main/agent/tools/permission-gate.test.ts`

**Interfaces:**
- Consumes: `ToolDescriptor` from `./tool-types`
- Produces:
  - `type ConfirmFn = (request: ConfirmRequest) => Promise<boolean>`
  - `class PermissionGate` with `check(descriptor, args): Promise<GateDecision>`

- [ ] **Step 1: Write the failing tests**

Create `apps/electron/src/main/agent/tools/permission-gate.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { PermissionGate } from './permission-gate';
import type { ToolDescriptor } from './tool-types';

const readOnly: ToolDescriptor = {
  name: 'get_weather',
  description: 'Look up the weather.',
  sideEffecting: false,
  inputSchema: { type: 'object', properties: {} },
};

const sideEffecting: ToolDescriptor = {
  name: 'send_message',
  description: 'Send a WhatsApp message.',
  sideEffecting: true,
  inputSchema: {
    type: 'object',
    properties: { to: { type: 'string' }, body: { type: 'string' } },
  },
};

describe('PermissionGate', () => {
  it('allows a read-only tool without prompting', async () => {
    const confirm = vi.fn();
    const gate = new PermissionGate(confirm);

    const decision = await gate.check(readOnly, {});

    expect(decision.allowed).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('prompts before a side-effecting tool', async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const gate = new PermissionGate(confirm);

    const decision = await gate.check(sideEffecting, {
      to: 'Ami Jan',
      body: 'late',
    });

    expect(decision.allowed).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('passes the tool name and arguments to the prompt', async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const gate = new PermissionGate(confirm);

    await gate.check(sideEffecting, { to: 'Ami Jan', body: 'late' });

    expect(confirm).toHaveBeenCalledWith({
      toolName: 'send_message',
      description: 'Send a WhatsApp message.',
      args: { to: 'Ami Jan', body: 'late' },
    });
  });

  it('blocks when the user declines', async () => {
    const gate = new PermissionGate(vi.fn().mockResolvedValue(false));

    const decision = await gate.check(sideEffecting, {});

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/declined/i);
  });

  it('blocks when the prompt throws, rather than allowing by default', async () => {
    const gate = new PermissionGate(
      vi.fn().mockRejectedValue(new Error('window closed'))
    );

    const decision = await gate.check(sideEffecting, {});

    expect(decision.allowed).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./permission-gate"`

- [ ] **Step 3: Write the implementation**

Create `apps/electron/src/main/agent/tools/permission-gate.ts`:

```ts
import type { ToolDescriptor } from './tool-types';

export interface ConfirmRequest {
  toolName: string;
  description: string;
  args: Record<string, unknown>;
}

export type ConfirmFn = (request: ConfirmRequest) => Promise<boolean>;

export interface GateDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Confirms side-effecting tool calls before they run.
 *
 * Read-only tools pass straight through — prompting for a weather lookup would
 * train the user to click through every prompt, which defeats the point.
 */
export class PermissionGate {
  constructor(private readonly confirm: ConfirmFn) {}

  async check(
    descriptor: ToolDescriptor,
    args: Record<string, unknown>
  ): Promise<GateDecision> {
    if (!descriptor.sideEffecting) {
      return { allowed: true };
    }

    let approved: boolean;
    try {
      approved = await this.confirm({
        toolName: descriptor.name,
        description: descriptor.description,
        args,
      });
    } catch (err) {
      // Fail closed. An unanswerable prompt must never mean "go ahead".
      return {
        allowed: false,
        reason: `Could not confirm "${descriptor.name}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }

    return approved
      ? { allowed: true }
      : { allowed: false, reason: `User declined "${descriptor.name}".` };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 59 passed

- [ ] **Step 5: Commit**

```bash
git add apps/electron/src/main/agent/tools/
git commit -m "feat(tools): add permission gate for side-effecting tools"
```

---

### Task 3: Desktop Tools

Wraps the existing `ActionExecutor` as tools. Nothing in `action-executor.ts` changes —
it gains a second caller.

**Files:**
- Create: `apps/electron/src/main/agent/tools/desktop-tools.ts`
- Create: `apps/electron/src/main/agent/tools/desktop-tools.test.ts`

**Interfaces:**
- Consumes: `ToolRegistry`, `ActionExecutor`, `ClassifiedIntent` from `../../../shared/types`
- Produces: `registerDesktopTools(registry: ToolRegistry, executor: ActionExecutor): void`

The existing `ActionExecutor.execute(intent)` takes a `ClassifiedIntent` with an `action`
and a `target`, and returns an `ExecutionResult`. Each tool maps its own arguments onto
that shape, so the executor's contract is untouched.

- [ ] **Step 1: Write the failing tests**

Create `apps/electron/src/main/agent/tools/desktop-tools.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from './tool-registry';
import { registerDesktopTools } from './desktop-tools';

function setup(executeImpl?: (intent: unknown) => Promise<unknown>) {
  const execute = vi.fn(
    executeImpl ?? (async () => ({ success: true, message: 'done' }))
  );
  const registry = new ToolRegistry();
  registerDesktopTools(registry, { execute } as never);
  return { registry, execute };
}

describe('registerDesktopTools', () => {
  it('registers the desktop tools', () => {
    const { registry } = setup();

    expect(registry.list().map((t) => t.name).sort()).toEqual([
      'open_application',
      'open_path',
      'open_url',
      'system_control',
      'type_text',
      'web_search',
    ]);
  });

  it('marks all desktop tools as side-effecting', () => {
    const { registry } = setup();

    for (const tool of registry.list()) {
      expect(tool.sideEffecting, `${tool.name} should be side-effecting`).toBe(true);
    }
  });

  it('maps open_application onto the executor intent', async () => {
    const { registry, execute } = setup();

    await registry.invoke('open_application', { name: 'spotify' });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'open_application', target: 'spotify' })
    );
  });

  it('maps open_path onto the executor intent', async () => {
    const { registry, execute } = setup();

    await registry.invoke('open_path', { path: 'C:\\Users' });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'open_path', target: 'C:\\Users' })
    );
  });

  it('returns a success result the model can read', async () => {
    const { registry } = setup();

    const result = await registry.invoke('open_application', { name: 'spotify' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toMatch(/spotify/i);
    }
  });

  it('surfaces executor failure as an error result', async () => {
    const { registry } = setup(async () => ({
      success: false,
      message: 'application not found',
    }));

    const result = await registry.invoke('open_application', { name: 'nope' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('application not found');
    }
  });

  it('rejects a missing required argument without calling the executor', async () => {
    const { registry, execute } = setup();

    const result = await registry.invoke('open_application', {});

    expect(result.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./desktop-tools"`

- [ ] **Step 3: Write the implementation**

Create `apps/electron/src/main/agent/tools/desktop-tools.ts`:

```ts
import type { ActionExecutor } from '../action-executor';
import type { ActionType } from '../../../shared/types';
import type { ToolRegistry } from './tool-registry';
import type { ToolResult } from './tool-types';

interface DesktopTool {
  name: string;
  description: string;
  /** The executor action this tool maps onto. */
  action: ActionType;
  /** The single argument this tool takes, mapped to the intent's `target`. */
  arg: string;
  argDescription: string;
}

const DESKTOP_TOOLS: DesktopTool[] = [
  {
    name: 'open_application',
    description:
      'Launch an application on this computer by name, e.g. "spotify", "chrome", "notepad".',
    action: 'open_application',
    arg: 'name',
    argDescription: 'Application name',
  },
  {
    name: 'open_url',
    description: 'Open a web address in the default browser.',
    action: 'open_url',
    arg: 'url',
    argDescription: 'Full URL including https://',
  },
  {
    name: 'open_path',
    description:
      'Open a file or folder in the system file manager. Use this for File Explorer.',
    action: 'open_path',
    arg: 'path',
    argDescription: 'Absolute file or folder path',
  },
  {
    name: 'type_text',
    description: 'Type text into whatever window currently has focus.',
    action: 'type_text',
    arg: 'text',
    argDescription: 'Text to type',
  },
  {
    name: 'web_search',
    description: 'Search the web for a query in the default browser.',
    action: 'web_search',
    arg: 'query',
    argDescription: 'Search query',
  },
  {
    name: 'system_control',
    description:
      'Control the computer: mute, unmute, volume_up, volume_down, screenshot, lock_screen, brightness_up, brightness_down.',
    action: 'system_control',
    arg: 'command',
    argDescription: 'One of the supported control commands',
  },
];

/**
 * Exposes the existing ActionExecutor as callable tools.
 *
 * Every desktop tool is marked side-effecting: launching apps, typing, and
 * changing system settings all alter state outside Flick, so each one passes
 * through PermissionGate.
 */
export function registerDesktopTools(
  registry: ToolRegistry,
  executor: ActionExecutor
): void {
  for (const tool of DESKTOP_TOOLS) {
    registry.register(
      {
        name: tool.name,
        description: tool.description,
        sideEffecting: true,
        inputSchema: {
          type: 'object',
          properties: {
            [tool.arg]: { type: 'string', description: tool.argDescription },
          },
          required: [tool.arg],
        },
      },
      async (args): Promise<ToolResult> => {
        const target = args[tool.arg];
        if (typeof target !== 'string' || !target.trim()) {
          return {
            ok: false,
            error: `Tool "${tool.name}" requires a "${tool.arg}" argument.`,
          };
        }

        const result = await executor.execute({
          action: tool.action,
          target,
          confidence: 1,
        } as never);

        return result.success
          ? { ok: true, content: result.message || `${tool.name}: ${target}` }
          : { ok: false, error: result.message || `${tool.name} failed.` };
      }
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 66 passed

- [ ] **Step 5: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add apps/electron/src/main/agent/tools/
git commit -m "feat(tools): expose desktop actions as callable tools"
```

---

### Task 4: The Tool Loop

Replaces single-shot classification with the loop that makes multi-step instructions
work. This is what turns "open Spotify, go to my playlist, play a song" from impossible
into three tool calls.

**Files:**
- Create: `apps/electron/src/main/agent/tool-loop.ts`
- Create: `apps/electron/src/main/agent/tool-loop.test.ts`

**Interfaces:**
- Consumes: `ToolRegistry`, `PermissionGate`, `LanguageHint`
- Produces:
  - `interface ToolCall { name: string; args: Record<string, unknown> }`
  - `interface LoopTurn { toolCalls: ToolCall[]; finalMessage?: string }`
  - `type TurnFn = (history: LoopMessage[]) => Promise<LoopTurn>`
  - `class ToolLoop` with `run(userText, language): Promise<LoopOutcome>`

`TurnFn` is injected rather than calling `LLMService` directly, so the loop is testable
without a network and so Plan 3 can swap in a different provider adapter.

- [ ] **Step 1: Write the failing tests**

Create `apps/electron/src/main/agent/tool-loop.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ToolLoop } from './tool-loop';
import { ToolRegistry } from './tools/tool-registry';
import { PermissionGate } from './tools/permission-gate';
import type { ToolDescriptor } from './tools/tool-types';

const openApp: ToolDescriptor = {
  name: 'open_application',
  description: 'Launch an app.',
  sideEffecting: true,
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  },
};

function registryWith(handler = vi.fn(async () => ({ ok: true as const, content: 'ok' }))) {
  const registry = new ToolRegistry();
  registry.register(openApp, handler);
  return { registry, handler };
}

const allowAll = new PermissionGate(async () => true);

describe('ToolLoop', () => {
  it('returns the final message when the model calls no tools', async () => {
    const { registry } = registryWith();
    const turn = vi.fn().mockResolvedValue({
      toolCalls: [],
      finalMessage: 'Lahore is 34 degrees.',
    });

    const outcome = await new ToolLoop(registry, allowAll, turn).run('weather', 'en');

    expect(outcome.finalMessage).toBe('Lahore is 34 degrees.');
    expect(outcome.steps).toHaveLength(0);
  });

  it('executes a tool the model asks for', async () => {
    const { registry, handler } = registryWith();
    const turn = vi
      .fn()
      .mockResolvedValueOnce({
        toolCalls: [{ name: 'open_application', args: { name: 'spotify' } }],
      })
      .mockResolvedValueOnce({ toolCalls: [], finalMessage: 'Opened Spotify.' });

    const outcome = await new ToolLoop(registry, allowAll, turn).run('open spotify', 'en');

    expect(handler).toHaveBeenCalledWith({ name: 'spotify' });
    expect(outcome.finalMessage).toBe('Opened Spotify.');
    expect(outcome.steps).toHaveLength(1);
  });

  it('chains multiple tool calls across turns', async () => {
    const { registry } = registryWith();
    const turn = vi
      .fn()
      .mockResolvedValueOnce({
        toolCalls: [{ name: 'open_application', args: { name: 'spotify' } }],
      })
      .mockResolvedValueOnce({
        toolCalls: [{ name: 'open_application', args: { name: 'playlist' } }],
      })
      .mockResolvedValueOnce({ toolCalls: [], finalMessage: 'Playing.' });

    const outcome = await new ToolLoop(registry, allowAll, turn).run('play music', 'en');

    expect(outcome.steps).toHaveLength(2);
    expect(outcome.finalMessage).toBe('Playing.');
  });

  it('feeds the tool result back to the model', async () => {
    const { registry } = registryWith(
      vi.fn(async () => ({ ok: true as const, content: 'spotify launched' }))
    );
    const turn = vi
      .fn()
      .mockResolvedValueOnce({
        toolCalls: [{ name: 'open_application', args: { name: 'spotify' } }],
      })
      .mockResolvedValueOnce({ toolCalls: [], finalMessage: 'done' });

    await new ToolLoop(registry, allowAll, turn).run('open spotify', 'en');

    const secondCallHistory = turn.mock.calls[1][0];
    expect(JSON.stringify(secondCallHistory)).toContain('spotify launched');
  });

  it('stops at the step limit rather than looping forever', async () => {
    const { registry } = registryWith();
    const turn = vi.fn().mockResolvedValue({
      toolCalls: [{ name: 'open_application', args: { name: 'spotify' } }],
    });

    const outcome = await new ToolLoop(registry, allowAll, turn, 3).run('go', 'en');

    expect(outcome.steps).toHaveLength(3);
    expect(outcome.stoppedReason).toBe('step_limit');
  });

  it('does not run a tool the user declined', async () => {
    const { registry, handler } = registryWith();
    const denyAll = new PermissionGate(async () => false);
    const turn = vi
      .fn()
      .mockResolvedValueOnce({
        toolCalls: [{ name: 'open_application', args: { name: 'spotify' } }],
      })
      .mockResolvedValueOnce({ toolCalls: [], finalMessage: 'Cancelled.' });

    await new ToolLoop(registry, denyAll, turn).run('open spotify', 'en');

    expect(handler).not.toHaveBeenCalled();
  });

  it('reports an unknown tool back to the model instead of throwing', async () => {
    const { registry } = registryWith();
    const turn = vi
      .fn()
      .mockResolvedValueOnce({ toolCalls: [{ name: 'nope', args: {} }] })
      .mockResolvedValueOnce({ toolCalls: [], finalMessage: 'Sorry.' });

    const outcome = await new ToolLoop(registry, allowAll, turn).run('x', 'en');

    expect(outcome.steps[0].result.ok).toBe(false);
    expect(outcome.finalMessage).toBe('Sorry.');
  });

  it('carries the language hint into the opening message', async () => {
    const { registry } = registryWith();
    const turn = vi.fn().mockResolvedValue({ toolCalls: [], finalMessage: 'ok' });

    await new ToolLoop(registry, allowAll, turn).run('chrome kholo', 'roman-ur');

    const history = turn.mock.calls[0][0];
    expect(JSON.stringify(history)).toContain('roman-ur');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./tool-loop"`

- [ ] **Step 3: Write the implementation**

Create `apps/electron/src/main/agent/tool-loop.ts`:

```ts
import type { LanguageHint } from '../../shared/types';
import type { PermissionGate } from './tools/permission-gate';
import type { ToolRegistry } from './tools/tool-registry';
import type { ToolResult } from './tools/tool-types';

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface LoopMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
}

export interface LoopTurn {
  toolCalls: ToolCall[];
  finalMessage?: string;
}

/** One round trip to the model. Injected so the loop is testable offline. */
export type TurnFn = (history: LoopMessage[]) => Promise<LoopTurn>;

export interface LoopStep {
  call: ToolCall;
  result: ToolResult;
}

export interface LoopOutcome {
  steps: LoopStep[];
  finalMessage?: string;
  stoppedReason?: 'step_limit';
}

/** Ceiling on tool calls per utterance, so a confused model cannot spin. */
const DEFAULT_MAX_STEPS = 8;

/**
 * Runs the model in a loop: call the model, execute whatever tools it asks for,
 * feed the results back, repeat until it produces a final answer.
 *
 * This is what lets one utterance drive several actions — "open Spotify, go to
 * my playlist, play a song" is three tool calls, not one.
 */
export class ToolLoop {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly gate: PermissionGate,
    private readonly turn: TurnFn,
    private readonly maxSteps: number = DEFAULT_MAX_STEPS
  ) {}

  async run(userText: string, language: LanguageHint): Promise<LoopOutcome> {
    const history: LoopMessage[] = [
      {
        role: 'user',
        content: JSON.stringify({ text: userText, language }),
      },
    ];
    const steps: LoopStep[] = [];

    while (steps.length < this.maxSteps) {
      const turn = await this.turn(history);

      if (turn.toolCalls.length === 0) {
        return { steps, finalMessage: turn.finalMessage };
      }

      for (const call of turn.toolCalls) {
        const result = await this.execute(call);
        steps.push({ call, result });
        history.push({
          role: 'tool',
          content: JSON.stringify({ tool: call.name, result }),
        });
      }
    }

    return { steps, stoppedReason: 'step_limit' };
  }

  private async execute(call: ToolCall): Promise<ToolResult> {
    const descriptor = this.registry.get(call.name);
    if (!descriptor) {
      // Report back rather than throwing — the model can recover by picking
      // a different tool.
      return { ok: false, error: `Unknown tool "${call.name}".` };
    }

    const decision = await this.gate.check(descriptor, call.args);
    if (!decision.allowed) {
      return { ok: false, error: decision.reason ?? 'Blocked.' };
    }

    return this.registry.invoke(call.name, call.args);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 75 passed

- [ ] **Step 5: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add apps/electron/src/main/agent/
git commit -m "feat(agent): add multi-step tool loop"
```

---

## Definition of Done for Plan 2

- [ ] `npm test` passes with 75 tests
- [ ] `npx tsc --noEmit` exits 0
- [ ] A mocked three-step instruction runs three tool calls and returns a final message
- [ ] A declined permission prompt prevents the tool handler from running

## What Plan 2 Does Not Cover

- Wiring `ToolLoop` into `AgentService` in place of `IntentClassifier`, and the confirm
  dialog in the renderer — needs UI work, deferred to the start of Plan 3
- `@modelcontextprotocol/sdk` and third-party MCP servers — Plan 3
- `AlibabaASRProvider` for fast cloud transcription — Plan 3, and the current top
  performance risk
- Spotify playlist control, Gmail, WhatsApp, weather — Plan 4
