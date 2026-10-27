'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Cursor crosshair + live coordinate display — the JARVIS HUD signature detail.
 * Hidden until the user actually moves the mouse so it doesn't sit awkwardly
 * at (0,0) on first paint.
 */
export function MouseTrail() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let nextX = 0;
    let nextY = 0;
    const handle = (e: MouseEvent) => {
      nextX = e.clientX;
      nextY = e.clientY;
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setPos({ x: nextX, y: nextY });
      });
    };
    const leave = () => setPos(null);
    window.addEventListener('mousemove', handle, { passive: true });
    window.addEventListener('mouseleave', leave);
    document.addEventListener('mouseleave', leave);
    return () => {
      window.removeEventListener('mousemove', handle);
      window.removeEventListener('mouseleave', leave);
      document.removeEventListener('mouseleave', leave);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  if (!pos) return null;

  const x = pos.x;
  const y = pos.y;
  const xs = String(x).padStart(4, '0');
  const ys = String(y).padStart(4, '0');

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 50,
      }}
    >
      {/* Crosshair */}
      <svg
        width="44"
        height="44"
        style={{
          position: 'absolute',
          left: x - 22,
          top: y - 22,
          mixBlendMode: 'screen',
          filter:
            'drop-shadow(0 0 3px rgba(var(--state-rgb), 0.7)) drop-shadow(0 0 8px rgba(var(--state-rgb), 0.35))',
          opacity: 0.85,
        }}
      >
        {/* outer corner brackets */}
        <path
          d="M 6 6 L 6 12 M 6 6 L 12 6"
          stroke="rgba(var(--state-rgb), 0.7)"
          strokeWidth="1"
          fill="none"
        />
        <path
          d="M 38 6 L 38 12 M 38 6 L 32 6"
          stroke="rgba(var(--state-rgb), 0.7)"
          strokeWidth="1"
          fill="none"
        />
        <path
          d="M 6 38 L 6 32 M 6 38 L 12 38"
          stroke="rgba(var(--state-rgb), 0.7)"
          strokeWidth="1"
          fill="none"
        />
        <path
          d="M 38 38 L 38 32 M 38 38 L 32 38"
          stroke="rgba(var(--state-rgb), 0.7)"
          strokeWidth="1"
          fill="none"
        />
        {/* inner crosshair */}
        <line
          x1="22"
          y1="14"
          x2="22"
          y2="20"
          stroke="var(--state-bright)"
          strokeWidth="1"
        />
        <line
          x1="22"
          y1="24"
          x2="22"
          y2="30"
          stroke="var(--state-bright)"
          strokeWidth="1"
        />
        <line
          x1="14"
          y1="22"
          x2="20"
          y2="22"
          stroke="var(--state-bright)"
          strokeWidth="1"
        />
        <line
          x1="24"
          y1="22"
          x2="30"
          y2="22"
          stroke="var(--state-bright)"
          strokeWidth="1"
        />
        <circle cx="22" cy="22" r="1.5" fill="var(--state-bright)" />
      </svg>

      {/* Coordinate readout */}
      <div
        style={{
          position: 'absolute',
          left: x + 24,
          top: y + 18,
          fontFamily: 'var(--font-jetbrains)',
          fontSize: 9,
          color: 'var(--state-bright)',
          opacity: 0.65,
          letterSpacing: '0.2em',
          textShadow: '0 0 4px rgba(var(--state-rgb), 0.55)',
          whiteSpace: 'nowrap',
          mixBlendMode: 'screen',
        }}
      >
        X:{xs} Y:{ys}
      </div>
    </div>
  );
}
