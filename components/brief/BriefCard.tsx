'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useBriefStore, type BriefCardState } from '@/store/brief-store';
import { refreshCard } from '@/lib/brief/ask';
import { DISCLAIMER } from '@/lib/brief/presets';
import { BriefChart } from './BriefChart';

const LOADING_STEPS = ['질문 분석', '최신 자료 검색', '숫자 확인', '카드 정리'];

export function BriefCard({ card, focused }: { card: BriefCardState; focused: boolean }) {
  const { removeCard } = useBriefStore.getState();
  const faceMode = useBriefStore((s) => s.faceMode);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Zoom and moving are hand-mode gestures (HandTracker). The mouse only reads:
  // wheel scrolls the card content like any page.
  // Entering / leaving the big view drops any hand-drag offset.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.style.translate = '';
    el.dataset.suitTx = '0';
    el.dataset.suitTy = '0';
  }, [focused]);

  const brief = card.brief;
  const width = focused ? 'min(1180px, 90vw)' : 560;

  // Outer box owns position/zoom; inner box owns the look. Kept separate so the
  // materialize animation (which animates transform) can't clobber placement.
  const outer: CSSProperties = {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width,
    transform: `translate(-50%, -50%) translate(${focused ? 0 : card.x}px, ${focused ? 0 : card.y}px) scale(${card.scale})`,
    transformOrigin: 'center center',
    transition: 'transform 0.12s linear, width 0.3s ease',
    zIndex: focused ? 10000 : card.z,
    pointerEvents: 'auto',
  };
  const inner: CSSProperties = {
    maxHeight: focused ? '84vh' : 520,
    display: 'flex',
    flexDirection: 'column',
    padding: focused ? '26px 32px 20px' : '18px 22px 14px',
    fontFamily: '"Pretendard", system-ui, sans-serif',
    color: 'var(--holo-text)',
    // FACE MODE: the video behind changes every frame, so a glass blur would be
    // re-rendered constantly and lag the hand cursor. Solid panel instead.
    ...(faceMode ? { backdropFilter: 'none', WebkitBackdropFilter: 'none', background: 'rgba(0,30,58,0.86)' } : {}),
  };

  return (
    <div
      ref={rootRef}
      data-suit-draggable={`brief-${card.id}`}
      data-brief-id={card.id}
      data-focused={focused ? '1' : '0'}
      className="suit-draggable"
      style={outer}
      onPointerDown={() => useBriefStore.getState().bringToFront(card.id)}
    >
      <div className="holo-panel holo-scanlines holo-card-materialize" style={inner}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, position: 'relative', zIndex: 2 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: focused ? 13 : 11,
              letterSpacing: '0.12em',
              color: 'var(--state-bright)',
              marginBottom: 4,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            Q. {card.question}
          </div>
          <div
            style={{
              fontSize: focused ? 34 : 22,
              fontWeight: 800,
              lineHeight: 1.2,
              textShadow: 'var(--holo-text-glow)',
            }}
          >
            {brief?.title ?? card.preview?.title ?? (card.status === 'failed' ? '자료를 불러오지 못했습니다' : '조사 중…')}
          </div>
        </div>
        <CardButtons card={card} focused={focused} onClose={() => removeCard(card.id)} />
      </div>

      {/* Body */}
      <div
        data-card-scroll
        style={{
          position: 'relative',
          zIndex: 2,
          marginTop: 12,
          overflowY: 'auto',
          scrollbarWidth: 'thin',
          flex: 1,
          minHeight: 0,
        }}
      >
        {card.status === 'loading' && card.preview?.summary && (
          <div
            style={{
              fontSize: focused ? 22 : 16,
              fontWeight: 700,
              padding: '10px 14px',
              marginBottom: 10,
              borderLeft: '3px solid var(--holo-gold)',
              background: 'rgba(245,197,24,0.07)',
              color: '#FFF3C4',
            }}
          >
            {card.preview.summary}
          </div>
        )}
        {card.status === 'loading' && <LoadingBody />}
        {card.status === 'failed' && (
          <div style={{ color: 'var(--holo-red)', fontSize: 14 }}>
            ⚠ {card.error} — ↻ 버튼으로 다시 조사할 수 있습니다.
          </div>
        )}
        {brief && card.status === 'done' && <BriefBody card={card} focused={focused} />}
      </div>

      {/* Footer */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          marginTop: 10,
          paddingTop: 8,
          borderTop: '1px solid rgba(140,220,255,0.18)',
          fontSize: focused ? 11 : 9.5,
          color: 'var(--holo-text-dim)',
          lineHeight: 1.45,
        }}
      >
        {brief && (
          <span style={{ marginRight: 8, color: 'var(--holo-text)' }}>
            자료 기준 {new Date(brief.asOf).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            {brief.cached ? ' · 저장된 답변' : ''}
          </span>
        )}
        {DISCLAIMER}
      </div>
      </div>
      {faceMode && (
        // One-hand zoom: pinch this corner and pull outward / push inward.
        <button
          data-zoom-handle={card.id}
          className="holo-btn"
          title="크기 조절 — 집어서 당기면 확대"
          style={{
            position: 'absolute',
            right: -18,
            bottom: -18,
            width: 56,
            height: 56,
            fontSize: 26,
            lineHeight: 1,
            background: 'rgba(245,197,24,0.18)',
            border: '2px solid rgba(245,197,24,0.85)',
            borderRadius: '50%',
            color: '#FFE08A',
            boxShadow: '0 0 16px rgba(245,197,24,0.5)',
            cursor: 'nwse-resize',
          }}
        >
          ⤡
        </button>
      )}
    </div>
  );
}

