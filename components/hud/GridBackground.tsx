'use client';

import type { CSSProperties } from 'react';

interface GridBackgroundProps {
  cell?: number;
  opacity?: number;
  vignette?: boolean;
}

export function GridBackground({
  cell = 40,
  opacity = 0.05,
  vignette = true,
}: GridBackgroundProps) {
  const lineColor = `rgba(var(--state-rgb), ${opacity})`;
  const subColor = `rgba(var(--state-rgb), ${opacity * 0.6})`;

  const grid: CSSProperties = {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 0,
    backgroundImage: `
      linear-gradient(to right, ${lineColor} 1px, transparent 1px),
      linear-gradient(to bottom, ${lineColor} 1px, transparent 1px),
      linear-gradient(to right, ${subColor} 1px, transparent 1px),
      linear-gradient(to bottom, ${subColor} 1px, transparent 1px)
    `,
    backgroundSize: `
      ${cell * 4}px ${cell * 4}px,
      ${cell * 4}px ${cell * 4}px,
      ${cell}px ${cell}px,
      ${cell}px ${cell}px
    `,
    maskImage: vignette
      ? 'radial-gradient(ellipse at center, black 35%, transparent 95%)'
      : undefined,
    WebkitMaskImage: vignette
      ? 'radial-gradient(ellipse at center, black 35%, transparent 95%)'
      : undefined,
  };

  const radial: CSSProperties = {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 0,
    background:
      'radial-gradient(ellipse at center, rgba(var(--state-rgb), 0.18) 0%, rgba(0,8,20,0) 70%)',
    transition: 'background 0.55s ease',
  };

  const noise: CSSProperties = {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 1,
    opacity: 0.05,
    mixBlendMode: 'overlay',
    backgroundImage: `repeating-linear-gradient(
      0deg,
      transparent 0px,
      rgba(0,212,255,0.7) 1px,
      transparent 2px,
      transparent 3px
    )`,
  };

  return (
    <>
      <div aria-hidden style={radial} />
      <div aria-hidden style={grid} />
      <div aria-hidden style={noise} />
    </>
  );
}
