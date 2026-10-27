'use client';

import type { CSSProperties } from 'react';

type Corner = 'tl' | 'tr' | 'bl' | 'br';

interface CornerBracketProps {
  corner: Corner;
  size?: number;
  stroke?: number;
  color?: string;
  inset?: number;
  active?: boolean;
}

const ORIENT: Record<
  Corner,
  { rotate: number; top?: number; left?: number; right?: number; bottom?: number }
> = {
  tl: { rotate: 0 },
  tr: { rotate: 90 },
  br: { rotate: 180 },
  bl: { rotate: 270 },
};

export function CornerBracket({
  corner,
  size = 40,
  stroke = 2,
  color = 'var(--holo-primary)',
  inset = 16,
  active = false,
}: CornerBracketProps) {
  const orient = ORIENT[corner];

  const positional: CSSProperties = {
    position: 'absolute',
    width: size,
    height: size,
    pointerEvents: 'none',
    zIndex: 30,
    transform: `rotate(${orient.rotate}deg)`,
    transformOrigin: 'center',
    transition:
      'transform 0.45s cubic-bezier(.2,.8,.2,1), filter 0.3s ease',
    filter: active ? 'brightness(1.6)' : 'brightness(1)',
  };

  if (corner === 'tl') {
    positional.top = inset;
    positional.left = inset;
  } else if (corner === 'tr') {
    positional.top = inset;
    positional.right = inset;
  } else if (corner === 'br') {
    positional.bottom = inset;
    positional.right = inset;
  } else {
    positional.bottom = inset;
    positional.left = inset;
  }

  const baseLine: CSSProperties = {
    position: 'absolute',
    background: color,
    boxShadow: `0 0 6px ${color}, 0 0 12px ${color}, 0 0 24px ${color}`,
    transition: 'background 0.5s ease, box-shadow 0.5s ease',
  };

  return (
    <div
      style={positional}
      className="holo-blink"
      aria-hidden
      data-corner={corner}
    >
      {/* horizontal arm (top edge after rotation) */}
      <span
        style={{
          ...baseLine,
          top: 0,
          left: 0,
          width: size,
          height: stroke,
        }}
      />
      {/* vertical arm (left edge after rotation) */}
      <span
        style={{
          ...baseLine,
          top: 0,
          left: 0,
          width: stroke,
          height: size,
        }}
      />
      {/* tiny accent dot at the inner corner */}
      <span
        style={{
          position: 'absolute',
          top: size - 4,
          left: size - 4,
          width: 4,
          height: 4,
          borderRadius: '50%',
          background: color,
          boxShadow: `0 0 8px ${color}, 0 0 16px ${color}`,
          opacity: 0.85,
        }}
        className="holo-pulse"
      />
    </div>
  );
}

export function CornerBrackets({
  active,
  inset,
  size,
  stroke,
  color,
}: {
  active?: boolean;
  inset?: number;
  size?: number;
  stroke?: number;
  color?: string;
}) {
  const corners: Array<'tl' | 'tr' | 'bl' | 'br'> = ['tl', 'tr', 'bl', 'br'];
  return (
    <>
      {corners.map((c) => (
        <CornerBracket
          key={c}
          corner={c}
          active={active}
          inset={inset}
          size={size}
          stroke={stroke}
          color={color}
        />
      ))}
    </>
  );
}
