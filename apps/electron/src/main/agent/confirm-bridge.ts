import { v4 as uuidv4 } from 'uuid';
import type { ConfirmFn, ConfirmRequest } from './tools/permission-gate';

/** A confirmation prompt sent to the renderer. */
export interface PendingConfirm extends ConfirmRequest {
  id: string;
}

/** Sends a prompt to the renderer. Returns false if no window can show it. */
export type SendPrompt = (prompt: PendingConfirm) => boolean;

/**
 * How long to wait for the user before giving up.
 *
 * Without this, a dialog dismissed by closing the window would leave the agent
 * loop awaiting a promise that never settles, hanging the assistant until
 * restart.
 */
const TIMEOUT_MS = 60_000;

/**
 * Bridges {@link PermissionGate} to the renderer's confirmation dialog.
 *
 * The gate is synchronous-looking (`await confirm(...)`) but the answer arrives
 * later over IPC, so pending prompts are held by id until resolved.
 */
export class ConfirmBridge {
  private readonly pending = new Map<
    string,
    { resolve: (approved: boolean) => void; timer: NodeJS.Timeout }
  >();

  constructor(private readonly send: SendPrompt) {}

  /** The function handed to PermissionGate. */
  readonly confirm: ConfirmFn = (request: ConfirmRequest) => {
    return new Promise<boolean>((resolve) => {
      const id = uuidv4();
      const delivered = this.send({ id, ...request });

      if (!delivered) {
        // No window to ask. Fail closed rather than silently acting.
        resolve(false);
        return;
      }

      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(false);
      }, TIMEOUT_MS);

      this.pending.set(id, { resolve, timer });
    });
  };

  /** Called when the renderer answers. Unknown ids are ignored. */
  resolve(id: string, approved: boolean): void {
    const entry = this.pending.get(id);
    if (!entry) return;

    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(approved);
  }

  /** Rejects every outstanding prompt. Used when the window goes away. */
  cancelAll(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve(false);
      this.pending.delete(id);
    }
  }

  /** Number of prompts awaiting an answer. */
  pendingCount(): number {
    return this.pending.size;
  }
}
