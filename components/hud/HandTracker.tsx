'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

/**
 * "FACE MODE" — Iron Man suit-interior POV. Webcam shows the user blurred
 * and tinted (like looking into the helmet's inner display), with face mesh
 * + hand tracking overlaid. Holographic 4-quadrant HUD stays on top as the
 * suit's display. Two MediaPipe models (HandLandmarker + FaceLandmarker) run
 * on a single shared video stream.
 *
 * Camera is opt-in. When off, both models, the stream, and overlays tear
 * down completely.
 */

type HandLandmark = { x: number; y: number; z: number };
type HandResult = {
  landmarks: HandLandmark[][];
  handedness?: Array<Array<{ categoryName: string; score: number }>>;
};
type HandLandmarker = {
  detectForVideo(video: HTMLVideoElement, ts: number): HandResult;
  close(): void;
};

type FaceLandmark = { x: number; y: number; z: number };
type FaceResult = {
  faceLandmarks: FaceLandmark[][];
};
type FaceLandmarker = {
  detectForVideo(video: HTMLVideoElement, ts: number): FaceResult;
  close(): void;
};

// Filled in once at landmarker init from MediaPipe's static constants.
// Connection[] = Array<{ start: number; end: number }> (~2400 edges for tessellation).
let FACE_TESSELATION: ReadonlyArray<{ start: number; end: number }> | null = null;

const HAND_CONNECTIONS: Array<[number, number]> = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle
  [5, 9], [9, 10], [10, 11], [11, 12],
  // Ring
  [9, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

// MediaPipe Face Mesh — selected contour landmark indices.
// We draw a simplified wireframe (oval, eyes, lips) instead of the full 478-point
// tessellation, which would look too dense over a video feed.
const FACE_OVAL: number[] = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
  400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
  54, 103, 67, 109, 10,
];
const LEFT_EYE: number[] = [
  33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
  33,
];
const RIGHT_EYE: number[] = [
  263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388,
  466, 263,
];
const LIPS_OUTER: number[] = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37,
  39, 40, 185, 61,
];
const LIPS_INNER: number[] = [
  78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82,
  81, 80, 191, 78,
];
// Iris approx (4 points each). FaceLandmarker doesn't always provide refined iris
// without `outputFaceBlendshapes`, but these indices exist in the 478-point set.
const LEFT_IRIS_CENTER = 468;
const RIGHT_IRIS_CENTER = 473;

interface HandTrackerProps {
  enabled: boolean;
  onStatus?: (status: 'loading' | 'ready' | 'error') => void;
}

/**
 * Silence MediaPipe / TFLite informational logs that Next.js's dev overlay
 * surfaces as red "Console Errors" (e.g. "INFO: Created TensorFlow Lite
 * XNNPACK delegate for CPU."). They're harmless WASM stderr lines, but they
 * scare the user. Only filtered in dev; real errors still pass through.
 */
function installMpLogFilter(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (process.env.NODE_ENV === 'production') return () => {};
  const orig = {
    warn: console.warn,
    error: console.error,
    info: console.info,
    log: console.log,
  };
  const isMp = (args: unknown[]): boolean => {
    for (const a of args) {
      if (typeof a !== 'string') continue;
      if (
        /xnnpack|tensorflow lite|tflite|gpu delegate|created tensorflow/i.test(
          a,
        )
      ) {
        return true;
      }
    }
    return false;
  };
  console.warn = ((...args: unknown[]) => {
    if (isMp(args)) return;
    orig.warn(...args);
  }) as typeof console.warn;
  console.error = ((...args: unknown[]) => {
    if (isMp(args)) return;
    orig.error(...args);
  }) as typeof console.error;
  console.info = ((...args: unknown[]) => {
    if (isMp(args)) return;
    orig.info(...args);
  }) as typeof console.info;
  console.log = ((...args: unknown[]) => {
    if (isMp(args)) return;
    orig.log(...args);
  }) as typeof console.log;
  return () => {
    console.warn = orig.warn;
    console.error = orig.error;
    console.info = orig.info;
    console.log = orig.log;
  };
}

