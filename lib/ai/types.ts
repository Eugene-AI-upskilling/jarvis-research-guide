import type { RouterTool } from './router-tools';

export interface RouterRequest {
  text: string;
}

export interface RouterReply {
  /** Final spoken text to feed into TTS. */
  reply: string;
  /** Which routing branch resolved the turn. */
  route: RouterTool | 'mock' | 'error';
  /** Whether the request hit the real Claude API or fell back. */
  source: 'claude' | 'mock' | 'local' | 'error';
  /** Optional structured data the UI/store can use later (Phase 5/6 wiring). */
  payload?: Record<string, unknown>;
  /** Diagnostic info — never spoken. */
  notice?: string;
}

export type ApiResponse =
  | ({ ok: true } & RouterReply)
  | { ok: false; error: string };
