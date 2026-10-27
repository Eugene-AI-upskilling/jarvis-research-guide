'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useJarvisStore } from '@/store/jarvis-store';
import { soundEngine } from '@/lib/audio/sound-engine';

const BOOT_LOG_LINES = [
  '> J.A.R.V.I.S. v4.7.0',
  '> initializing holographic kernel...',
  '> mounting GLSL shader pipeline...',
  '> calibrating arc reactor [████████████] 100%',
  '> wake-word engine: ko-KR "자비스" loaded',
  '> voice synthesis: pretendard tts ready',
  '> claude sonnet-4-6 router online',
  '> claude code agent SDK linked',
  '> youtube data api · web_search bound',
  '> all systems nominal.',
  '> good evening, 고객님.',
];

const SYSTEM_CHECKS = [
  'KERNEL',
  'SHADERS',
  'ARC REACTOR',
  'WAKE WORD',
  'STT / TTS',
  'AGENTS',
  'NETWORK',
];

interface BootSequenceProps {
  onComplete?: () => void;
  duration?: number;
}

type Phase = 'init' | 'wire' | 'fill' | 'log' | 'fade' | 'done';

export function BootSequence({
  onComplete,
  duration = 2400,
}: BootSequenceProps) {
  const setStoreState = useJarvisStore((s) => s.setState);
  const [phase, setPhase] = useState<Phase>('init');
  const [logIndex, setLogIndex] = useState(0);
  const [checks, setChecks] = useState<number>(0);
  const t = duration;

  useEffect(() => {
    // Boot SFX synchronized with phases
    soundEngine.startAmbient();
    const sfxStart = window.setTimeout(() => {
      try {
        // sweep up — power-on rumble
        (soundEngine as unknown as { playTaskStart: () => void }).playTaskStart();
      } catch {
        /* ignore */
      }
    }, 50);

    const t0 = window.setTimeout(() => setPhase('wire'), t * 0.08);
    const t1 = window.setTimeout(() => setPhase('fill'), t * 0.32);
    const t2 = window.setTimeout(() => setPhase('log'), t * 0.55);
    const t3 = window.setTimeout(() => setPhase('fade'), t * 1.05);
    const t4 = window.setTimeout(() => {
      setPhase('done');
      setStoreState('STANDBY');
      try {
        soundEngine.playTaskDone();
      } catch {
        /* ignore */
      }
      onComplete?.();
    }, t * 1.42);

    return () => {
      window.clearTimeout(sfxStart);
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
    };
  }, [t, onComplete, setStoreState]);

  // Stream boot log lines
  useEffect(() => {
    if (phase !== 'log') return;
    const interval = window.setInterval(
      () => setLogIndex((i) => (i < BOOT_LOG_LINES.length ? i + 1 : i)),
      (t * 0.55) / BOOT_LOG_LINES.length,
    );
    return () => window.clearInterval(interval);
  }, [phase, t]);

  // Tick system check items as boot progresses
  useEffect(() => {
    if (phase !== 'fill' && phase !== 'log') return;
    const interval = window.setInterval(
      () => setChecks((c) => (c < SYSTEM_CHECKS.length ? c + 1 : c)),
      (t * 0.55) / SYSTEM_CHECKS.length,
    );
    return () => window.clearInterval(interval);
  }, [phase, t]);

  const overlay = useMemo<CSSProperties>(
    () => ({
      position: 'fixed',
      inset: 0,
      zIndex: 100,
      pointerEvents: phase === 'done' ? 'none' : 'auto',
      background:
        'radial-gradient(ellipse at center, rgba(0,20,40,0.96) 0%, rgba(0,8,20,1) 70%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: 28,
      opacity: phase === 'fade' ? 0 : 1,
      transition: 'opacity 0.55s ease-out',
      overflow: 'hidden',
    }),
    [phase],
  );

  if (phase === 'done') return null;

  const showFill = phase === 'fill' || phase === 'log' || phase === 'fade';
  const showLog = phase === 'log' || phase === 'fade';
  const showWire = phase !== 'init';

  return (
    <div aria-hidden style={overlay}>
      {/* Vertical scan beam — sweeps top→bottom during init/wire */}
      {(phase === 'init' || phase === 'wire') && <ScanBeam duration={t * 0.4} />}

      {/* Background grid that draws in during 'wire' */}
      {showWire && <GridBackdrop />}

      {/* Hexadecimal data stream on right edge — for JARVIS authenticity */}
      {showFill && <HexStream />}

      {/* Title */}
      <div
        style={{
          fontFamily: 'var(--font-orbitron)',
          fontWeight: 900,
          letterSpacing: '0.42em',
          fontSize: 28,
          color: 'var(--holo-text)',
          textShadow: 'var(--holo-text-glow)',
          opacity: showFill ? 1 : 0,
          transform: showFill ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 0.6s, transform 0.6s',
        }}
      >
        J.A.R.V.I.S.
      </div>
      <div
        style={{
          fontFamily: 'var(--font-jetbrains)',
          fontSize: 9,
          letterSpacing: '0.32em',
          color: 'var(--holo-text-dim)',
          marginTop: -22,
          opacity: showFill ? 0.9 : 0,
          transition: 'opacity 0.6s 0.1s',
        }}
      >
        v4.7.0 · GUEST MODE
      </div>

      {/* Concentric reactor SVG */}
      <ReactorSvg phase={phase} />

      {/* System checks (left column) and boot log (right column) side-by-side */}
      <div
        style={{
          display: 'flex',
          gap: 36,
          alignItems: 'flex-start',
          marginTop: 8,
          opacity: showFill ? 1 : 0,
          transition: 'opacity 0.5s 0.15s',
        }}
      >
        <SystemChecks completed={checks} />
        {showLog && <BootLog index={logIndex} />}
      </div>
    </div>
  );
}

