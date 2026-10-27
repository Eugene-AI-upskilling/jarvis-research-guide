'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { GridBackground } from '@/components/hud/GridBackground';
import { ScanLineEdges, HorizontalSweep } from '@/components/hud/ScanLine';
import { CornerBrackets } from '@/components/hud/CornerBracket';
import { BootSequence } from '@/components/hud/BootSequence';
import { MouseTrail } from '@/components/hud/MouseTrail';
import { HandTracker } from '@/components/hud/HandTracker';
import { BriefBoard } from '@/components/brief/BriefBoard';
import { QuestionDock } from '@/components/brief/QuestionDock';
import { GestureGuide } from '@/components/brief/GestureGuide';
import { useBriefStore } from '@/store/brief-store';
import { ORG_NAME } from '@/lib/brief/presets';
import { askQuestion } from '@/lib/brief/ask';
import { closeEmbed, useEmbed } from '@/lib/embed';
import { VoiceController } from '@/components/voice/VoiceController';
import { useJarvisStore, type JarvisState } from '@/store/jarvis-store';

const HoloCore = dynamic(
  () => import('@/components/core/HoloCore').then((m) => m.HoloCore),
  { ssr: false },
);

interface StateTheme {
  primary: string;
  bright: string;
  rgb: string;
  label: string;
  pulse: number;
  breath: number;
  glitch: boolean;
  description: string;
}

const STATE_THEMES: Record<JarvisState, StateTheme> = {
  BOOTING: {
    primary: '#00D4FF',
    bright: '#66E5FF',
    rgb: '0,212,255',
    label: 'BOOTING',
    pulse: 1.4,
    breath: 4,
    glitch: false,
    description: 'initializing',
  },
  STANDBY: {
    primary: '#00D4FF',
    bright: '#66E5FF',
    rgb: '0,212,255',
    label: 'STANDBY',
    pulse: 2.4,
    breath: 4,
    glitch: false,
    description: 'awaiting wake word',
  },
  LISTENING: {
    primary: '#00E0FF',
    bright: '#A8F2FF',
    rgb: '0,224,255',
    label: 'LISTENING',
    pulse: 0.9,
    breath: 1.6,
    glitch: false,
    description: 'recording · transcribing',
  },
  THINKING: {
    primary: '#FF8C1A',
    bright: '#FFB870',
    rgb: '255,140,26',
    label: 'THINKING',
    pulse: 1.6,
    breath: 2.2,
    glitch: false,
    description: 'routing · sonnet-4-6',
  },
  SPEAKING: {
    primary: '#22DD77',
    bright: '#88FFB0',
    rgb: '34,221,119',
    label: 'SPEAKING',
    pulse: 0.6,
    breath: 1.2,
    glitch: false,
    description: 'synthesizing voice',
  },
  ERROR: {
    primary: '#FF3B3B',
    bright: '#FF8080',
    rgb: '255,59,59',
    label: 'ERROR',
    pulse: 0.4,
    breath: 1,
    glitch: true,
    description: 'fault detected',
  },
};

