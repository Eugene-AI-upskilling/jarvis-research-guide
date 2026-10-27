/**
 * Guards for a PUBLIC deployment (embedded on a homepage):
 *  - same-origin only: other websites can't call our API from a browser
 *  - per-visitor rate limit (IP, sliding window)
 *  - daily cap on paid research calls, so a spike can't run up the bill
 *
 * In-memory: limits are per server instance, which is enough to stop abuse
 * on a single Node server; on serverless they are best-effort.
 */

const WINDOW_MS = 10 * 60 * 1000;
const PER_IP = Number(process.env.RATE_LIMIT_PER_10MIN || 20);
const DAILY_CAP = Number(process.env.DAILY_RESEARCH_LIMIT || 500);

const hits = new Map<string, number[]>();
let day = '';
let dayCount = 0;

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'local').trim();
}

/** Browser requests from another site carry a foreign Origin — reject them. */
export function checkOrigin(req: Request): string | null {
  const origin = req.headers.get('origin');
  if (!origin) return null; // same-origin GET / server-to-server
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    if (new URL(origin).host === host) return null;
  } catch {
    /* fall through */
  }
  return '허용되지 않은 사이트에서 온 요청입니다.';
}

/** Counts one call for this visitor; returns an error message when over the limit. */
export function takeRateLimit(req: Request, cost = 1): string | null {
  const ip = clientIp(req);
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length + cost > PER_IP) {
    hits.set(ip, list);
    return '질문이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  }
  for (let i = 0; i < cost; i++) list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) {
    // Keep memory bounded: drop visitors with no recent calls.
    for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  }
  return null;
}

/** Daily budget for paid (non-cached) research. */
export function takeDailyBudget(): string | null {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    dayCount = 0;
  }
  if (dayCount >= DAILY_CAP) return '오늘 준비된 조사 횟수를 모두 사용했습니다. 내일 다시 이용해 주세요.';
  dayCount++;
  return null;
}
