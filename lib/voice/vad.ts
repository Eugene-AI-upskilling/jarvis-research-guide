'use client';

/**
 * Lightweight RMS-based Voice Activity Detection.
 * Watches mic audio level via Web Audio AnalyserNode and fires onSilence after
 * `silenceMs` of below-threshold RMS — but only once at least one speech burst
 * has been detected (so it doesn't fire immediately on a quiet room).
 *
 * No ML model, no dependencies. Faster + more accurate than a fixed timer at
 * detecting "user actually finished speaking" vs "user paused mid-sentence".
 */

export interface SimpleVADOptions {
  /** RMS threshold above which audio counts as speech. Default 0.012. */
  threshold?: number;
  /** ms of below-threshold RMS after speech before onSilence fires. Default 800. */
  silenceMs?: number;
  /** Fired the first time RMS crosses the threshold during a session. */
  onSpeech?: () => void;
  /** Fired once silenceMs of quiet has elapsed AFTER speech was seen. */
  onSilence?: () => void;
}

export class SimpleVAD {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private rafId: number | null = null;
  private buf: Float32Array | null = null;
  private readonly threshold: number;
  private readonly silenceMs: number;
  private readonly onSpeech?: () => void;
  private readonly onSilence?: () => void;
  private lastSpeechAt = 0;
  private speechSeen = false;
  private running = false;

  constructor(opts: SimpleVADOptions = {}) {
    this.threshold = opts.threshold ?? 0.012;
    this.silenceMs = opts.silenceMs ?? 800;
    this.onSpeech = opts.onSpeech;
    this.onSilence = opts.onSilence;
  }

  start(stream: MediaStream): boolean {
    if (this.running) return true;
    try {
      if (!this.ctx) {
        const Ctor =
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext ?? AudioContext;
        this.ctx = new Ctor();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      this.source = this.ctx.createMediaStreamSource(stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.source.connect(this.analyser);
      this.buf = new Float32Array(this.analyser.fftSize);
      this.lastSpeechAt = Date.now();
      this.speechSeen = false;
      this.running = true;
      this.rafId = requestAnimationFrame(this.tick);
      return true;
    } catch {
      this.stop();
      return false;
    }
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        /* ignore */
      }
      this.source = null;
    }
    this.analyser = null;
    this.buf = null;
    this.running = false;
  }

  private tick = (): void => {
    if (!this.running || !this.analyser || !this.buf) return;
    // The buffer is backed by a plain ArrayBuffer (not Shared) since we created
    // it via `new Float32Array(length)`; cast to satisfy DOM lib typing.
    this.analyser.getFloatTimeDomainData(
      this.buf as Float32Array<ArrayBuffer>,
    );
    let sum = 0;
    const buf = this.buf;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const now = Date.now();
    if (rms > this.threshold) {
      if (!this.speechSeen) this.onSpeech?.();
      this.speechSeen = true;
      this.lastSpeechAt = now;
    } else if (this.speechSeen && now - this.lastSpeechAt > this.silenceMs) {
      // Quiet for long enough after at least one speech burst → done.
      this.running = false;
      this.onSilence?.();
      return;
    }
    this.rafId = requestAnimationFrame(this.tick);
  };
}
