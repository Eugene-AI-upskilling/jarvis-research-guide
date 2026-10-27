import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { JARVIS_SYSTEM_PROMPT } from '@/lib/ai/system-prompt';
import { ROUTER_TOOLS, type RouterTool } from '@/lib/ai/router-tools';
import { checkOrigin, takeRateLimit } from '@/lib/server/guard';
import { mockRespond } from '@/lib/voice/mock-llm';
import type { ApiResponse, RouterReply } from '@/lib/ai/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_MODEL = 'claude-haiku-4-5';

interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequestBody {
  text: string;
  history?: HistoryEntry[];
}

export async function POST(req: Request) {
  const blocked = checkOrigin(req) ?? takeRateLimit(req);
  if (blocked) return json({ ok: false, error: blocked }, 429);
  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid json body' }, 400);
  }

  const text = (body.text ?? '').toString().trim();
  if (!text) {
    return json({ ok: false, error: 'empty text' }, 400);
  }

  const history = sanitizeHistory(body.history);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const reply = await mockRespond(text);
    return json({
      ok: true,
      reply,
      route: 'mock',
      source: 'mock',
      notice: 'ANTHROPIC_API_KEY 미설정 — mock 응답 사용 중',
    });
  }

  const model = process.env.JARVIS_ROUTER_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 320,
      system: [
        {
          type: 'text',
          text: JARVIS_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: ROUTER_TOOLS.map((tool, i) =>
        i === ROUTER_TOOLS.length - 1
          ? { ...tool, cache_control: { type: 'ephemeral' } }
          : tool,
      ),
      tool_choice: { type: 'auto' },
      messages: [...history, { role: 'user', content: text }],
    });

    const reply = resolveReply(response, text);
    return json({ ok: true, ...reply });
  } catch (err) {
    const detail = describeError(err);
    const reason = describeFailureReason(err);
    const fallback = reason
      ? `죄송합니다 고객님, ${reason} 잠시 기본 모드로 답변드리겠습니다.`
      : await mockRespond(text);
    console.error('[api/chat] Claude API 호출 실패:', detail, err);
    return json({
      ok: true,
      reply: fallback,
      route: 'error',
      source: 'mock',
      notice: `Claude API 호출 실패 (${detail}) — 제한 모드 응답`,
    });
  }
}

function describeFailureReason(err: unknown): string | null {
  if (err instanceof Anthropic.APIError) {
    const message = (err.message ?? '').toLowerCase();
    if (err.status === 401 || message.includes('authentication')) {
      return 'Anthropic API 키 인증에 실패했습니다.';
    }
    if (
      message.includes('credit balance') ||
      message.includes('billing') ||
      message.includes('quota')
    ) {
      return 'Anthropic 크레딧이 부족합니다. 결제 페이지에서 충전이 필요합니다.';
    }
    if (err.status === 429) {
      return 'Anthropic API 요청 한도를 초과했습니다.';
    }
    if (err.status === 404 || message.includes('model')) {
      return '지정된 Claude 모델에 접근할 수 없습니다.';
    }
  }
  return null;
}

function resolveReply(
  response: Anthropic.Message,
  originalText: string,
): RouterReply {
  const textBlocks: string[] = [];
  for (const block of response.content) {
    if (block.type === 'tool_use') {
      const handled = handleTool(block, originalText);
      if (handled) return handled;
    } else if (block.type === 'text' && block.text.trim()) {
      textBlocks.push(block.text.trim());
    }
  }

  // No tool was called — fall back to whatever raw text the model emitted.
  if (textBlocks.length > 0) {
    return {
      reply: textBlocks.join(' '),
      route: 'respond_directly',
      source: 'claude',
    };
  }

  return {
    reply: '죄송합니다 고객님, 응답을 생성하지 못했습니다.',
    route: 'error',
    source: 'error',
  };
}

function handleTool(
  block: Anthropic.ToolUseBlock,
  originalText: string,
): RouterReply | null {
  const name = block.name as RouterTool;
  const input = (block.input ?? {}) as Record<string, unknown>;

  if (name === 'respond_directly') {
    const reply = stringField(input, 'reply', '네 고객님.');
    return {
      reply,
      route: name,
      source: 'claude',
    };
  }

  if (name === 'execute_code_task') {
    const ack = stringField(input, 'ack_reply', '알겠습니다 고객님, 작업을 시작하겠습니다.');
    const workspace = stringField(input, 'workspace', 'sandbox');
    return {
      reply: ack,
      route: name,
      source: 'claude',
      payload: {
        task_summary: stringField(input, 'task_summary', originalText),
        original_request: stringField(input, 'original_request', originalText),
        workspace,
      },
    };
  }

  if (name === 'research_web') {
    const ack = stringField(input, 'ack_reply', '알겠습니다 고객님, 검색을 시작하겠습니다.');
    return {
      reply: ack,
      route: name,
      source: 'claude',
      payload: { query: stringField(input, 'query', originalText) },
    };
  }

  if (name === 'open_webpage') {
    const ack = stringField(input, 'ack_reply', '페이지 열겠습니다, 고객님.');
    const rawUrl = stringField(input, 'url', '');
    const url = normalizeUrl(rawUrl);
    return {
      reply: ack,
      route: name,
      source: 'claude',
      payload: { url },
    };
  }

  if (name === 'local_helper') {
    const action = stringField(input, 'action', 'time') as
      | 'time'
      | 'date'
      | 'calc'
      | 'memo';
    const payload = stringField(input, 'payload', '');
    return runLocalHelper(action, payload);
  }

  return null;
}