export default function HudPage() {
  const state = useJarvisStore((s) => s.state);
  const theme = STATE_THEMES[state];
  const { embed, question: embedQuestion } = useEmbed();

  // Popup mode: no boot show, answer the card's question right away, and let
  // the host page send further questions into the same popup.
  useEffect(() => {
    if (!embed) return;
    useJarvisStore.getState().setState('STANDBY');
    if (embedQuestion) void askQuestion(embedQuestion);
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; question?: unknown } | null;
      if (d?.type === 'jarvis:ask' && typeof d.question === 'string') void askQuestion(d.question);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [embed, embedQuestion]);
  const [now, setNow] = useState<Date | null>(null);
  const [glitchKey, setGlitchKey] = useState(0);
  const [handTrackEnabled, setHandTrackEnabled] = useState(false);

  useEffect(() => {
    useBriefStore.getState().setFaceMode(handTrackEnabled);
    document.documentElement.dataset.faceMode = handTrackEnabled ? '1' : '0';
  }, [handTrackEnabled]);

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (state === 'BOOTING') return;
    setGlitchKey((k) => k + 1);
  }, [state]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--state-rgb', theme.rgb);
    root.style.setProperty('--state-primary', theme.primary);
    root.style.setProperty('--state-bright', theme.bright);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    let raf = 0;
    const handle = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth) * 2 - 1;
      const y = (e.clientY / window.innerHeight) * 2 - 1;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        root.style.setProperty('--mx', x.toFixed(3));
        root.style.setProperty('--my', y.toFixed(3));
      });
    };
    window.addEventListener('mousemove', handle, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handle);
      cancelAnimationFrame(raf);
    };
  }, []);

  const formattedDate = now
    ? `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`
    : '----.--.--';
  const formattedTime = now
    ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    : '--:--:--';

  return (
    <main
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        perspective: 1200,
        animation: theme.glitch ? 'holo-rgb-shift 0.6s linear infinite' : undefined,
      }}
    >
      {/* Background layers */}
      <GridBackground />

      {/* State-driven viewport tint — covers full screen, falls off at edges */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 2,
          transition: 'background 0.55s ease',
          background: `
            radial-gradient(ellipse at center, rgba(${theme.rgb},0.16) 0%, rgba(${theme.rgb},0.05) 50%, rgba(${theme.rgb},0) 90%),
            linear-gradient(180deg, rgba(${theme.rgb},0.04) 0%, transparent 25%, transparent 75%, rgba(${theme.rgb},0.04) 100%)
          `,
          mixBlendMode: 'screen',
        }}
      />

      {/* Transition glitch — fires for ~0.25s on every state change */}
      <TransitionGlitch glitchKey={glitchKey} rgb={theme.rgb} />

      {/* Edge scan effects */}
      <ScanLineEdges />
      <HorizontalSweep />

      {/* Cursor crosshair + live coordinates */}
      <MouseTrail />

      {/* Webcam hand tracking overlay (opt-in) */}
      <HandTracker enabled={handTrackEnabled} />

      {/* Hand-track toggle — outside zoom wrapper so it stays clickable at fixed position */}
      <button
        onClick={() => setHandTrackEnabled((v) => !v)}
        className="holo-btn"
        style={{
          position: 'absolute',
          top: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 30,
          padding: '6px 14px',
          background: handTrackEnabled
            ? 'rgba(var(--state-rgb), 0.18)'
            : 'rgba(0,20,40,0.5)',
          border: `1px solid rgba(var(--state-rgb), ${
            handTrackEnabled ? 0.7 : 0.4
          })`,
          color: 'var(--state-bright)',
          fontFamily: 'var(--font-jetbrains)',
          fontSize: 10,
          letterSpacing: '0.28em',
          backdropFilter: 'blur(6px)',
          textShadow: '0 0 4px rgba(var(--state-rgb), .55)',
          boxShadow: handTrackEnabled
            ? '0 0 12px rgba(var(--state-rgb), 0.5)'
            : 'none',
        }}
        title="웹캠으로 얼굴 + 손 인식 (아이언맨 수트 내부 시점)"
      >
        {handTrackEnabled ? 'FACE MODE · ON' : 'FACE MODE · OFF'}
      </button>

      {/* HUD foreground wrapper — two-hand gesture scales this, NOT the bg layers */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          transform: 'scale(var(--hud-scale, 1))',
          transformOrigin: 'center center',
          transition: 'transform 0.2s cubic-bezier(.2,.8,.2,1)',
          zIndex: 5,
        }}
      >
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}>
      {/* 4 corner brackets */}
      <CornerBrackets
        active={state !== 'STANDBY'}
        inset={20}
        size={48}
        color={theme.primary}
      />

      {/* Brand */}
      <div
        style={{
          position: 'absolute',
          top: 34,
          left: 64,
          zIndex: 10,
          fontFamily: '"Pretendard", system-ui, sans-serif',
          color: 'var(--holo-text)',
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '0.04em', textShadow: 'var(--holo-text-glow)' }}>
          {ORG_NAME}
        </div>
        <div style={{ fontSize: 11, letterSpacing: '0.32em', color: 'var(--state-bright)', fontFamily: 'var(--font-orbitron)' }}>
          AI RESEARCH GUIDE · J.A.R.V.I.S
        </div>
      </div>

      <Quadrant pos="tr" align="right">
        <PanelTitle>CHRONO · SEOUL</PanelTitle>
        <div
          style={{
            fontFamily: 'var(--font-orbitron)',
            fontWeight: 700,
            fontSize: 28,
            letterSpacing: '0.18em',
            color: 'var(--holo-text)',
            textShadow: 'var(--holo-text-glow)',
          }}
          className="holo-breath holo-rgb-shift-tiny"
        >
          {formattedTime}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--holo-text-dim)',
            letterSpacing: '0.22em',
            marginTop: 2,
          }}
        >
          {formattedDate} · KST
        </div>
      </Quadrant>

      <Quadrant pos="br" align="left">
        <PanelTitle>대화 기록</PanelTitle>
        <TranscriptPanel />
      </Quadrant>

      {/* 3D Arc Reactor — hidden in FACE MODE so it doesn't cover the user's face */}
      {!handTrackEnabled && <CoreSlot theme={theme} state={state} />}
        </div>
      </div>

      {/* Voice loop controller (Phase 3) — no DOM, must stay outside zoom */}
      <VoiceController />

      {/* Visitor question menu + research cards */}
      <QuestionDock />
      <GestureGuide />
      <BriefBoard />

      {/* Boot sequence overlay — full-screen, must stay outside zoom */}
      {state === 'BOOTING' && !embed && <BootSequence />}

      {embed && (
        <button
          className="holo-btn"
          onClick={closeEmbed}
          title="닫기"
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            zIndex: 20000,
            padding: '10px 18px',
            fontSize: 16,
            fontWeight: 700,
            fontFamily: '"Pretendard", system-ui, sans-serif',
            background: 'rgba(0,20,40,0.85)',
            border: '1px solid rgba(var(--state-rgb),0.7)',
            color: 'var(--state-bright)',
            cursor: 'pointer',
          }}
        >
          ✕ 닫기
        </button>
      )}

      {/* ERROR state — full-screen glitch overlay */}
      {state === 'ERROR' && <ErrorOverlay />}
    </main>
  );
}