// ───────── sub-components ─────────

function ScanBeam({ duration }: { duration: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        background:
          'linear-gradient(to right, transparent, rgba(0,212,255,1) 20%, rgba(102,229,255,1) 50%, rgba(0,212,255,1) 80%, transparent)',
        boxShadow:
          '0 0 12px rgba(0,212,255,.9), 0 0 28px rgba(0,212,255,.5)',
        animation: `scan-beam ${duration / 1000}s linear`,
        willChange: 'transform',
        zIndex: 1,
      }}
    />
  );
}

function GridBackdrop() {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        backgroundImage:
          'linear-gradient(to right, rgba(0,212,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,212,255,0.06) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
        maskImage:
          'radial-gradient(ellipse at center, black 30%, transparent 80%)',
        WebkitMaskImage:
          'radial-gradient(ellipse at center, black 30%, transparent 80%)',
        animation: 'boot-grid-in 0.6s ease-out',
        opacity: 0.7,
        zIndex: 0,
      }}
    />
  );
}

function HexStream() {
  const lines = useMemo(() => {
    const arr: string[] = [];
    for (let i = 0; i < 18; i++) {
      let line = '';
      for (let j = 0; j < 8; j++) {
        line +=
          Math.floor(Math.random() * 16).toString(16).toUpperCase() +
          Math.floor(Math.random() * 16).toString(16).toUpperCase() +
          ' ';
      }
      arr.push(line);
    }
    return arr;
  }, []);
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        top: 32,
        right: 32,
        fontFamily: 'var(--font-jetbrains)',
        fontSize: 10,
        lineHeight: 1.3,
        letterSpacing: '0.05em',
        color: 'rgba(0,212,255,0.45)',
        textShadow: '0 0 4px rgba(0,212,255,0.4)',
        opacity: 0.5,
        zIndex: 0,
      }}
    >
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}