export function HandTracker({ enabled, onStatus }: HandTrackerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const faceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );

  // Mute MediaPipe / TFLite informational stderr lines (dev only) for as long
  // as the FACE MODE is active. They'd otherwise show as red console errors.
  useEffect(() => {
    if (!enabled) return;
    const restore = installMpLogFilter();
    return restore;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const reportStatus = (s: 'loading' | 'ready' | 'error') => {
      setStatus(s);
      onStatus?.(s);
    };

    (async () => {
      reportStatus('loading');
      try {
        const mod = await import('@mediapipe/tasks-vision');
        const vision = await mod.FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm',
        );
        const makeHandLandmarker = async (delegate: 'GPU' | 'CPU') =>
          (await mod.HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
              delegate,
            },
            runningMode: 'VIDEO',
            numHands: 2,
            // Looser than the 0.5 defaults — keeps hands locked at booth
            // distance / in dim light instead of flickering in and out.
            minHandDetectionConfidence: 0.35,
            minHandPresenceConfidence: 0.35,
            minTrackingConfidence: 0.35,
          })) as unknown as HandLandmarker;
        const landmarker = await makeHandLandmarker('GPU');
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;

        // Face Landmarker — runs in parallel on the same video stream.
        // ~478 points per face. CPU delegate (XNNPACK) — GPU often fails to
        // initialise here in browsers and falls back anyway, which spams
        // an INFO log Next.js's dev overlay flags as a red error.
        const faceLandmarker = (await mod.FaceLandmarker.createFromOptions(
          vision,
          {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            numFaces: 1,
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: false,
          },
        )) as unknown as FaceLandmarker;
        if (cancelled) {
          faceLandmarker.close();
          landmarker.close();
          return;
        }
        faceLandmarkerRef.current = faceLandmarker;

        // Pull MediaPipe's static landmark connection constants for dense mesh rendering.
        // Cast through unknown — these are static class properties not in the .d.ts surface.
        const FaceLandmarkerStatic = mod.FaceLandmarker as unknown as {
          FACE_LANDMARKS_TESSELATION?: ReadonlyArray<{ start: number; end: number }>;
        };
        if (FaceLandmarkerStatic.FACE_LANDMARKS_TESSELATION) {
          FACE_TESSELATION = FaceLandmarkerStatic.FACE_LANDMARKS_TESSELATION;
        }

        // Get webcam stream
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30 },
            facingMode: 'user',
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        reportStatus('ready');

        // Detection loop — only works on NEW camera frames (rAF runs at 60Hz,
        // the camera at ~30), and the CPU face mesh runs every 3rd frame so it
        // never starves hand tracking.
        let lastVideoTime = -1;
        let lastProcessed = 0;
        let frameNo = 0;
        let failStreak = 0;
        let rebuilding = false;
        const root = document.documentElement;
        let fpsCount = 0;
        let fpsStart = performance.now();
        const loop = () => {
          if (cancelled) return;
          const v = videoRef.current;
          const c = canvasRef.current;
          const fc = faceCanvasRef.current;
          const lm = landmarkerRef.current;
          const flm = faceLandmarkerRef.current;
          // Dev-only: tests inject synthetic landmarks (no webcam needed).
          const sim =
            process.env.NODE_ENV !== 'production'
              ? (window as unknown as { __handSim?: HandResult }).__handSim
              : undefined;
          const nowTs = performance.now();
          // Process new camera frames — and at least every 120ms even if the
          // browser stops advancing currentTime (e.g. video covered by a popup).
          if (v && v.readyState >= 2 && (sim || v.currentTime !== lastVideoTime || nowTs - lastProcessed > 120)) {
            lastVideoTime = v.currentTime;
            lastProcessed = nowTs;
            frameNo++;
            const ts = performance.now();
            if (c && lm) {
              try {
                const result = sim ?? lm.detectForVideo(v, ts);
                failStreak = 0;
                delete root.dataset.handError;
                drawHands(c, result);
                detectGestures(result, c);
                reportHandStatus(result.landmarks?.length ?? 0);
              } catch (err) {
                // Was silently swallowed — show it, and rebuild the model on CPU
                // if the GPU path keeps failing (e.g. WebGL context lost).
                failStreak++;
                root.dataset.handError = err instanceof Error ? err.message.slice(0, 60) : 'detect error';
                if (failStreak > 15 && !rebuilding) {
                  rebuilding = true;
                  root.dataset.handError = '손 인식 다시 시작 중…';
                  void makeHandLandmarker('CPU')
                    .then((fresh) => {
                      if (cancelled) return fresh.close();
                      try {
                        landmarkerRef.current?.close();
                      } catch {
                        /* ignore */
                      }
                      landmarkerRef.current = fresh;
                      failStreak = 0;
                    })
                    .catch(() => {
                      root.dataset.handError = '손 인식을 다시 켜지 못했습니다';
                    })
                    .finally(() => {
                      rebuilding = false;
                    });
                }
              }
            }
            if (fc && flm && frameNo % 3 === 0) {
              try {
                const fr = flm.detectForVideo(v, ts);
                drawFace(fc, fr);
                updateFaceAnchor(fr);
              } catch {
                /* ignore */
              }
            }
            fpsCount++;
            if (ts - fpsStart > 1000) {
              document.documentElement.dataset.handFps = String(Math.round((fpsCount * 1000) / (ts - fpsStart)));
              fpsCount = 0;
              fpsStart = ts;
            }
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        loop();
      } catch (err) {
        if (cancelled) return;
        reportStatus('error');
        // eslint-disable-next-line no-console
        console.error('[HandTracker]', err);
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (landmarkerRef.current) {
        try {
          landmarkerRef.current.close();
        } catch {
          /* ignore */
        }
        landmarkerRef.current = null;
      }
      if (faceLandmarkerRef.current) {
        try {
          faceLandmarkerRef.current.close();
        } catch {
          /* ignore */
        }
        faceLandmarkerRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      for (const c of [canvasRef.current, faceCanvasRef.current]) {
        if (c) {
          const ctx = c.getContext('2d');
          ctx?.clearRect(0, 0, c.width, c.height);
        }
      }
      resetGestures();
      // Reset HUD scale + parallax so disabling hand-track returns layout to neutral
      const root = document.documentElement;
      root.style.setProperty('--hud-scale', '1');
      root.style.setProperty('--mx', '0');
      root.style.setProperty('--my', '0');
      setStatus('idle');
    };
  }, [enabled, onStatus]);

  // Resize both canvases to viewport
  useEffect(() => {
    if (!enabled) return;
    const handleResize = () => {
      for (const c of [canvasRef.current, faceCanvasRef.current]) {
        if (!c) continue;
        c.width = window.innerWidth;
        c.height = window.innerHeight;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [enabled]);

  if (!enabled) return null;

  // Hand canvas sits above the HUD so finger overlays draw on top of panels.
  const handCanvasStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 60,
  };

  // Face mesh canvas sits BELOW the HUD (z=4) — between video (z=3) and HUD (z=5).
  const faceCanvasStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 4,
    mixBlendMode: 'screen',
  };

  return (
    <>
      {/* Webcam feed — fullscreen, mirrored, blurred + tinted (suit-interior look) */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 3,
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: 'scaleX(-1)',
            // Match the film: face stays photographic + readable, just slightly
            // dimmed at the edges so floating HUD widgets pop against it.
            filter: 'brightness(0.82) contrast(1.08) saturate(0.92)',
            opacity: 1,
          }}
        />
      </div>

      {/* Helmet vignette — film keeps the face bright, only edges fall off */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 6,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse 95% 100% at center, transparent 55%, rgba(0,0,0,0.45) 88%, rgba(0,0,0,0.85) 100%)',
        }}
      />

      {/* Top + bottom helmet bezel — thin frame edges only */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          top: 0,
          height: 64,
          zIndex: 7,
          pointerEvents: 'none',
          background:
            'linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 70%, transparent 100%)',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          height: 64,
          zIndex: 7,
          pointerEvents: 'none',
          background:
            'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 70%, transparent 100%)',
        }}
      />

      <canvas ref={faceCanvasRef} style={faceCanvasStyle} />
      <canvas ref={canvasRef} style={handCanvasStyle} />
      {(status === 'loading' || status === 'error') && (
        <div
          style={{
            position: 'fixed',
            top: 80,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 70,
            padding: '6px 14px',
            fontFamily: 'var(--font-jetbrains)',
            fontSize: 11,
            letterSpacing: '0.22em',
            color:
              status === 'error' ? 'var(--holo-red)' : 'var(--state-bright)',
            background: 'rgba(0, 20, 40, 0.6)',
            border: `1px solid rgba(var(--state-rgb), 0.5)`,
            backdropFilter: 'blur(6px)',
            textShadow:
              status === 'error'
                ? '0 0 6px rgba(255,59,59,0.7)'
                : 'var(--holo-text-glow)',
          }}
        >
          {status === 'loading'
            ? '◦ FACE MODE · 모델 로딩 중'
            : '⚠ FACE MODE · 카메라 또는 모델 로드 실패'}
        </div>
      )}
    </>
  );
}