const QUADRANT_TILT: Record<'tl' | 'tr' | 'bl' | 'br', { rx: number; ry: number; dx: number; dy: number; floatDelay: number }> = {
  tl: { rx: -1, ry: -1, dx: -1, dy: -1, floatDelay: 0 },
  tr: { rx: -1, ry: 1, dx: 1, dy: -1, floatDelay: 0.6 },
  bl: { rx: 1, ry: -1, dx: -1, dy: 1, floatDelay: 1.2 },
  br: { rx: 1, ry: 1, dx: 1, dy: 1, floatDelay: 1.8 },
};

function Quadrant({
  pos,
  align = 'left',
  children,
}: {
  pos: 'tl' | 'tr' | 'bl' | 'br';
  align?: 'left' | 'right';
  children: React.ReactNode;
}) {
  const offset = 64;
  const w = 280;
  const tilt = QUADRANT_TILT[pos];

  const positional: React.CSSProperties = {
    position: 'absolute',
    width: w,
    zIndex: 10,
    animation: 'holo-rise 0.7s ease-out 0.2s both',
    perspective: 1100,
  };
  if (pos === 'tl') {
    positional.top = offset;
    positional.left = offset;
  } else if (pos === 'tr') {
    positional.top = offset;
    positional.right = offset;
  } else if (pos === 'bl') {
    positional.bottom = offset;
    positional.left = offset;
  } else {
    positional.bottom = offset;
    positional.right = offset;
  }

  const floater: React.CSSProperties = {
    animation: `holo-float-z 4.2s ease-in-out ${tilt.floatDelay}s infinite`,
    transformStyle: 'preserve-3d',
  };

  const panelTransform =
    `rotateY(calc(var(--mx, 0) * 5deg)) ` +
    `rotateX(calc(var(--my, 0) * -4deg)) ` +
    `translate3d(calc(var(--mx, 0) * ${tilt.dx * 6}px), calc(var(--my, 0) * ${tilt.dy * 6}px), 0)`;

  return (
    <div style={positional}>
      <div style={floater}>
        <section
          className="holo-panel holo-scanlines holo-inner-grid"
          style={{
            padding: '14px 18px',
            fontFamily: 'var(--font-rajdhani)',
            color: 'var(--holo-text)',
            textAlign: align,
            transform: panelTransform,
            transformStyle: 'preserve-3d',
            transformOrigin: 'center',
            transition: 'transform 0.18s cubic-bezier(.2,.8,.2,1)',
            willChange: 'transform',
          }}
        >
          <div style={{ position: 'relative', zIndex: 2 }}>{children}</div>
        </section>
      </div>
    </div>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="holo-rgb-shift-tiny"
      style={{
        fontFamily: 'var(--font-orbitron)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.32em',
        color: 'var(--state-bright)',
        textShadow:
          '0 0 6px rgba(var(--state-rgb), .8), 0 0 14px rgba(var(--state-rgb), .45)',
        marginBottom: 8,
        opacity: 0.95,
        transition: 'color 0.55s ease, text-shadow 0.55s ease',
      }}
    >
      {children}
    </div>
  );
}

