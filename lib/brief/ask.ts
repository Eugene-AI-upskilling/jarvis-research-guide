import { useBriefStore } from '@/store/brief-store';
import { useJarvisStore } from '@/store/jarvis-store';
import { soundEngine } from '@/lib/audio/sound-engine';
import { TTSEngine } from '@/lib/voice/tts';
import type { Brief } from './types';

/** Speaks text; resolves false if the visitor cut JARVIS off mid-sentence. */
type Speaker = (text: string, opts: { final: boolean }) => Promise<boolean>;

let voiceSpeaker: Speaker | null = null;
let fallbackTts: TTSEngine | null = null;

/** VoiceController registers itself while the mic loop is active so answers are
 *  spoken through the interruptible, echo-aware path. */
export function registerSpeaker(fn: Speaker | null) {
  voiceSpeaker = fn;
}

/**
 * One conversation turn at a time. A new question (or the visitor cutting in)
 * bumps the turn, and anything still pending from the old turn goes quiet.
 */
let turn = 0;
export function cancelTurn() {
  turn++;
}

async function speak(text: string, final: boolean): Promise<boolean> {
  // The mic loop is switched on by the first tap — give it a moment to come up
  // so even the first answer can be interrupted by voice.
  for (let i = 0; i < 25 && !voiceSpeaker; i++) await new Promise((r) => setTimeout(r, 100));
  if (voiceSpeaker) return voiceSpeaker(text, { final });
  if (!fallbackTts) fallbackTts = new TTSEngine();
  const { setState } = useJarvisStore.getState();
  setState('SPEAKING');
  try {
    await fallbackTts.speak(text);
  } catch {
    /* audio blocked (no user gesture yet) — the card still shows the answer */
  } finally {
    setState(final ? 'STANDBY' : 'THINKING');
  }
  return true;
}

/** Last few turns, so follow-ups like "그럼 삼성전자는?" make sense. */
export function recentContext(): string[] {
  return useJarvisStore
    .getState()
    .transcript.slice(-5, -1)
    .map((t) => `${t.speaker === 'user' ? '고객' : '자비스'}: ${t.text}`);
}

type Preview = { spoken?: string; title?: string; summary?: string };

/**
 * Stream a brief into a card. `onSpoken` fires as soon as the answer sentence
 * exists — usually seconds before the chart and sources are finished.
 */
export async function loadBrief(
  cardId: string,
  question: string,
  opts: { fresh?: boolean; context?: string[]; onSpoken?: (spoken: string) => void } = {},
): Promise<Brief | null> {
  const store = useBriefStore.getState();
  let spokenSent = false;
  try {
    const res = await fetch('/api/brief', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, fresh: opts.fresh, context: opts.context }),
    });
    if (!res.body) throw new Error('응답이 비어 있습니다.');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let brief: Brief | null = null;
    let error: string | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line) as
          | { type: 'preview'; preview: Preview }
          | { type: 'brief'; brief: Brief }
          | { type: 'error'; error: string }
          | { ok: false; error: string };
        if ('type' in ev && ev.type === 'preview') {
          store.previewCard(cardId, { title: ev.preview.title, summary: ev.preview.summary });
          if (ev.preview.spoken && !spokenSent) {
            spokenSent = true;
            opts.onSpoken?.(ev.preview.spoken);
          }
        } else if ('type' in ev && ev.type === 'brief') {
          brief = ev.brief;
        } else {
          error = ev.error;
        }
      }
      if (done) break;
    }
    if (!brief) throw new Error(error ?? '조사에 실패했습니다.');
    store.resolveCard(cardId, brief);
    if (!spokenSent) opts.onSpoken?.(brief.spoken);
    return brief;
  } catch (err) {
    store.failCard(cardId, err instanceof Error ? err.message : '통신 오류');
    return null;
  }
}

const ACKS = ['네, 바로 찾아볼게요.', '잠시만요, 확인해 볼게요.', '네, 알아볼게요.'];

/**
 * One question → one turn: open a big card, say a short "on it" only if the
 * answer isn't instant, speak the answer the moment it exists, keep listening.
 *
 * `fromVoice`: the user's words are already in the transcript and the mic loop
 * is running. `ack`: a ready-made acknowledgement (voice router) to say first.
 */
export async function askQuestion(
  question: string,
  opts: { fresh?: boolean; withContext?: boolean; fromVoice?: boolean; ack?: string } = {},
): Promise<void> {
  const q = question.trim();
  if (!q) return;
  const my = ++turn;
  const live = () => my === turn;
  const jarvis = useJarvisStore.getState();
  if (!opts.fromVoice) {
    window.dispatchEvent(new Event('jarvis:ensure-voice'));
    jarvis.pushTranscript({ speaker: 'user', text: q });
  }
  const context = opts.withContext ? recentContext() : undefined;
  const id = useBriefStore.getState().addCard(q);
  jarvis.setState('THINKING');

  let resolveSpoken!: (s: string | null) => void;
  const spokenReady = new Promise<string | null>((r) => (resolveSpoken = r));
  const pending = loadBrief(id, q, { fresh: opts.fresh, context, onSpoken: (s) => resolveSpoken(s) });
  void pending.then((b) => {
    if (!b) resolveSpoken(null);
  });

  // Quick answers (~2–3s) need no "on it" — only say one if it's taking longer.
  const quick = await Promise.race([spokenReady, new Promise<'slow'>((r) => setTimeout(() => r('slow'), 1200))]);
  if (!live()) return;
  if (quick === 'slow') {
    const ack = opts.ack ?? ACKS[Math.floor(Math.random() * ACKS.length)]!;
    jarvis.pushTranscript({ speaker: 'jarvis', text: ack });
    if (!(await speak(ack, false))) return; // visitor started talking — let them
    if (!live()) return;
    useJarvisStore.getState().setState('THINKING');
  }

  const spoken = await spokenReady;
  if (!live()) return;
  if (!spoken) {
    soundEngine.playError();
    const msg = '죄송합니다 고객님, 지금은 자료를 불러오지 못했어요. 다시 한번 물어봐 주시겠어요?';
    jarvis.pushTranscript({ speaker: 'jarvis', text: msg });
    await speak(msg, true);
    return;
  }
  jarvis.pushTranscript({ speaker: 'jarvis', text: spoken });
  await speak(spoken, true);
}

/** Re-run research for a card that already exists (refresh button). */
export async function refreshCard(cardId: string, question: string) {
  const my = ++turn;
  useBriefStore.getState().restartCard(cardId);
  let said = false;
  await loadBrief(cardId, question, {
    fresh: true,
    onSpoken: (s) => {
      if (said || my !== turn) return;
      said = true;
      void speak(s, true);
    },
  });
}
