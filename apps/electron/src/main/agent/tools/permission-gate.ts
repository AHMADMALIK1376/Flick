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