/**
 * Hand gesture engine.
 *
 * One hand:
 *   - Index fingertip = on-screen cursor. Only a box around the visitor's own
 *     body is used (centred on their face, see updateFaceAnchor), so small
 *     movements reach every corner wherever they stand. The cursor is smoothed
 *     (speed-adaptive) and snaps to nearby buttons like a magnet.
 *   - Pinch and release        → click the highlighted button.
 *   - Pinch, hold and move     → drag a card / panel (big cards too).
 *   - Pinch the gold corner handle and pull out / push in → zoom that card.
 *   - Rest near a card's top / bottom edge → its text scrolls.
 *   - Hold still over a button → click after a short ring fills (any pose).
 *   - Open palm swiped sideways → previous / next answer card.
 *
 * Two hands:
 *   - Pinch with both hands, then spread / bring together → zoom the card
 *     between the hands (or the large card). Only answer cards zoom — the
 *     background HUD never scales.
 *
 * Brief tracking dropouts (<300ms) are bridged so drags and zooms don't break.
 */

const BOX_W = 0.5; // fraction of camera frame mapped to the full screen
const BOX_H = 0.46;
const PINCH_ON = 0.36; // thumb–index gap ÷ hand size
const PINCH_OFF = 0.55;
const PRE_PINCH = 0.62; // fingers closing in → freeze the cursor so the click lands
const ZOOM_ON = 0.45;
const ZOOM_OFF = 0.7;
const TAP_MAX_MS = 650;
const TAP_MAX_MOVE = 55;
const DRAG_START_MOVE = 24;
const DWELL_MS = 1100;
const DWELL_RADIUS = 50;
const SNAP_PX = 70;
const LOST_GRACE_MS = 300;
const EDGE_ZONE = 0.26; // top/bottom share of a card's text area that auto-scrolls
const EDGE_MAX_SPEED = 18; // px per frame at the very edge
const SWIPE_DIST = 0.22; // fraction of screen width
const SWIPE_WINDOW_MS = 450;
const SWIPE_COOLDOWN_MS = 900;

type Mode = 'idle' | 'pinch' | 'drag' | 'resize' | 'zoom';

interface GestureState {
  cursor: { x: number; y: number } | null;
  mode: Mode;
  pinchStart: { t: number; x: number; y: number; target: HTMLElement | null } | null;
  dragEl: HTMLElement | null;
  dragStartT: { x: number; y: number };
  dwell: { el: HTMLElement; t: number; x: number; y: number; fired: boolean } | null;
  hoverEl: HTMLElement | null;
  palmTrail: Array<{ t: number; x: number }>;
  lastSwipe: number;
  zoom: { startDist: number; ratio: number } | null;
  lastTwoHands: number;
  lostSince: number | null;
  flash: { text: string; until: number } | null;
  /** After a click, dwell waits until the hand moves away (no double clicks). */
  dwellLock: { x: number; y: number } | null;
  ripples: Array<{ x: number; y: number; t: number }>;
  edge: { rect: DOMRect; dir: -1 | 0 | 1 } | null;
  gap: number;
  resize: { center: { x: number; y: number }; startDist: number; ratio: number } | null;
}

const gs: GestureState = {
  cursor: null,
  mode: 'idle',
  pinchStart: null,
  dragEl: null,
  dragStartT: { x: 0, y: 0 },
  dwell: null,
  hoverEl: null,
  palmTrail: [],
  lastSwipe: 0,
  zoom: null,
  lastTwoHands: 0,
  lostSince: null,
  flash: null,
  dwellLock: null,
  ripples: [],
  edge: null,
  gap: 1,
  resize: null,
};

/** Smoothed face centre in camera space — the control box follows the visitor. */
let faceAnchor: { x: number; y: number } | null = null;

