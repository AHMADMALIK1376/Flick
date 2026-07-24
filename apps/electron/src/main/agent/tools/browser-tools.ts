import type { ActionExecutor } from '../action-executor';
import type { ToolRegistry } from './tool-registry';
import type { ToolResult } from './tool-types';

/**
 * Registers the Playwright browser agent as a tool.
 *
 * Gated behind confirmation, unlike opening a URL. The agent drives a
 * persistent browser profile, so it acts as the signed-in user on every site —
 * a misheard instruction could click "Buy", "Send" or "Delete" on an
 * authenticated page. Opening a URL merely shows a page; this operates one.
 *
 * The tool is deliberately described as a last resort: each run is up to 15
 * vision steps, which is slow and costly next to open_url.
 */
export function registerBrowserTools(
  registry: ToolRegistry,
  executor: ActionExecutor
): void {
  registry.register(
    {
      name: 'browser_task',
      description:
        'Control a real web browser to complete a task that needs interaction ' +
        'inside a page — clicking a result, playing a video, filling a form, ' +
        'or reading content off a page. Slow and expensive: prefer open_url or ' +
        'web_search when simply opening a page is enough. Describe the whole ' +
        'goal in one instruction, e.g. "on YouTube, search for the Avengers ' +
        'trailer and play the first result".',
      sideEffecting: true,
      inputSchema: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'The complete goal, in plain English',
          },
        },
        required: ['task'],
      },
    },
    async (args): Promise<ToolResult> => {
      const task = args.task;
      if (typeof task !== 'string' || !task.trim()) {
        return { ok: false, error: 'browser_task requires a "task" argument.' };
      }

      const result = await executor.runBrowserTask(task);

      if (result.status !== 'completed') {
        return {
          ok: false,
          error:
            result.error ??
            `Browser task ${result.status} after ${result.stepsCompleted} step(s).`,
        };
      }

      // Pass back whatever the agent read. Without this the model only learns
      // that something succeeded, which is useless for reading a page.
      const parts = [`Completed in ${result.stepsCompleted} step(s).`];
      if (result.result) {
        parts.push(result.result);
      }
      if (result.structuredData) {
        parts.push(JSON.stringify(result.structuredData));
      }

      return { ok: true, content: parts.join('\n') };
    }
  );
}
