/** Wire-format events that the client consumes via SSE. */
export type CodeStreamEvent =
  | { type: 'started'; workdir: string; workspace: string }
  | { type: 'step'; label: string; tool?: string }
  | { type: 'file'; path: string; action: 'create' | 'edit' | 'read' | 'delete' }
  | { type: 'thought'; text: string }
  | { type: 'shell'; command: string; blocked?: boolean; reason?: string }
  | {
      type: 'code-chunk';
      path: string;
      action: 'write' | 'edit';
      /** Content for Write, new_string for Edit. Truncated to ~2KB. */
      content: string;
      /** Edit-only: what was being replaced. */
      previous?: string;
    }
  | { type: 'result'; ok: boolean; summary: string; raw?: string }
  | { type: 'error'; message: string };