function updateFaceAnchor(fr: FaceResult) {
  const nose = fr.faceLandmarks?.[0]?.[1];
  if (!nose) return;
  if (!faceAnchor) faceAnchor = { x: nose.x, y: nose.y };
  faceAnchor.x += (nose.x - faceAnchor.x) * 0.15;
  faceAnchor.y += (nose.y - faceAnchor.y) * 0.15;
}

function reportHandStatus(n: number) {
  document.documentElement.dataset.handCount = String(n);
}

function resetGestures() {
  endDrag();
  if (gs.zoom) endZoom();
  setHover(null);
  gs.cursor = null;
  gs.mode = 'idle';
  gs.pinchStart = null;
  gs.dwell = null;
  gs.palmTrail = [];
  gs.lostSince = null;
  gs.edge = null;
}

function handSize(h: HandLandmark[]): number {
  const w = h[0]!;
  const m = h[9]!;
  return Math.max(Math.hypot(w.x - m.x, w.y - m.y), 0.02);
}

function pinchGap(h: HandLandmark[]): number {
  const t = h[4]!;
  const i = h[8]!;
  return Math.hypot(t.x - i.x, t.y - i.y) / handSize(h);
}

/** Camera point → screen px through the control box (mirrored). */
function toScreen(p: { x: number; y: number }): { x: number; y: number } {
  // Hands rest a little below the face; box centre sits at chest/shoulder height.
  const cx = clamp(faceAnchor?.x ?? 0.5, BOX_W / 2, 1 - BOX_W / 2);
  const cy = clamp((faceAnchor?.y ?? 0.35) + 0.12, BOX_H / 2, 1 - BOX_H / 2);
  const x0 = cx - BOX_W / 2;
  const y0 = cy - BOX_H / 2;
  const nx = clamp((1 - p.x - (1 - x0 - BOX_W)) / BOX_W, 0, 1);
  const ny = clamp((p.y - y0) / BOX_H, 0, 1);
  return { x: nx * window.innerWidth, y: ny * window.innerHeight };
}

function smooth(target: { x: number; y: number }, frozen: boolean) {
  if (!gs.cursor) {
    gs.cursor = { ...target };
    return gs.cursor;
  }
  const d = Math.hypot(target.x - gs.cursor.x, target.y - gs.cursor.y);
  // Slow movement → heavy smoothing (steady aim); fast movement → follow quickly.
  // While the fingers are closing for a pinch, barely move so the click lands.
  const a = frozen ? 0.05 : clamp(0.28 + d / 200, 0.28, 0.85);
  gs.cursor.x += (target.x - gs.cursor.x) * a;
  gs.cursor.y += (target.y - gs.cursor.y) * a;
  return gs.cursor;
}

function isExtended(h: HandLandmark[], tip: number, mcp: number): boolean {
  const w = h[0]!;
  const t = h[tip]!;
  const m = h[mcp]!;
  return Math.hypot(t.x - w.x, t.y - w.y) > Math.hypot(m.x - w.x, m.y - w.y) * 1.25;
}

function isOpenPalm(h: HandLandmark[]): boolean {
  return isExtended(h, 8, 5) && isExtended(h, 12, 9) && isExtended(h, 16, 13) && isExtended(h, 20, 17);
}

const INTERACTIVE = 'button, a, input, [data-hand-target]';
const SNAPPABLE = 'button:not([disabled]), a[href], input';

function elementAt(x: number, y: number): HTMLElement | null {
  return document.elementFromPoint(x, y) as HTMLElement | null;
}

/** Button under the cursor, or the nearest one within SNAP_PX (magnet). */
function targetAt(x: number, y: number): HTMLElement | null {
  const direct = elementAt(x, y)?.closest<HTMLElement>(INTERACTIVE);
  if (direct && !direct.hasAttribute('data-hand-target')) return direct;
  let best: HTMLElement | null = null;
  let bestD = SNAP_PX;
  const scope: ParentNode = document.querySelector('[data-focused="1"]') ?? document;
  scope.querySelectorAll<HTMLElement>(SNAPPABLE).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      // Only snap to buttons that are actually visible (not under the backdrop).
      const top = elementAt(r.left + r.width / 2, r.top + r.height / 2);
      if (top && (top === el || el.contains(top))) {
        bestD = d;
        best = el;
      }
    }
  });
  return best ?? direct ?? null;
}

function setHover(el: HTMLElement | null) {
  if (gs.hoverEl === el) return;
  gs.hoverEl?.classList.remove('hand-hover');
  gs.hoverEl = el;
  el?.classList.add('hand-hover');
}

function flash(text: string) {
  gs.flash = { text, until: performance.now() + 900 };
}

function clickElement(el: HTMLElement) {
  try {
    if (el instanceof HTMLInputElement) el.focus();
    else el.click();
    const r = el.getBoundingClientRect();
    window.dispatchEvent(
      new CustomEvent('jarvis:pointclick', { detail: { x: r.left + r.width / 2, y: r.top + r.height / 2 } }),
    );
  } catch {
    /* ignore */
  }
  if (gs.cursor) {
    gs.ripples.push({ x: gs.cursor.x, y: gs.cursor.y, t: performance.now() });
    gs.dwellLock = { ...gs.cursor };
  }
}

function emitCardZoom(phase: 'start' | 'move' | 'end', ratio: number, at?: { x: number; y: number }, id?: string) {
  window.dispatchEvent(new CustomEvent('jarvis:card-zoom', { detail: { phase, ratio, at, id } }));
}

function startZoom(dist: number, mid: { x: number; y: number }) {
  endDrag();
  setHover(null);
  gs.mode = 'zoom';
  gs.zoom = { startDist: Math.max(dist, 0.03), ratio: 1 };
  emitCardZoom('start', 1, mid);
}