function CoreSlot({
  theme,
  state,
}: {
  theme: StateTheme;
  state: JarvisState;
}) {
  const { primary, bright, rgb, label, description } = theme;
  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 520,
        height: 520,
        zIndex: 5,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          filter: `drop-shadow(0 0 14px rgba(${rgb},0.45))`,
        }}
      >
        <HoloCore color={primary} state={state} />
      </div>

      {/* faint enclosing dashed circle (a "containment field" cue) */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 24,
          borderRadius: '50%',
          border: `1px dashed rgba(${rgb},0.18)`,
          boxShadow: `inset 0 0 60px rgba(${rgb},0.05)`,
          transition: 'border-color 0.55s ease, box-shadow 0.55s ease',
        }}
      />

      {/* state label below */}
      <div
        style={{
          position: 'absolute',
          bottom: -10,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-orbitron)',
            fontSize: 16,
            fontWeight: 900,
            letterSpacing: '0.4em',
            color: bright,
            textShadow: `0 0 8px rgba(${rgb},0.95), 0 0 18px rgba(${rgb},0.6), 0 0 36px rgba(${rgb},0.3)`,
            transition: 'color 0.55s ease, text-shadow 0.55s ease',
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-jetbrains)',
            fontSize: 10,
            letterSpacing: '0.22em',
            color: 'var(--holo-text-dim)',
            opacity: 0.75,
          }}
        >
          ◦ {description}
        </div>
      </div>
    </div>
  );
}

function useTypewriter(text: string, msPerChar = 22): {
  shown: string;
  done: boolean;
} {
  const [shown, setShown] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!text) {
      setShown('');
      setDone(true);
      return;
    }
    setShown('');
    setDone(false);
    let i = 0;
    const id = window.setInterval(() => {
      i++;
      if (i >= text.length) {
        setShown(text);
        setDone(true);
        window.clearInterval(id);
      } else {
        setShown(text.slice(0, i));
      }
    }, msPerChar);
    return () => window.clearInterval(id);
  }, [text, msPerChar]);
  return { shown, done };
}

function TranscriptLine({
  text,
  isJarvis,
  animated,
}: {
  text: string;
  isJarvis: boolean;
  animated: boolean;
}) {
  // Only the most recent JARVIS line types out — older entries render full.
  const { shown, done } = useTypewriter(animated ? text : '', 22);
  const display = animated ? shown : text;
  return (
    <div
      style={{
        marginTop: 4,
        opacity: 0,
        animation: 'holo-rise 0.4s ease-out forwards',
        color: isJarvis ? 'var(--state-bright)' : 'var(--holo-text)',
        textShadow: isJarvis ? '0 0 6px rgba(var(--state-rgb), .6)' : 'none',
      }}
      className={animated && !done ? 'holo-cursor' : undefined}
    >
      <span
        style={{
          fontSize: 9,
          letterSpacing: '0.18em',
          color: 'var(--holo-text-dim)',
          marginRight: 6,
        }}
      >
        {isJarvis ? 'J ›' : 'U ›'}
      </span>
      {display}
    </div>
  );
}

