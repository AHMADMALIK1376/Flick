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