function moveZoom(dist: number) {
  if (!gs.zoom) return;
  // Light smoothing on the ratio so the card doesn't shimmer.
  const raw = dist / gs.zoom.startDist;
  gs.zoom.ratio += (raw - gs.zoom.ratio) * 0.35;
  emitCardZoom('move', gs.zoom.ratio);
}

function endZoom() {
  emitCardZoom('end', 1);
  gs.zoom = null;
  gs.mode = 'idle';
}

function startDrag(target: HTMLElement | null, x: number, y: number): boolean {
  if (!target) return false;
  // Corner handle → one-hand zoom around the card's centre.
  const handle = target.closest<HTMLElement>('[data-zoom-handle]');
  const handleCard = handle?.closest<HTMLElement>('[data-brief-id]');
  if (handle && handleCard) {
    const r = handleCard.getBoundingClientRect();
    const center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    gs.mode = 'resize';
    gs.resize = { center, startDist: Math.max(Math.hypot(x - center.x, y - center.y), 40), ratio: 1 };
    emitCardZoom('start', 1, center, handle.dataset.zoomHandle);
    return true;
  }
  const el = target.closest<HTMLElement>('[data-suit-draggable]');
  if (!el) return false;
  gs.mode = 'drag';
  gs.dragEl = el;
  gs.dragStartT = {
    x: (parseFloat(el.dataset.suitTx ?? '0') || 0) - x,
    y: (parseFloat(el.dataset.suitTy ?? '0') || 0) - y,
  };
  el.classList.add('suit-grabbed');
  return true;
}

function endDrag() {
  if (gs.resize) {
    emitCardZoom('end', 1);
    gs.resize = null;
  }
  gs.dragEl?.classList.remove('suit-grabbed');
  gs.dragEl = null;
}

