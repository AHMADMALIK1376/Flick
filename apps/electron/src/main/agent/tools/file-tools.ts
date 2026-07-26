import * as fs from 'fs';
import * as path from 'path';
import { shell } from 'electron';
import { resolveUserPath, sanitizeName } from '../user-paths';
import type { ToolRegistry } from './tool-registry';
import type { ToolResult } from './tool-types';

/**
 * Registers folder/file creation tools.
 *
 * Paths come from the model, so every one goes through resolveUserPath, which
 * confines the result to the user's home directory. Nothing here can write to
 * a system location even if a command is misheard.
 *
 * Creation is not gated behind confirmation: making a folder or a new file is
 * visible and trivially undone. There is deliberately no delete tool — that is
 * the one file operation a misheard command could not be recovered from.
 */
export function registerFileTools(registry: ToolRegistry): void {
  registry.register(
    {
      name: 'create_folder',
      description:
        'Create a folder. Give a location like "desktop/Secret Project", ' +
        '"documents/Reports", or just a name to put it on the desktop. ' +
        'Creates parent folders as needed.',
      sideEffecting: false,
      inputSchema: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'Folder to create, e.g. "desktop/Secret Project"',
          },
        },
        required: ['location'],
      },
    },
    async (args): Promise<ToolResult> => {
      const location = args.location;
      if (typeof location !== 'string' || !location.trim()) {
        return { ok: false, error: 'create_folder needs a "location".' };
      }

      const resolved = resolveUserPath(location);
      if (!resolved.ok) {
        return { ok: false, error: resolved.error };
      }

      try {
        if (fs.existsSync(resolved.path)) {
          return {
            ok: true,
            content: `That folder already exists: ${resolved.path}`,
          };
        }
        fs.mkdirSync(resolved.path, { recursive: true });
        return { ok: true, content: `Created folder ${resolved.path}` };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  registry.register(
    {
      name: 'create_file',
      description:
        'Create a text file with content and save it. Use this to save an ' +
        'essay, letter, or notes to disk instead of typing into a window. ' +
        'Give a location like "desktop/essay.txt".',
      sideEffecting: false,
      inputSchema: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'File to create, e.g. "desktop/cricket-essay.txt"',
          },
          content: { type: 'string', description: 'Text to write into the file' },
          open: {
            type: 'string',
            description: 'Set to "yes" to open the file after saving',
          },
        },
        required: ['location', 'content'],
      },
    },
    async (args): Promise<ToolResult> => {
      const location = args.location;
      const content = args.content;
      if (typeof location !== 'string' || !location.trim()) {
        return { ok: false, error: 'create_file needs a "location".' };
      }
      if (typeof content !== 'string') {
        return { ok: false, error: 'create_file needs "content" text.' };
      }

      const resolved = resolveUserPath(location);
      if (!resolved.ok) {
        return { ok: false, error: resolved.error };
      }

      // A name with forbidden characters would fail cryptically on Windows.
      const dir = path.dirname(resolved.path);
      const base = sanitizeName(path.basename(resolved.path));
      if (!base) {
        return { ok: false, error: `Not a usable file name: "${location}"` };
      }
      const target = path.join(dir, base);

      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(target, content, 'utf8');
        if (String(args.open ?? '').toLowerCase() === 'yes') {
          await shell.openPath(target);
        }
        return {
          ok: true,
          content: `Saved ${content.length} characters to ${target}`,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
}
