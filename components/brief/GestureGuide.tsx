'use client';

import { useEffect, useState } from 'react';
import { useBriefStore } from '@/store/brief-store';

const GESTURES: Array<[string, string]> = [
  ['☝️ 손 올리기', '노란 테두리 버튼에 1초 = 클릭'],
  ['👌 집었다 바로 놓기', '바로 클릭'],
  ['👌 집은 채로 움직이기', '자료 카드 옮기기'],
  ['☝️ 카드 위·아래 끝에 손', '내용 위아래로 넘기기'],
  ['👌 금색 모서리 ⤡ 집고 당기기', '한 손 확대 · 밀면 축소'],
  ['🙌 두 손 집고 벌리기', '자료 확대 · 오므리면 축소'],
  ['🖐️ 손바닥 좌우로 휘젓기', '이전 · 다음 답변'],
];

/** FACE MODE cheat-sheet + live tracking status, bottom-left under the question menu. */
export function GestureGuide() {
  const faceMode = useBriefStore((s) => s.faceMode);
  const [status, setStatus] = useState({ hands: 0, fps: 0, error: '' });

  useEffect(() => {
    if (!faceMode) return;
    const id = window.setInterval(() => {
      const d = document.documentElement.dataset;
      setStatus({ hands: Number(d.handCount ?? 0), fps: Number(d.handFps ?? 0), error: d.handError ?? '' });
    }, 300);
    return () => window.clearInterval(id);
  }, [faceMode]);

  if (!faceMode) return null;
  const slow = status.fps > 0 && status.fps < 15;
  return (
    <div
      style={{
        position: 'fixed',
        left: 24,
        bottom: 20,
        width: 330,
        zIndex: 70,
        padding: '8px 12px',
        background: 'rgba(0,16,30,0.75)',
        border: '1px solid rgba(var(--state-rgb),0.35)',
        backdropFilter: 'blur(6px)',
        fontFamily: '"Pretendard", system-ui, sans-serif',
        color: 'var(--holo-text)',
        pointerEvents: 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, marginBottom: 2 }}>
        <span style={{ color: status.hands > 0 ? '#4CE0A0' : '#FF9A9A' }}>
          {status.hands > 0 ? `● 손 ${status.hands}개 인식 중` : '○ 손이 안 보여요 · 손바닥을 보여 주세요'}
        </span>
        {status.fps > 0 && <span style={{ color: slow ? '#FFB870' : 'var(--holo-text-dim)' }}>{status.fps}fps</span>}
      </div>
      {status.error && (
        <div style={{ fontSize: 11.5, color: '#FF9A9A', fontWeight: 700, marginBottom: 2 }}>⚠ {status.error}</div>
      )}
      {GESTURES.map(([g, what]) => (
        <div key={g} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, lineHeight: 1.6 }}>
          <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{g}</span>
          <span style={{ color: 'var(--holo-text-dim)', textAlign: 'right' }}>{what}</span>
        </div>
      ))}
    </div>
  );
}