function ReactorSvg({ phase }: { phase: Phase }) {
  const showFill = phase === 'fill' || phase === 'log' || phase === 'fade';
  return (
    <svg
      width="240"
      height="240"
      viewBox="0 0 240 240"
      style={{
        filter:
          'drop-shadow(0 0 8px rgba(0,212,255,.9)) drop-shadow(0 0 20px rgba(0,212,255,.5))',
        zIndex: 2,
      }}
    >
      <defs>
        <linearGradient id="bootStroke" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#66E5FF" />
          <stop offset="1" stopColor="#00D4FF" />
        </linearGradient>
      </defs>

      {/* outer wire square */}
      <rect
        x="20"
        y="20"
        width="200"
        height="200"
        fill="none"
        stroke="url(#bootStroke)"
        strokeWidth="1.5"
        strokeDasharray="800"
        strokeDashoffset={phase === 'init' ? 800 : 0}
        style={{ transition: 'stroke-dashoffset 0.5s linear' }}
      />

      {/* inner cross + diagonals */}
      <line
        x1="20"
        y1="120"
        x2="220"
        y2="120"
        stroke="rgba(0,212,255,.45)"
        strokeWidth="1"
        opacity={showFill ? 1 : 0}
        style={{ transition: 'opacity 0.4s' }}
      />
      <line
        x1="120"
        y1="20"
        x2="120"
        y2="220"
        stroke="rgba(0,212,255,.45)"
        strokeWidth="1"
        opacity={showFill ? 1 : 0}
        style={{ transition: 'opacity 0.4s' }}
      />
      <line
        x1="20"
        y1="20"
        x2="220"
        y2="220"
        stroke="rgba(0,212,255,.22)"
        strokeWidth="1"
        opacity={showFill ? 1 : 0}
        style={{ transition: 'opacity 0.5s 0.1s' }}
      />
      <line
        x1="220"
        y1="20"
        x2="20"
        y2="220"
        stroke="rgba(0,212,255,.22)"
        strokeWidth="1"
        opacity={showFill ? 1 : 0}
        style={{ transition: 'opacity 0.5s 0.1s' }}
      />

      {/* fill region */}
      <rect
        x="40"
        y="40"
        width="160"
        height="160"
        fill="rgba(0,212,255,.06)"
        stroke="rgba(0,212,255,.55)"
        strokeWidth="1"
        opacity={showFill ? 1 : 0}
        style={{ transition: 'opacity 0.6s ease-out' }}
      />

      {/* concentric rings — appear after fill */}
      {[80, 60, 40].map((r, i) => (
        <circle
          key={i}
          cx="120"
          cy="120"
          r={r}
          fill="none"
          stroke="rgba(0,212,255,.4)"
          strokeWidth="1"
          opacity={showFill ? 1 : 0}
          style={{ transition: `opacity 0.4s ${0.15 + i * 0.1}s` }}
        />
      ))}

      {/* center reactor pulse */}
      <circle
        cx="120"
        cy="120"
        r="14"
        fill="rgba(102,229,255,.9)"
        opacity={showFill ? 1 : 0}
        style={{ transition: 'opacity 0.4s 0.2s' }}
      >
        <animate
          attributeName="r"
          values="10;20;10"
          dur="1.4s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values="0.5;1;0.5"
          dur="1.4s"
          repeatCount="indefinite"
        />
      </circle>

      {/* corner dots on the wire square */}
      {[
        [20, 20],
        [220, 20],
        [20, 220],
        [220, 220],
      ].map(([cx, cy], i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r="3"
          fill="#66E5FF"
          opacity={showFill ? 1 : 0}
          style={{ transition: `opacity 0.3s ${i * 0.08}s` }}
        />
      ))}
    </svg>
  );
}

function SystemChecks({ completed }: { completed: number }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-jetbrains)',
        fontSize: 11,
        lineHeight: 1.7,
        color: 'var(--holo-text-dim)',
        minWidth: 170,
        textAlign: 'left',
      }}
    >
      <div
        style={{
          fontSize: 9,
          letterSpacing: '0.35em',
          color: 'var(--holo-primary)',
          marginBottom: 6,
        }}
      >
        SYSTEM · CHECK
      </div>
      {SYSTEM_CHECKS.map((label, i) => {
        const ok = i < completed;
        return (
          <div
            key={label}
            style={{
              display: 'flex',
              gap: 8,
              opacity: ok ? 1 : 0.35,
              color: ok ? 'var(--holo-text)' : 'var(--holo-text-dim)',
              transition: 'opacity 0.3s, color 0.3s',
            }}
          >
            <span
              style={{
                width: 12,
                color: ok ? 'var(--holo-primary)' : 'var(--holo-text-dim)',
              }}
            >
              {ok ? '✓' : '◦'}
            </span>
            <span>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function BootLog({ index }: { index: number }) {
  return (
    <div
      style={{
        width: 460,
        maxWidth: '60vw',
        minHeight: 180,
        fontFamily: 'var(--font-jetbrains)',
        fontSize: 12,
        lineHeight: 1.5,
        color: 'var(--holo-text-dim)',
        textAlign: 'left',
        padding: '12px 16px',
        background: 'rgba(0, 20, 40, 0.5)',
        border: '1px solid var(--holo-line)',
        backdropFilter: 'blur(6px)',
        boxShadow: 'var(--holo-glow-2)',
      }}
    >
      <div
        style={{
          fontSize: 9,
          letterSpacing: '0.35em',
          color: 'var(--holo-primary)',
          marginBottom: 6,
        }}
      >
        BOOT · LOG
      </div>
      {BOOT_LOG_LINES.slice(0, index).map((line, i) => (
        <div
          key={i}
          style={{
            opacity: 0,
            animation: 'holo-rise 0.3s ease-out forwards',
          }}
        >
          {line}
        </div>
      ))}
      {index < BOOT_LOG_LINES.length && (
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 14,
            background: 'var(--holo-primary)',
            boxShadow: '0 0 8px var(--holo-primary)',
            animation: 'holo-pulse 0.8s ease-in-out infinite',
            verticalAlign: 'text-bottom',
          }}
        />
      )}
    </div>
  );
}
