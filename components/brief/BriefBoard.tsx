'use client';

import { useEffect, useRef } from 'react';
import { useBriefStore } from '@/store/brief-store';
import { BriefCard } from './BriefCard';

/**
 * Free-floating layer of research cards. Mouse / touch handled per card;
 * webcam two-hand zoom arrives as `jarvis:card-zoom` events from HandTracker.
 */
export function BriefBoard() {
  const cards = useBriefStore((s) => s.cards);
  const focusedId = useBriefStore((s) => s.focusedId);
  const faceMode = useBriefStore((s) => s.faceMode);
  const handBase = useRef<{ id: string; scale: number } | null>(null);

  useEffect(() => {
    const onZoom = (e: Event) => {
      const { phase, ratio, at, id } = (e as CustomEvent<{
        phase: 'start' | 'move' | 'end';
        ratio: number;
        at?: { x: number; y: number };
        id?: string;
      }>).detail;
      const s = useBriefStore.getState();
      if (phase === 'end') {
        handBase.current = null;
        return;
      }
      if (phase === 'start' || !handBase.current) {
        // Zoom the big card; otherwise the card between the hands; else the last one.
        const between = at
          ? (document.elementFromPoint(at.x, at.y) as HTMLElement | null)?.closest<HTMLElement>('[data-brief-id]')?.dataset.briefId
          : undefined;
        const targetId = id ?? s.focusedId ?? between ?? s.activeId ?? s.cards[s.cards.length - 1]?.id;
        if (!targetId) return;
        const card = s.cards.find((c) => c.id === targetId);
        handBase.current = { id: targetId, scale: card?.scale ?? 1 };
        s.bringToFront(targetId);
      }
      s.scaleCard(handBase.current.id, handBase.current.scale * ratio);
    };
    const onSwipe = (e: Event) => {
      const { dir } = (e as CustomEvent<{ dir: 'next' | 'prev' }>).detail;
      const s = useBriefStore.getState();
      if (s.cards.length === 0) return;
      const curId = s.focusedId ?? s.activeId;
      const idx = Math.max(0, s.cards.findIndex((c) => c.id === curId));
      const next = s.cards[(idx + (dir === 'next' ? 1 : -1) + s.cards.length) % s.cards.length]!;
      s.focusCard(next.id);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useBriefStore.getState().focusCard(null);
    };
    window.addEventListener('jarvis:card-zoom', onZoom);
    window.addEventListener('jarvis:card-swipe', onSwipe);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('jarvis:card-zoom', onZoom);
      window.removeEventListener('jarvis:card-swipe', onSwipe);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Hands report whether a card is available to zoom, so they skip the HUD zoom.
  useEffect(() => {
    document.documentElement.dataset.briefCards = cards.length > 0 ? '1' : '0';
  }, [cards.length]);

  if (cards.length === 0) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 40, pointerEvents: 'none' }}>
      {focusedId && (
        <div
          data-hand-target
          title="바깥을 누르면 작게 보기"
          onClick={() => useBriefStore.getState().focusCard(null)}
          style={{
            position: 'absolute',
            inset: 0,
            // FACE MODE: barely dim — a dark screen darkens the visitor's hands
            // (the monitor lights them) and the camera loses them.
            background: faceMode
              ? 'rgba(0,8,20,0.18)'
              : 'radial-gradient(ellipse at center, rgba(0,10,25,0.55), rgba(0,5,15,0.85))',
            // Over live video a blur is recomputed every camera frame — skip it in FACE MODE.
            backdropFilter: faceMode ? 'none' : 'blur(3px)',
            pointerEvents: 'auto',
            zIndex: 9999,
          }}
        />
      )}
      {cards.map((c) => (
        <BriefCard key={c.id} card={c} focused={c.id === focusedId} />
      ))}
    </div>
  );
}