function CardButtons({ card, focused, onClose }: { card: BriefCardState; focused: boolean; onClose: () => void }) {
  const { scaleCard, focusCard } = useBriefStore.getState();
  // FACE MODE: bigger hand targets + zoom buttons (zoom is a hand-mode feature;
  // the mouse only reads).
  const faceMode = useBriefStore((s) => s.faceMode);
  const size = faceMode ? 52 : focused ? 40 : 30;
  const btn: CSSProperties = {
    width: size,
    height: size,
    fontSize: faceMode ? 22 : focused ? 18 : 14,
    background: 'rgba(0,30,60,0.55)',
    border: '1px solid rgba(var(--state-rgb),0.5)',
    color: 'var(--state-bright)',
    cursor: 'pointer',
    lineHeight: 1,
  };
  return (
    <div style={{ display: 'flex', gap: faceMode ? 10 : 6, flexShrink: 0 }}>
      {faceMode && (
        <>
          <button className="holo-btn" style={btn} title="축소" onClick={() => scaleCard(card.id, card.scale / 1.25)}>
            −
          </button>
          <button className="holo-btn" style={btn} title="확대" onClick={() => scaleCard(card.id, card.scale * 1.25)}>
            ＋
          </button>
        </>
      )}
      <button
        className="holo-btn"
        style={btn}
        title={focused ? '작게 보기' : '크게 보기'}
        onClick={() => {
          scaleCard(card.id, 1);
          focusCard(focused ? null : card.id);
        }}
      >
        {focused ? '⤡' : '⤢'}
      </button>
      <button
        className="holo-btn"
        style={btn}
        title="최신 자료로 다시 조사"
        disabled={card.status === 'loading'}
        onClick={() => void refreshCard(card.id, card.question)}
      >
        ↻
      </button>
      <button className="holo-btn" style={{ ...btn, borderColor: 'rgba(255,90,90,0.6)', color: '#FF9A9A' }} title="닫기" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

function LoadingBody() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1)), 2600);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: 13, padding: '8px 0 4px' }}>
      {LOADING_STEPS.map((s, i) => (
        <div
          key={s}
          style={{
            opacity: i <= step ? 1 : 0.3,
            color: i === step ? 'var(--state-bright)' : 'var(--holo-text-dim)',
            marginBottom: 6,
          }}
          className={i === step ? 'holo-blink' : undefined}
        >
          {i < step ? '✓' : i === step ? '◉' : '◦'} {s}
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ children, big }: { children: React.ReactNode; big: boolean }) {
  return (
    <div
      style={{
        fontSize: big ? 13 : 10.5,
        letterSpacing: '0.2em',
        color: 'var(--state-bright)',
        margin: big ? '18px 0 8px' : '12px 0 6px',
        textShadow: '0 0 6px rgba(var(--state-rgb), .6)',
      }}
    >
      {children}
    </div>
  );
}

function BriefBody({ card, focused }: { card: BriefCardState; focused: boolean }) {
  const b = card.brief!;
  const big = focused;
  const toneColor = (t?: string) => (t === 'up' ? '#4CE0A0' : t === 'down' ? '#FF6B6B' : 'var(--holo-text)');

  const summary = (
    <div
      style={{
        fontSize: big ? 22 : 16,
        fontWeight: 700,
        lineHeight: 1.45,
        padding: big ? '12px 16px' : '8px 12px',
        borderLeft: '3px solid var(--holo-gold)',
        background: 'rgba(245,197,24,0.07)',
        color: '#FFF3C4',
      }}
    >
      {b.summary}
    </div>
  );

  const stats = b.stats.length > 0 && (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(b.stats.length, big ? 4 : 2)}, 1fr)`, gap: 8 }}>
      {b.stats.map((s, i) => (
        <div
          key={i}
          style={{
            padding: big ? '10px 12px' : '7px 10px',
            border: '1px solid rgba(140,220,255,0.25)',
            background: 'rgba(0,30,60,0.35)',
          }}
        >
          <div style={{ fontSize: big ? 12 : 10, color: 'var(--holo-text-dim)' }}>{s.label}</div>
          <div style={{ fontSize: big ? 20 : 17, fontWeight: 800, fontFamily: '"Pretendard", system-ui, sans-serif', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.value}>
            {s.value}
          </div>
          {s.change && (
            <div style={{ fontSize: big ? 14 : 12, fontWeight: 700, color: toneColor(s.tone) }}>
              {s.tone === 'up' ? '▲ ' : s.tone === 'down' ? '▼ ' : ''}
              {s.change}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  const flow = b.flow.length > 0 && (
    <>
      <SectionTitle big={big}>어떻게 이어지나</SectionTitle>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        {b.flow.map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                padding: big ? '8px 14px' : '5px 10px',
                fontSize: big ? 16 : 13,
                fontWeight: 700,
                border: `1px solid ${i === b.flow.length - 1 ? 'rgba(255,107,107,0.7)' : 'rgba(var(--state-rgb),0.55)'}`,
                background: i === b.flow.length - 1 ? 'rgba(255,107,107,0.12)' : 'rgba(var(--state-rgb),0.1)',
                animation: `holo-rise 0.4s ease-out ${i * 0.18}s both`,
              }}
            >
              {f}
            </span>
            {i < b.flow.length - 1 && <span style={{ color: 'var(--state-bright)', fontSize: big ? 20 : 15 }}>→</span>}
          </div>
        ))}
      </div>
    </>
  );

  const points = b.points.length > 0 && (
    <>
      <SectionTitle big={big}>핵심 정리</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: big ? '1fr 1fr' : '1fr', gap: big ? 10 : 6 }}>
        {b.points.map((p, i) => (
          <div key={i} style={{ fontSize: big ? 16 : 13, lineHeight: 1.5 }}>
            <span style={{ color: 'var(--state-bright)', fontWeight: 800, marginRight: 6 }}>{i + 1}</span>
            <b>{p.head}</b>
            <div style={{ color: 'var(--holo-text-dim)', marginTop: 2, fontSize: big ? 15 : 12.5 }}>{p.body}</div>
          </div>
        ))}
      </div>
    </>
  );

  const checklist = b.checklist.length > 0 && (
    <>
      <SectionTitle big={big}>고객님이 확인해 볼 것</SectionTitle>
      {b.checklist.map((c, i) => (
        <div key={i} style={{ fontSize: big ? 15 : 12.5, marginBottom: 4 }}>
          ☐ {c}
        </div>
      ))}
    </>
  );

  const sources = b.sources.length > 0 && (
    <>
      <SectionTitle big={big}>출처</SectionTitle>
      {b.sources.slice(0, big ? 6 : 3).map((s, i) => (
        <div
          key={i}
          style={{ fontSize: big ? 12 : 10.5, color: 'var(--holo-text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          title={s.url}
        >
          ↗ {s.title}
        </div>
      ))}
    </>
  );

  if (!big) {
    return (
      <>
        {summary}
        {stats && <div style={{ marginTop: 10 }}>{stats}</div>}
        {flow}
        {b.chart && (
          <div style={{ marginTop: 12 }}>
            <BriefChart chart={b.chart} />
          </div>
        )}
        {points}
        {checklist}
        {sources}
      </>
    );
  }

  // Stage layout: two columns, everything large.
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 28 }}>
      <div>
        {summary}
        {flow}
        {points}
      </div>
      <div>
        {stats}
        {b.chart && (
          <div style={{ marginTop: stats ? 16 : 0 }}>
            <BriefChart chart={b.chart} />
          </div>
        )}
        {checklist}
        {sources}
      </div>
    </div>
  );
}
