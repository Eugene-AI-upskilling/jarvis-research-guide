'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { PRESET_GROUPS } from '@/lib/brief/presets';
import { askQuestion } from '@/lib/brief/ask';
import { useBriefStore } from '@/store/brief-store';
import { useJarvisStore } from '@/store/jarvis-store';
import { isEmbedded } from '@/lib/embed';

const panel: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(0,40,80,0.55), rgba(0,16,28,0.45))',
  border: '1px solid rgba(var(--state-rgb),0.4)',
  backdropFilter: 'blur(8px)',
  boxShadow: '0 0 18px rgba(var(--state-rgb),0.15)',
  color: 'var(--holo-text)',
};

/** Left-side menu of visitor questions. One click → JARVIS researches and answers. */
export function QuestionDock() {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (isEmbedded()) setOpen(false);
  }, []);
  const [group, setGroup] = useState(PRESET_GROUPS[0]!.key);
  const busy = useJarvisStore((s) => s.state === 'THINKING');
  // FACE MODE shows the gesture guide underneath — leave it room.
  const faceMode = useBriefStore((s) => s.faceMode);
  const active = PRESET_GROUPS.find((g) => g.key === group) ?? PRESET_GROUPS[0]!;

  if (!open) {
    return (
      <button
        className="holo-btn"
        onClick={() => setOpen(true)}
        style={{ ...panel, position: 'fixed', left: 24, top: 96, zIndex: 35, padding: '14px 10px', writingMode: 'vertical-rl', fontSize: 15, cursor: 'pointer' }}
      >
        질문 메뉴 ▸
      </button>
    );
  }

  return (
    <aside
      style={{
        ...panel,
        position: 'fixed',
        left: 24,
        top: 96,
        bottom: faceMode ? 218 : 150,
        width: 330,
        zIndex: 35,
        padding: '16px 16px 12px',
        display: 'flex',
        flexDirection: 'column',
        animation: 'holo-rise 0.6s ease-out both',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 19, fontWeight: 800, textShadow: 'var(--holo-text-glow)' }}>무엇이 궁금하신가요?</div>
        <button className="holo-btn" onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--holo-text-dim)', fontSize: 16, cursor: 'pointer' }} title="접기">
          ◂
        </button>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {PRESET_GROUPS.map((g) => (
          <button
            key={g.key}
            className="holo-btn"
            onClick={() => setGroup(g.key)}
            style={{
              flex: 1,
              padding: '7px 4px',
              fontSize: 12.5,
              fontWeight: 700,
              cursor: 'pointer',
              background: g.key === group ? 'rgba(var(--state-rgb),0.25)' : 'rgba(0,20,40,0.4)',
              border: `1px solid rgba(var(--state-rgb),${g.key === group ? 0.8 : 0.3})`,
              color: g.key === group ? 'var(--state-bright)' : 'var(--holo-text-dim)',
            }}
          >
            {g.title}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {active.questions.map((q) => (
          <button
            key={q}
            className="holo-btn"
            disabled={busy}
            onClick={() => void askQuestion(q)}
            style={{
              textAlign: 'left',
              padding: '13px 14px',
              fontSize: 16,
              fontWeight: 600,
              lineHeight: 1.35,
              cursor: busy ? 'wait' : 'pointer',
              background: 'rgba(0,30,60,0.5)',
              border: '1px solid rgba(var(--state-rgb),0.35)',
              borderLeft: '3px solid var(--state-bright)',
              color: 'var(--holo-text)',
              opacity: busy ? 0.55 : 1,
            }}
          >
            {q}
          </button>
        ))}
      </div>

      <AskInput busy={busy} />
      <HistoryRow />
    </aside>
  );
}

function AskInput({ busy }: { busy: boolean }) {
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    void askQuestion(text, { withContext: true });
    setText('');
  };
  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 6, marginTop: 12 }}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="직접 입력해서 물어보기"
        style={{
          flex: 1,
          minWidth: 0,
          padding: '10px 12px',
          fontSize: 15,
          background: 'rgba(0,15,30,0.7)',
          border: '1px solid rgba(var(--state-rgb),0.45)',
          color: 'var(--holo-text)',
          outline: 'none',
        }}
      />
      <button
        type="submit"
        className="holo-btn"
        disabled={busy}
        style={{ padding: '0 14px', fontSize: 15, fontWeight: 700, cursor: 'pointer', background: 'rgba(var(--state-rgb),0.25)', border: '1px solid rgba(var(--state-rgb),0.7)', color: 'var(--state-bright)' }}
      >
        질문
      </button>
    </form>
  );
}

/** Small chips of previous answers — tap to bring a card back to the stage. */
function HistoryRow() {
  const cards = useBriefStore((s) => s.cards);
  if (cards.length === 0) return null;
  const { focusCard, clearAll } = useBriefStore.getState();
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--holo-text-dim)', marginBottom: 4 }}>
        <span>지금까지 본 답변 {cards.length}</span>
        <button className="holo-btn" onClick={clearAll} style={{ background: 'none', border: 'none', color: 'var(--holo-text-dim)', fontSize: 11, cursor: 'pointer' }}>
          모두 닫기
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {cards.map((c) => (
          <button
            key={c.id}
            className="holo-btn"
            onClick={() => focusCard(c.id)}
            style={{ padding: '4px 8px', fontSize: 11.5, cursor: 'pointer', background: 'rgba(0,30,60,0.5)', border: '1px solid rgba(var(--state-rgb),0.3)', color: 'var(--holo-text)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={c.question}
          >
            {c.brief?.title ?? c.question}
          </button>
        ))}
      </div>
    </div>
  );
}