function TranscriptPanel() {
  const transcript = useJarvisStore((s) => s.transcript);
  const recent = transcript.slice(-6);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Latest JARVIS entry typewrites; older ones render fully.
  const lastJarvisIdx = (() => {
    for (let i = recent.length - 1; i >= 0; i--) {
      if (recent[i]!.speaker === 'jarvis') return i;
    }
    return -1;
  })();
  // Auto-scroll to the latest line on (a) new entries and (b) in-flight
  // typewriter growth of the last entry. ResizeObserver catches the typewriter
  // size growth (each line's height expands as chars stream in); MutationObserver
  // catches when new TranscriptLine children get appended.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const pin = () => {
      el.scrollTop = el.scrollHeight;
    };
    const ro = new ResizeObserver(pin);
    Array.from(el.children).forEach((child) => ro.observe(child));
    const mo = new MutationObserver(() => {
      pin();
      Array.from(el.children).forEach((child) => ro.observe(child));
    });
    mo.observe(el, { childList: true });
    pin();
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
  return (
    <div
      ref={scrollRef}
      className="holo-transcript-scroll"
      style={{
        fontFamily: 'var(--font-jetbrains)',
        fontSize: 12,
        color: 'var(--holo-text-dim)',
        letterSpacing: '0.04em',
        minHeight: 60,
        maxHeight: 200,
        overflowY: 'auto',
        scrollbarWidth: 'none',
      }}
    >
      {recent.length === 0 ? (
        <>
          <div style={{ opacity: 0.45 }}>
            ◦ 왼쪽 질문을 누르거나 &quot;자비스&quot;라고 불러 주세요
          </div>
          <div style={{ opacity: 0.3, marginTop: 4 }}>
            ◦ vad: idle · stt: warm · tts: ready
          </div>
        </>
      ) : (
        recent.map((entry, i) => (
          <TranscriptLine
            key={entry.id}
            text={entry.text}
            isJarvis={entry.speaker === 'jarvis'}
            animated={i === lastJarvisIdx}
          />
        ))
      )}
    </div>
  );
}

function ErrorOverlay() {
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 80,
      }}
    >
      {/* base red wash */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at center, rgba(255,59,59,0.18) 0%, rgba(255,59,59,0.04) 60%, transparent 90%)',
          mixBlendMode: 'screen',
          animation: 'holo-pulse 0.6s ease-in-out infinite',
        }}
      />
      {/* horizontal scanlines, denser + redder */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'repeating-linear-gradient(0deg, transparent 0px, rgba(255,59,59,0.07) 1px, transparent 2px, transparent 3px)',
          mixBlendMode: 'overlay',
        }}
      />
      {/* tear bands */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '38%',
          height: 14,
          background:
            'linear-gradient(to bottom, transparent, rgba(255,59,59,0.35), transparent)',
          animation: 'error-shake 0.4s linear infinite',
        }}
      />
      {/* center alert text */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          fontFamily: 'var(--font-orbitron)',
          fontSize: 14,
          fontWeight: 900,
          letterSpacing: '0.6em',
          color: '#FF8080',
          textShadow:
            '0 0 8px rgba(255,59,59,0.95), 0 0 18px rgba(255,59,59,0.6)',
          animation: 'holo-pulse 0.6s ease-in-out infinite',
        }}
        className="holo-error-shake"
      >
        ◤ FAULT ◢
      </div>
    </div>
  );
}

function TransitionGlitch({
  glitchKey,
  rgb,
}: {
  glitchKey: number;
  rgb: string;
}) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (glitchKey === 0) return;
    setActive(true);
    const t = window.setTimeout(() => setActive(false), 280);
    return () => window.clearTimeout(t);
  }, [glitchKey]);

  if (!active) return null;
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 90,
        background: `linear-gradient(
          90deg,
          rgba(${rgb},0.08) 0%,
          rgba(255,255,255,0.05) 50%,
          rgba(${rgb},0.08) 100%
        )`,
        boxShadow: `inset 0 0 120px rgba(${rgb},0.25)`,
        animation: 'holo-glitch-flash 0.28s linear forwards',
      }}
    />
  );
}