function detectGestures(result: HandResult, canvas: HTMLCanvasElement): void {
  const now = performance.now();
  const hands = (result.landmarks ?? []).filter((h) => h && h.length >= 21);

  if (hands.length === 0) {
    // Bridge short tracking dropouts instead of cancelling what the user is doing.
    if (gs.lostSince === null) gs.lostSince = now;
    if (now - gs.lostSince > LOST_GRACE_MS) resetGestures();
    else if (gs.cursor) drawCursor(canvas, gs.cursor, gs.mode, 0);
    return;
  }
  gs.lostSince = null;

  // ─── two hands: both pinching → zoom ───
  if (hands.length >= 2) {
    gs.lastTwoHands = now;
    const [a, b] = hands as [HandLandmark[], HandLandmark[]];
    const pa = pinchGap(a);
    const pb = pinchGap(b);
    const limit = gs.mode === 'zoom' ? ZOOM_OFF : ZOOM_ON;
    const cardsOnScreen = document.documentElement.dataset.briefCards === '1';
    if (cardsOnScreen && pa < limit && pb < limit) {
      const ma = toScreen({ x: (a[4]!.x + a[8]!.x) / 2, y: (a[4]!.y + a[8]!.y) / 2 });
      const mb = toScreen({ x: (b[4]!.x + b[8]!.x) / 2, y: (b[4]!.y + b[8]!.y) / 2 });
      // Measure in camera space so the box stretch doesn't exaggerate.
      const dist = Math.hypot(a[8]!.x - b[8]!.x, a[8]!.y - b[8]!.y);
      if (gs.mode !== 'zoom') startZoom(dist, { x: (ma.x + mb.x) / 2, y: (ma.y + mb.y) / 2 });
      else moveZoom(dist);
      drawZoomGuide(canvas, ma, mb, gs.zoom?.ratio ?? 1);
      return;
    }
  }
  if (gs.mode === 'zoom') {
    // One hand briefly lost mid-zoom — hold the zoom for a moment.
    if (hands.length < 2 && now - gs.lastTwoHands < LOST_GRACE_MS) return;
    endZoom();
  }

  // ─── one hand: cursor + pinch + dwell + swipe ───
  // Follow the hand nearest the current cursor so two visible hands don't fight.
  let hand = hands[0]!;
  if (gs.cursor && hands.length > 1) {
    let best = Infinity;
    for (const h of hands) {
      const s = toScreen(h[8]!);
      const d = Math.hypot(s.x - gs.cursor.x, s.y - gs.cursor.y);
      if (d < best) {
        best = d;
        hand = h;
      }
    }
  }

  const gap = pinchGap(hand);
  gs.gap = gap;
  const cur = smooth(toScreen(hand[8]!), gs.mode === 'idle' && gap < PRE_PINCH);

  if (gs.mode === 'idle' && gap < PINCH_ON) {
    gs.mode = 'pinch';
    gs.pinchStart = { t: now, x: cur.x, y: cur.y, target: gs.hoverEl };
    gs.dwell = null;
  } else if (gs.mode !== 'idle' && gap > PINCH_OFF) {
    // Release: a short, still pinch is a click on the button that was highlighted.
    const ps = gs.pinchStart;
    if (gs.mode === 'pinch' && ps && now - ps.t < TAP_MAX_MS && Math.hypot(cur.x - ps.x, cur.y - ps.y) < TAP_MAX_MOVE) {
      if (ps.target) clickElement(ps.target);
      else window.dispatchEvent(new CustomEvent('jarvis:pinch', { detail: { x: ps.x, y: ps.y } }));
    }
    endDrag();
    gs.mode = 'idle';
    gs.pinchStart = null;
  }

  if (gs.mode === 'pinch' && gs.pinchStart) {
    const moved = Math.hypot(cur.x - gs.pinchStart.x, cur.y - gs.pinchStart.y);
    if (moved > DRAG_START_MOVE || now - gs.pinchStart.t > TAP_MAX_MS) {
      const snapped = gs.pinchStart.target?.closest('[data-zoom-handle]') ? gs.pinchStart.target : null;
      if (!startDrag(snapped ?? elementAt(gs.pinchStart.x, gs.pinchStart.y), gs.pinchStart.x, gs.pinchStart.y)) {
        gs.mode = 'drag'; // nothing to grab — hold quietly until release
      }
    }
  }

  if (gs.mode === 'resize' && gs.resize) {
    const d = Math.hypot(cur.x - gs.resize.center.x, cur.y - gs.resize.center.y);
    gs.resize.ratio += (d / gs.resize.startDist - gs.resize.ratio) * 0.4;
    emitCardZoom('move', gs.resize.ratio);
  } else if (gs.mode === 'drag' && gs.dragEl) {
    const tx = gs.dragStartT.x + cur.x;
    const ty = gs.dragStartT.y + cur.y;
    gs.dragEl.style.translate = `${tx.toFixed(1)}px ${ty.toFixed(1)}px`;
    gs.dragEl.dataset.suitTx = String(tx);
    gs.dragEl.dataset.suitTy = String(ty);
  }

  // Edge auto-scroll: rest the cursor near the top / bottom of a card's text.
  gs.edge = null;
  if (gs.mode === 'idle') {
    const area = elementAt(cur.x, cur.y)
      ?.closest<HTMLElement>('[data-brief-id]')
      ?.querySelector<HTMLElement>('[data-card-scroll]');
    if (area && area.scrollHeight > area.clientHeight + 4) {
      const rect = area.getBoundingClientRect();
      const zone = Math.min(160, rect.height * EDGE_ZONE);
      let dir: -1 | 0 | 1 = 0;
      if (cur.x >= rect.left && cur.x <= rect.right) {
        if (cur.y < rect.top + zone && area.scrollTop > 0) {
          dir = -1;
          area.scrollTop -= EDGE_MAX_SPEED * clamp((rect.top + zone - cur.y) / zone, 0.15, 1);
        } else if (cur.y > rect.bottom - zone && area.scrollTop + area.clientHeight < area.scrollHeight - 1) {
          dir = 1;
          area.scrollTop += EDGE_MAX_SPEED * clamp((cur.y - (rect.bottom - zone)) / zone, 0.15, 1);
        }
      }
      gs.edge = { rect, dir };
    }
  }

  // Highlight (magnet) the button a pinch / dwell would click.
  if (gs.mode === 'idle') setHover(targetAt(cur.x, cur.y));
  else if (gs.mode !== 'pinch') setHover(null);

  // Dwell click — any hand pose, just hold still over a highlighted button.
  let dwellProgress = 0;
  const palm = isOpenPalm(hand);
  if (gs.dwellLock && Math.hypot(cur.x - gs.dwellLock.x, cur.y - gs.dwellLock.y) > DWELL_RADIUS * 1.5) {
    gs.dwellLock = null;
  }
  // The dark backdrop only closes on a deliberate pinch, never by resting on it.
  if (gs.mode === 'idle' && gs.hoverEl && !palm && !gs.dwellLock && !gs.hoverEl.hasAttribute('data-hand-target')) {
    const moved = gs.dwell ? Math.hypot(cur.x - gs.dwell.x, cur.y - gs.dwell.y) : Infinity;
    if (!gs.dwell || gs.dwell.el !== gs.hoverEl || moved > DWELL_RADIUS) {
      gs.dwell = { el: gs.hoverEl, t: now, x: cur.x, y: cur.y, fired: false };
    } else {
      dwellProgress = Math.min(1, (now - gs.dwell.t) / DWELL_MS);
      if (dwellProgress >= 1 && !gs.dwell.fired) {
        gs.dwell.fired = true;
        clickElement(gs.dwell.el);
      }
      if (gs.dwell.fired) dwellProgress = 0;
    }
  } else {
    gs.dwell = null;
  }

  // Open-palm swipe → previous / next card.
  if (gs.mode === 'idle' && palm) {
    gs.palmTrail.push({ t: now, x: cur.x });
    gs.palmTrail = gs.palmTrail.filter((p) => now - p.t < SWIPE_WINDOW_MS);
    const first = gs.palmTrail[0];
    if (first && now - gs.lastSwipe > SWIPE_COOLDOWN_MS) {
      const dx = cur.x - first.x;
      if (Math.abs(dx) > window.innerWidth * SWIPE_DIST) {
        gs.lastSwipe = now;
        gs.palmTrail = [];
        const dir = dx > 0 ? 'next' : 'prev';
        window.dispatchEvent(new CustomEvent('jarvis:card-swipe', { detail: { dir } }));
        flash(dir === 'next' ? '다음 답변 ▶' : '◀ 이전 답변');
      }
    }
  } else {
    gs.palmTrail = [];
  }

  drawCursor(canvas, cur, gs.mode, dwellProgress);
}

/**
 * Cursor: a soft glowing dot inside a ring. The ring tightens as thumb and
 * index close in, so the visitor sees the pinch "loading"; a click leaves a
 * ripple. Over a button the ring turns gold; a dwell fills a gold arc.
 */