function runLocalHelper(
  action: 'time' | 'date' | 'calc' | 'memo',
  payload: string,
): RouterReply {
  if (action === 'time') {
    const d = new Date();
    const hh = d.getHours();
    const mm = d.getMinutes();
    const period = hh < 12 ? '오전' : '오후';
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return {
      reply: `현재 시각은 ${period} ${h12}시 ${mm}분입니다.`,
      route: 'local_helper',
      source: 'local',
      payload: { iso: d.toISOString() },
    };
  }

  if (action === 'date') {
    const d = new Date();
    return {
      reply: `오늘은 ${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일입니다.`,
      route: 'local_helper',
      source: 'local',
    };
  }

  if (action === 'calc') {
    const safe = payload.replace(/[^\d+\-*/().,\s%]/g, '').trim();
    if (!safe) {
      return {
        reply: '죄송합니다 고객님, 계산식을 알아듣지 못했습니다.',
        route: 'local_helper',
        source: 'local',
      };
    }
    try {
      const result = evaluateArithmetic(safe);
      return {
        reply: `${safe} 의 결과는 ${formatNumber(result)} 입니다.`,
        route: 'local_helper',
        source: 'local',
        payload: { expression: safe, result },
      };
    } catch {
      return {
        reply: '죄송합니다 고객님, 계산 중 오류가 발생했습니다.',
        route: 'local_helper',
        source: 'local',
      };
    }
  }

  // memo
  if (!payload) {
    return {
      reply: '저장할 메모 내용이 비어 있습니다.',
      route: 'local_helper',
      source: 'local',
    };
  }
  return {
    reply: `메모를 기록했습니다, 고객님.`,
    route: 'local_helper',
    source: 'local',
    payload: { memo: payload, savedAt: new Date().toISOString() },
    notice: '메모는 임시 메모리에만 저장됨 (Phase 7+에서 영속화 예정)',
  };
}

function evaluateArithmetic(expr: string): number {
  // Whitelist already enforced upstream (digits + + - * / ( ) . , % space).
  // Function constructor is fine here because input is constrained to arithmetic.
  // eslint-disable-next-line no-new-func
  const fn = new Function(`return (${expr.replace(/,/g, '')});`);
  const value = fn();
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('non-finite result');
  }
  return value;
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, '');
}

function stringField(
  obj: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const v = obj[key];
  if (typeof v === 'string' && v.length > 0) return v;
  return fallback;
}

function sanitizeHistory(
  raw: unknown,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as HistoryEntry).content === 'string' &&
      ((item as HistoryEntry).role === 'user' ||
        (item as HistoryEntry).role === 'assistant')
    ) {
      const content = (item as HistoryEntry).content.trim();
      if (content.length > 0) {
        out.push({
          role: (item as HistoryEntry).role,
          content: content.slice(0, 1000),
        });
      }
    }
  }
  // Claude requires alternating user/assistant; collapse runs by keeping the last in each run.
  const compact: typeof out = [];
  for (const m of out) {
    const last = compact[compact.length - 1];
    if (last && last.role === m.role) {
      last.content = m.content;
    } else {
      compact.push(m);
    }
  }
  // Conversation appended below starts with user → history must end with assistant (or be empty).
  while (compact.length > 0 && compact[compact.length - 1]!.role === 'user') {
    compact.pop();
  }
  // Cap to last 6 entries (3 turns) to keep tokens bounded.
  return compact.slice(-6);
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // Already a full URL
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Bare domain → assume https://
  if (/^[\w-]+(\.[\w-]+)+/.test(trimmed)) return `https://${trimmed}`;
  // Otherwise treat as a search-style query — fallback to Google search.
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    return `${err.status ?? '?'} ${err.name}`;
  }
  if (err instanceof Error) {
    return err.message.slice(0, 80);
  }
  return 'unknown';
}

function json(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}
