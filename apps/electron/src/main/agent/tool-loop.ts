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