function drawCursor(canvas: HTMLCanvasElement, c: { x: number; y: number }, mode: Mode, dwell: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const now = performance.now();
  const grabbing = mode !== 'idle';
  const hovering = !!gs.hoverEl && mode === 'idle';
  const gold = 'rgba(245,197,24,';
  const cyan = 'rgba(140,235,255,';
  const tint = grabbing || hovering ? gold : cyan;
  ctx.save();
  ctx.globalAlpha = 1;

  if (gs.edge) drawEdgeZones(ctx, gs.edge);

  // Click ripples
  gs.ripples = gs.ripples.filter((r) => now - r.t < 450);
  for (const r of gs.ripples) {
    const k = (now - r.t) / 450;
    ctx.strokeStyle = `${gold}${(1 - k).toFixed(2)})`;
    ctx.lineWidth = 3 * (1 - k) + 1;
    ctx.beginPath();
    ctx.arc(r.x, r.y, 14 + k * 34, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Ring radius follows the pinch gap: open hand 24px → fingers together 10px.
  const closing = clamp((gs.gap - PINCH_ON) / (PRE_PINCH + 0.25 - PINCH_ON), 0, 1);
  const ringR = grabbing ? 10 : 10 + closing * 14;
  ctx.shadowColor = `${tint}0.9)`;
  ctx.shadowBlur = 18;
  ctx.fillStyle = `${tint}${grabbing ? 0.35 : 0.12})`;
  ctx.beginPath();
  ctx.arc(c.x, c.y, ringR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `${tint}0.95)`;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.shadowBlur = 8;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.arc(c.x, c.y, 3.5, 0, Math.PI * 2);
  ctx.fill();

  if (dwell > 0) {
    ctx.shadowBlur = 10;
    ctx.strokeStyle = `${gold}1)`;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(c.x, c.y, ringR + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * dwell);
    ctx.stroke();
  }

  const label =
    gs.flash && now < gs.flash.until
      ? gs.flash.text
      : mode === 'resize' && gs.resize
        ? `${gs.resize.ratio >= 1 ? '확대' : '축소'} ${Math.round(gs.resize.ratio * 100)}%`
        : mode === 'drag' && gs.dragEl
          ? '이동'
        : null;
  if (label) drawTag(ctx, label, c.x + 26, c.y - 24);
  ctx.restore();
}

/** Faint up/down bands on a scrollable card; the active one lights up. */
function drawEdgeZones(ctx: CanvasRenderingContext2D, edge: { rect: DOMRect; dir: -1 | 0 | 1 }) {
  const { rect, dir } = edge;
  const zone = Math.min(160, rect.height * EDGE_ZONE);
  const bands: Array<[number, -1 | 1]> = [
    [rect.top, -1],
    [rect.bottom - zone, 1],
  ];
  ctx.save();
  ctx.shadowBlur = 0;
  for (const [y, d] of bands) {
    const active = dir === d;
    const g = ctx.createLinearGradient(0, d === -1 ? y : y + zone, 0, d === -1 ? y + zone : y);
    g.addColorStop(0, `rgba(245,197,24,${active ? 0.28 : 0.08})`);
    g.addColorStop(1, 'rgba(245,197,24,0)');
    ctx.fillStyle = g;
    ctx.fillRect(rect.left, y, rect.width, zone);
    ctx.fillStyle = `rgba(255,230,150,${active ? 0.95 : 0.4})`;
    ctx.font = `700 ${active ? 26 : 20}px Pretendard, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(d === -1 ? '▲' : '▼', rect.left + rect.width / 2, d === -1 ? y + 26 : y + zone - 10);
  }
  ctx.restore();
}

function drawZoomGuide(canvas: HTMLCanvasElement, a: { x: number; y: number }, b: { x: number; y: number }, ratio: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(245,197,24,0.9)';
  ctx.shadowColor = 'rgba(245,197,24,0.9)';
  ctx.shadowBlur = 12;
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const p of [a, b]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
    ctx.stroke();
  }
  drawTag(ctx, `${ratio >= 1 ? '확대' : '축소'} ${Math.round(ratio * 100)}%`, (a.x + b.x) / 2 - 44, (a.y + b.y) / 2 - 28);
  ctx.restore();
}

function drawTag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  ctx.shadowBlur = 0;
  ctx.font = '700 18px Pretendard, system-ui, sans-serif';
  const w = ctx.measureText(text).width + 20;
  ctx.fillStyle = 'rgba(0,20,40,0.88)';
  ctx.fillRect(x, y - 20, w, 30);
  ctx.strokeStyle = 'rgba(102,229,255,0.8)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y - 20, w, 30);
  ctx.fillStyle = 'rgba(220,250,255,1)';
  ctx.fillText(text, x + 10, y + 1);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// Face landmark indices used for head-roll computation.
// 33 = left eye outer corner, 263 = right eye outer corner (mirror-agnostic
// because we use raw .x/.y here, then map both through the same mirror).
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;

function drawFace(canvas: HTMLCanvasElement, result: FaceResult): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!result.faceLandmarks || result.faceLandmarks.length === 0) return;

  const face = result.faceLandmarks[0]!;
  if (!face || face.length < 200) return;

  // ── Bounding box (mirror-applied so it follows the visible face) ──
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < face.length; i++) {
    const x = (1 - face[i]!.x) * w;
    const y = face[i]!.y * h;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // Pad above the head a bit more (hair) than below the chin
  const padX = 28;
  const padTop = 56;
  const padBottom = 28;
  minX -= padX; maxX += padX; minY -= padTop; maxY += padBottom;

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = (maxX - minX) / 2;
  const ry = (maxY - minY) / 2;

  // ── Head-roll angle from the two eye corners (in mirrored screen space) ──
  let roll = 0;
  if (face[LEFT_EYE_OUTER] && face[RIGHT_EYE_OUTER]) {
    const lx = (1 - face[LEFT_EYE_OUTER]!.x) * w;
    const ly = face[LEFT_EYE_OUTER]!.y * h;
    const rxe = (1 - face[RIGHT_EYE_OUTER]!.x) * w;
    const rye = face[RIGHT_EYE_OUTER]!.y * h;
    // After mirror, left eye lands on the right side of the screen, so
    // measuring from one to the other gives the head's actual roll.
    roll = Math.atan2(rye - ly, rxe - lx);
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(roll);

  // ── 1) Main face ellipse (rotated with head) ──
  ctx.strokeStyle = 'rgba(102,229,255,0.95)';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(102,229,255,0.9)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // ── 2) Inner thin guide ellipse — slightly smaller, faint ──
  ctx.strokeStyle = 'rgba(140,220,255,0.32)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx - 8, ry - 8, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();

  // ── 3) Outer rotating "scan ring" — independent slow rotation ──
  const t = performance.now() / 1000;
  const scanAngle = t * 0.35; // ~18s per revolution
  const ringR = Math.max(rx, ry) + 26;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(roll + scanAngle);
  ctx.strokeStyle = 'rgba(140,220,255,0.55)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([14, 8, 4, 8]);
  ctx.shadowColor = 'rgba(140,220,255,0.7)';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.ellipse(0, 0, ringR, ringR * 0.92, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;

  // Bright tick on the scan ring (gives the feeling of a sweep head)
  ctx.fillStyle = 'rgba(200,250,255,1)';
  ctx.shadowColor = 'rgba(180,240,255,0.95)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(ringR, 0, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();

  // ── 4) Corner brackets at the bounding box (axis-aligned, easier to read) ──
  const cornerLen = 22;
  ctx.strokeStyle = 'rgba(102,229,255,0.85)';
  ctx.lineWidth = 1.8;
  ctx.shadowColor = 'rgba(102,229,255,0.7)';
  ctx.shadowBlur = 6;
  ctx.beginPath(); ctx.moveTo(minX, minY + cornerLen); ctx.lineTo(minX, minY); ctx.lineTo(minX + cornerLen, minY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(maxX - cornerLen, minY); ctx.lineTo(maxX, minY); ctx.lineTo(maxX, minY + cornerLen); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(minX, maxY - cornerLen); ctx.lineTo(minX, maxY); ctx.lineTo(minX + cornerLen, maxY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(maxX - cornerLen, maxY); ctx.lineTo(maxX, maxY); ctx.lineTo(maxX, maxY - cornerLen); ctx.stroke();
  ctx.shadowBlur = 0;

  // ── 5) Labels ──
  ctx.fillStyle = 'rgba(102,229,255,0.9)';
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.shadowColor = 'rgba(102,229,255,0.7)';
  ctx.shadowBlur = 4;
  ctx.fillText('GUEST · 인식됨', minX, minY - 8);
  ctx.fillText('J.A.R.V.I.S LINK', minX, minY - 22);
  const rollDeg = ((roll * 180) / Math.PI).toFixed(1);
  const dim = `${Math.round((maxX - minX))} × ${Math.round((maxY - minY))} px · ROLL ${rollDeg}°`;
  ctx.fillText(dim, maxX - ctx.measureText(dim).width, maxY + 14);
  ctx.shadowBlur = 0;

  // ── 6) Tiny iris dots (locked-on pulse) ──
  if (face[LEFT_IRIS_CENTER] && face[RIGHT_IRIS_CENTER]) {
    const tt = (performance.now() / 1000) % 1.6;
    const pulse = 0.55 + 0.45 * Math.sin((tt * Math.PI * 2) / 1.6);
    ctx.shadowBlur = 14 * pulse;
    ctx.shadowColor = 'rgba(180,250,255,1)';
    ctx.fillStyle = `rgba(200,255,255,${0.55 + 0.35 * pulse})`;
    for (const i of [LEFT_IRIS_CENTER, RIGHT_IRIS_CENTER]) {
      const x = (1 - face[i]!.x) * w;
      const y = face[i]!.y * h;
      ctx.beginPath();
      ctx.arc(x, y, 2.5 + pulse, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
}

function drawHands(canvas: HTMLCanvasElement, result: HandResult): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (!result.landmarks || result.landmarks.length === 0) return;
  ctx.globalAlpha = 0.35;

  for (let handIdx = 0; handIdx < result.landmarks.length; handIdx++) {
    const hand = result.landmarks[handIdx]!;
    if (!hand || hand.length === 0) continue;

    const handed = result.handedness?.[handIdx]?.[0];
    const isRight = handed?.categoryName === 'Right';

    // Color: state-driven cyan/state for left, slight gold tint for right
    const hue = isRight ? 'rgba(245,197,24' : 'rgba(0,212,255';

    // Connections
    ctx.strokeStyle = `${hue},0.7)`;
    ctx.lineWidth = 2;
    ctx.shadowColor = `${hue},0.85)`;
    ctx.shadowBlur = 8;
    for (const [a, b] of HAND_CONNECTIONS) {
      const la = hand[a];
      const lb = hand[b];
      if (!la || !lb) continue;
      ctx.beginPath();
      ctx.moveTo((1 - la.x) * w, la.y * h);
      ctx.lineTo((1 - lb.x) * w, lb.y * h);
      ctx.stroke();
    }

    // Landmarks
    ctx.shadowBlur = 12;
    for (let i = 0; i < hand.length; i++) {
      const lm = hand[i]!;
      const x = (1 - lm.x) * w;
      const y = lm.y * h;
      const isFingertip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
      const r = isFingertip ? 4 : 2.5;
      ctx.fillStyle = `${hue},${isFingertip ? 1 : 0.7})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (isFingertip) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;

    // Pinch feedback lives on the cursor (drawCursor), not on the skeleton.
  }
  ctx.globalAlpha = 1;
}
