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
          ? { ok: true, content: `${tool.name} succeeded: ${target}` }
          : { ok: false, error: result.error || `${tool.name} failed for "${target}".` };
      }
    );
  }
}
