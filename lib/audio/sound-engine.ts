'use client';

/**
 * Synthesized ambient hum + UI SFX. All tones are generated at runtime via
 * Web Audio API — no audio files to load, no licensing, no extra weight.
 *
 * Volumes are intentionally low (~3-6%) so it sits underneath voice/TTS
 * without becoming distracting. The ambient hum ducks during TTS playback.
 */

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  // Ambient hum components — kept as members so we can mute/duck cleanly
  private humSource: AudioBufferSourceNode | null = null;
  private humGain: GainNode | null = null;
  private humVolume = 0.04;

  /** Lazy-init AudioContext. Must be called from a user gesture (button click). */
  private ensureContext(): boolean {
    if (this.ctx) return true;
    try {
      const Ctx =
        (window.AudioContext as typeof AudioContext | undefined) ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return false;
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1;
      this.masterGain.connect(this.ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  /** Start the always-on ambient electric-circuit hum. Idempotent. */
  startAmbient(): void {
    if (!this.ensureContext() || !this.ctx || !this.masterGain) return;
    if (this.humSource) return;

    const ctx = this.ctx;
    const sampleRate = ctx.sampleRate;
    const duration = 4;
    const buf = ctx.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buf.getChannelData(0);
    // Pink-ish noise: white noise + simple low-pass average
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      last = last * 0.96 + w * 0.04;
      data[i] = last * 6;
    }

    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.loop = true;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 220;
    lowpass.Q.value = 0.7;

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 60;

    const gain = ctx.createGain();
    gain.gain.value = this.humVolume;

    // Slow LFO modulation on volume — gives a "breathing" electrical feel
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = this.humVolume * 0.4;
    lfo.connect(lfoGain).connect(gain.gain);
    lfo.start();

    source.connect(lowpass).connect(highpass).connect(gain).connect(this.masterGain);
    source.start();

    this.humSource = source;
    this.humGain = gain;
  }

  stopAmbient(): void {
    if (this.humSource) {
      try {
        this.humSource.stop();
      } catch {
        /* ignore */
      }
      this.humSource = null;
      this.humGain = null;
    }
  }

  /** Lower the hum volume during TTS so JARVIS's voice sits cleanly on top. */
  duckAmbient(factor = 0.25, ms = 150): void {
    if (!this.humGain || !this.ctx) return;
    const t = this.ctx.currentTime;
    const target = this.humVolume * factor;
    this.humGain.gain.cancelScheduledValues(t);
    this.humGain.gain.setValueAtTime(this.humGain.gain.value, t);
    this.humGain.gain.linearRampToValueAtTime(target, t + ms / 1000);
  }

  unduckAmbient(ms = 350): void {
    if (!this.humGain || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.humGain.gain.cancelScheduledValues(t);
    this.humGain.gain.setValueAtTime(this.humGain.gain.value, t);
    this.humGain.gain.linearRampToValueAtTime(this.humVolume, t + ms / 1000);
  }

  // ──────────── SFX library ────────────

  /** "tink" — wake word recognized. */
  playWake(): void {
    this.tone(880, 0.07, 'sine', 0.07);
    setTimeout(() => this.tone(1320, 0.05, 'sine', 0.05), 70);
  }

  /** Soft "blip" — listening session ended without command. */
  playListenEnd(): void {
    this.tone(520, 0.07, 'sine', 0.04);
  }

  /** Sweep up — task started (code/research). */
  playTaskStart(): void {
    this.sweep(220, 760, 0.32, 0.05, 'sine');
  }

  /** Bell-like — task completed successfully. */
  playTaskDone(): void {
    this.tone(660, 0.09, 'triangle', 0.06);
    setTimeout(() => this.tone(990, 0.18, 'triangle', 0.05), 80);
  }

  /** Two-beat warning — error. */
  playError(): void {
    this.tone(220, 0.13, 'square', 0.05);
    setTimeout(() => this.tone(180, 0.13, 'square', 0.05), 180);
  }

  /** Card materialize — short holographic flicker. */
  playCardIn(): void {
    this.sweep(1200, 600, 0.18, 0.04, 'sine');
  }

  // ──────────── primitives ────────────

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
  ): void {
    if (!this.ensureContext() || !this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.012);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
    osc.connect(g).connect(this.masterGain);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.05);
  }

  private sweep(
    fromHz: number,
    toHz: number,
    dur: number,
    vol: number,
    type: OscillatorType = 'sine',
  ): void {
    if (!this.ensureContext() || !this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(toHz, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.02);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
    osc.connect(g).connect(this.masterGain);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.05);
  }
}

export const soundEngine = new SoundEngine();
