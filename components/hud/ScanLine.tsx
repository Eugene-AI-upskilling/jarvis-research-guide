'use client';

import type { CSSProperties } from 'react';

interface ScanLineProps {
  side: 'left' | 'right';
  width?: number;
  duration?: number;
  delay?: number;
}

export function ScanLine({
  side,
  width = 2,
  duration = 6,
  delay = 0,
}: ScanLineProps) {
  const baseStyle: CSSProperties = {
    position: 'fixed',
    top: 0,
    [side]: 0,
    width,
    height: '24vh',
    pointerEvents: 'none',
    zIndex: 25,
    background: `linear-gradient(
      to bottom,
      transparent 0%,
      rgba(var(--state-rgb), 0.14) 30%,
      rgba(var(--state-rgb), 0.85) 70%,
      var(--state-bright) 95%,
      transparent 100%
    )`,
    boxShadow:
      '0 0 12px rgba(var(--state-rgb), .7), 0 0 28px rgba(var(--state-rgb), .4), 0 0 60px rgba(var(--state-rgb), .2)',
    animation: `holo-scan-y ${duration}s cubic-bezier(.4,0,.6,1) ${delay}s infinite`,
    willChange: 'transform, opacity',
    transition: 'background 0.55s ease, box-shadow 0.55s ease',
  };

  return <div aria-hidden style={baseStyle} />;
}

export function ScanLineEdges() {
  return (
    <>
      <ScanLine side="left" duration={6} delay={0} />
      <ScanLine side="right" duration={6} delay={3} />
    </>
  );
}

export function HorizontalSweep({
  duration = 8,
  opacity = 0.18,
}: {
  duration?: number;
  opacity?: number;
}) {
  const style: CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    pointerEvents: 'none',
    zIndex: 24,
    background: `linear-gradient(
      to right,
      transparent,
      rgba(var(--state-rgb), ${opacity * 2}) 20%,
      var(--state-bright) 50%,
      rgba(var(--state-rgb), ${opacity * 2}) 80%,
      transparent
    )`,
    boxShadow: '0 0 18px rgba(var(--state-rgb), .55)',
    animation: `holo-scan-y ${duration}s linear infinite`,
    willChange: 'transform',
    transition: 'background 0.55s ease, box-shadow 0.55s ease',
  };
  return <div aria-hidden style={style} />;
}
