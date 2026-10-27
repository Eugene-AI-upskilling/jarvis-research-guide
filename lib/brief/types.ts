export type Tone = 'up' | 'down' | 'flat';

export interface BriefStat {
  label: string;
  value: string;
  change?: string;
  tone?: Tone;
}

export interface BriefPoint {
  head: string;
  body: string;
}

export interface BriefChart {
  kind: 'line' | 'bar';
  title: string;
  unit?: string;
  series: Array<{ label: string; value: number }>;
  note?: string;
}

export interface BriefSource {
  title: string;
  url: string;
}

/** Structured research result rendered as a visual card. */
export interface Brief {
  title: string;
  /** 2~3 sentences JARVIS reads aloud. */
  spoken: string;
  /** One-line takeaway shown large at the top of the card. */
  summary: string;
  points: BriefPoint[];
  /** Cause → effect chain, e.g. ["금리 인상", "기업 이자 부담 증가", "이익 감소", "주가 하락"]. */
  flow: string[];
  stats: BriefStat[];
  chart: BriefChart | null;
  /** Things a customer can check themselves. */
  checklist: string[];
  sources: BriefSource[];
  /** When the underlying data was gathered (ISO). */
  asOf: string;
  cached?: boolean;
}

export interface BriefResponse {
  ok: boolean;
  brief?: Brief;
  error?: string;
}
