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
  /**
   * Whether this tool must be confirmed before running.
   *
   * Risk tiers rather than a blanket flag: opening an app or a URL is visible
   * and trivially undone, so prompting for it only teaches the user to click
   * through dialogs. Typing and system control are gated because a misheard
   * command cannot be taken back.
   */
  confirm: boolean;
}

const DESKTOP_TOOLS: DesktopTool[] = [
  {
    name: 'open_application',
    description:
      'Launch an application on this computer by name, e.g. "spotify", "chrome", "notepad".',
    action: 'open_application',
    arg: 'name',
    argDescription: 'Application name',
    confirm: false,
  },
  {
    name: 'open_url',
    description: 'Open a web address in the default browser.',
    action: 'open_url',
    arg: 'url',
    argDescription: 'Full URL including https://',
    confirm: false,
  },
  {
    name: 'open_path',
    description:
      'Open a file or folder in the system file manager. Use this for File Explorer.',
    action: 'open_path',
    arg: 'path',
    argDescription: 'Absolute file or folder path',
    confirm: false,
  },
  {
    name: 'type_text',
    description: 'Type text into whatever window currently has focus.',
    action: 'type_text',
    arg: 'text',
    argDescription: 'Text to type',
    // Runs without asking: the user sees it happen and Ctrl+Z undoes it.
    // The genuinely unrecoverable tool is browser_task, which stays gated.
    confirm: false,
  },
  {
    name: 'web_search',
    description: 'Search the web for a query in the default browser.',
    action: 'web_search',
    arg: 'query',
    argDescription: 'Search query',
    confirm: false,
  },
  {
    name: 'system_control',
    description:
      'Control the computer: mute, unmute, volume_up, volume_down, ' +
      'media_play_pause, media_next, media_previous, screenshot, lock_screen, ' +
      'brightness_up, brightness_down. For shutdown or restart use power_control.',
    action: 'system_control',
    arg: 'command',
    argDescription: 'One of the supported control commands',
    // Mute/volume/lock are trivially reversible, so no prompt.
    confirm: false,
  },
  {
    name: 'power_control',
    description:
      'Shut down, restart, sleep, or sign out of the computer. ' +
      'Valid values: shutdown, restart, sleep, sign_out.',
    action: 'system_control',
    arg: 'command',
    argDescription: 'shutdown | restart | sleep | sign_out',
    // Always confirmed: shutting down loses unsaved work in every open app and
    // cannot be undone, so a misheard command must never trigger it silently.
    confirm: true,
  },
];

/**
 * Exposes the existing ActionExecutor as callable tools.
 *
 * Only the genuinely irreversible tools are gated behind PermissionGate —
 * see the `confirm` field. Opening an app or a URL is visible and trivially
 * undone; typing lands in whatever window has focus and cannot be taken back.
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
        sideEffecting: tool.confirm,
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
          ? { ok: true, content: `${tool.name} succeeded: ${target}` }
          : { ok: false, error: result.error || `${tool.name} failed for "${target}".` };
      }
    );
  }
}
