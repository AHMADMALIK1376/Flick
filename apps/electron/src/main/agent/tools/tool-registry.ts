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
