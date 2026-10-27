import {
  getSpeechRecognitionCtor,
  type SpeechRecognitionLike,
  type SRResultEvent,
  type SRErrorEvent,
} from './types';
import { CommandRecorder } from './command-recorder';
import { isWhisperReady, transcribe } from './whisper';
import { SimpleVAD } from './vad';

export type VoiceMode = 'idle' | 'wake' | 'command' | 'output';

const WAKE_WORDS = [
  '자비스',
  '자비스야',
  '자비스가',
  '자비스님',
  '재비스',
  '쟈비스',
  '자비쓰',
  '자아비스',
  '져비스',
  '자비수',
  'jarvis',
];

// Stop / interrupt words — explicit barge-in triggers during TTS.
// Kept short and distinctive so TTS audio bleed-through doesn't false-trigger.
const STOP_WORDS = ['그만', '잠깐', '잠시', '정지', '멈춰', '스톱', 'stop', 'wait'];

// Time windows — user-tuned values
const INITIAL_SILENCE_MS = 3000;        // after wake — wait for user to start speaking
const FOLLOWUP_SILENCE_MS = 7000;       // after JARVIS replies — dialog stays open this long
const END_OF_SPEECH_SILENCE_MS = 1300;  // SR-text-based fallback timer (used if VAD misses)
const VAD_SILENCE_MS = 850;             // VAD-based "they paused" — a short thinking pause doesn't end the turn
const COMMAND_HARD_TIMEOUT_MS = 20000;

export interface VoiceEngineEvents {
  onWake: () => void;
  onPartialCommand: (text: string) => void;
  onFinalCommand: (text: string) => void;
  /** Fires when the user starts speaking while JARVIS is in 'output' mode (TTS playing). */
  onInterrupt: (partial: string) => void;
  onModeChange: (mode: VoiceMode) => void;
  onError: (message: string, fatal: boolean) => void;
  /** Fires once when the SpeechRecognition is actually capturing audio (mic warm). */
  onReady?: () => void;
}

export class VoiceEngine {
  private recognizer: SpeechRecognitionLike | null = null;
  private mode: VoiceMode = 'idle';
  private wantRunning = false;
  private silenceTimer: number | null = null;
  private hardTimer: number | null = null;
  private commandBuffer = '';
  private hasHeardSpeech = false;
  /** Substring of JARVIS's currently-spoken text — used to filter out self-echo during 'output' mode. */
  private outputEcho = '';
  /** MediaRecorder for capturing command audio so Whisper can transcribe it. */
  private recorder = new CommandRecorder();
  /** RMS-based VAD for fast end-of-speech detection during command mode. */
  private vad: SimpleVAD | null = null;
  /** Set true after the first audiostart so we only fire onReady once per session. */
  private readyEmitted = false;

  constructor(private events: VoiceEngineEvents) {}

  isSupported(): boolean {
    return getSpeechRecognitionCtor() !== null;
  }

  start(): boolean {
    if (this.wantRunning) return true;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      this.events.onError('이 브라우저는 음성 인식을 지원하지 않습니다 (Chrome / Edge 권장)', true);
      return false;
    }
    this.wantRunning = true;
    this.spinupRecognizerFresh('wake');
    return true;
  }

  stop(): void {
    this.wantRunning = false;
    this.clearTimers();
    this.teardownRecognizer();
    this.stopVad();
    this.recorder.release();
    this.readyEmitted = false;
    this.setMode('idle');
  }

  /** Switch to one-shot command capture (e.g. external trigger). */
  enterCommandMode(initialSilenceMs?: number): void {
    if (!this.wantRunning) return;
    this.commandBuffer = '';
    this.hasHeardSpeech = false;
    this.setMode('command');
    this.armSilenceTimer(initialSilenceMs ?? INITIAL_SILENCE_MS);
    this.armHardTimer();
    void this.startVad();
  }

  getMode(): VoiceMode {
    return this.mode;
  }

  /** Force return to wake-word listening. */
  enterWakeMode(): void {
    if (!this.wantRunning) return;
    this.clearTimers();
    this.stopVad();
    this.commandBuffer = '';
    this.setMode('wake');
  }

  /**
   * Switch to "output" mode for the duration of TTS playback (interruptible).
   * Mic stays ON; any real user speech (not JARVIS's own voice bleeding into the
   * mic), the wake word, or a stop word ("그만"/"잠깐"/...) cuts JARVIS off.
   */
  enterOutputMode(echo?: string): void {
    if (!this.wantRunning) return;
    this.commandBuffer = '';
    this.hasHeardSpeech = false;
    this.outputEcho = (echo ?? '').toLowerCase().trim();
    this.clearTimers();
    this.stopVad();
    this.setMode('output');
  }

  /**
   * Locked output mode — mic is fully OFF for the duration of TTS.
   * Use for important payloads (analysis results, search summaries) that the user
   * wants to hear in full. Caller must invoke resumeInFollowupMode after TTS ends.
   */
  enterLockedOutputMode(): void {
    if (!this.wantRunning) return;
    this.commandBuffer = '';
    this.hasHeardSpeech = false;
    this.outputEcho = '';
    this.clearTimers();
    this.stopVad();
    this.teardownRecognizer();
    this.setMode('output');
  }

  /**
   * Keep dialog open after TTS finishes — listen for follow-up command without wake word.
   * Always tears down + respawns the recognizer so any TTS audio bleed-through that may
   * have been captured during 'output' mode is discarded (otherwise bleed text gets
   * mashed into the next utterance and the router thinks the user repeated the prior task).
   */
  resumeInFollowupMode(initialSilenceMs?: number): void {
    if (!this.wantRunning) return;
    this.commandBuffer = '';
    this.hasHeardSpeech = false;
    // KEEP outputEcho — finalizeCommand uses it to strip TTS bleed-through.
    // Keep the running recognizer: restarting it left the mic deaf for ~1s and
    // swallowed the first words of a quick follow-up.
    if (this.recognizer) this.setMode('command');
    else this.spinupRecognizerFresh('command');
    if (isWhisperReady()) {
      void this.recorder.start();
    }
    this.armSilenceTimer(initialSilenceMs ?? FOLLOWUP_SILENCE_MS);
    this.armHardTimer();
    void this.startVad();
  }

  // ───── internals ─────

  private setMode(next: VoiceMode) {
    if (this.mode === next) return;
    this.mode = next;
    this.events.onModeChange(next);
  }

  private teardownRecognizer(): void {
    if (!this.recognizer) return;
    try {
      this.recognizer.onresult = null;
      this.recognizer.onerror = null;
      this.recognizer.onend = null;
      this.recognizer.onstart = null;
      this.recognizer.onaudiostart = null;
      this.recognizer.abort();
    } catch {
      /* ignore */
    }
    this.recognizer = null;
  }

  private spinupRecognizerFresh(initialMode: VoiceMode): void {
    this.teardownRecognizer();
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      this.events.onError('이 브라우저는 음성 인식을 지원하지 않습니다 (Chrome / Edge 권장)', true);
      return;
    }
    this.recognizer = new Ctor();
    this.recognizer.lang = 'ko-KR';
    this.recognizer.continuous = true;
    this.recognizer.interimResults = true;
    // Get top-3 alternatives so we can pick the highest-confidence transcription
    this.recognizer.maxAlternatives = 3;
    this.recognizer.onresult = (e) => this.handleResult(e);
    this.recognizer.onerror = (e) => this.handleError(e);
    this.recognizer.onend = () => this.handleEnd();
    // First time mic actually captures audio → fire onReady so UI can flip "active".
    // Use audiostart (real mic capture) with onstart as a fallback for older browsers.
    const emitReadyOnce = () => {
      if (this.readyEmitted) return;
      this.readyEmitted = true;
      this.events.onReady?.();
    };
    this.recognizer.onaudiostart = emitReadyOnce;
    this.recognizer.onstart = emitReadyOnce;
    this.setMode(initialMode);
    this.tryStart();
  }

  private tryStart() {
    if (!this.recognizer || !this.wantRunning) return;
    try {
      this.recognizer.start();
    } catch {
      /* already started — fine */
    }
  }

  private handleResult(e: SRResultEvent) {
    let interim = '';
    let final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i]!;
      const text = pickBestAlternative(result);
      if (result.isFinal) final += text;
      else interim += text;
    }
    const combined = (final + ' ' + interim).toLowerCase().trim();
    const buf = this.stripWakeWord(final + ' ' + interim).trim();

    if (this.mode === 'wake') {
      // Trigger LISTENING on EITHER an explicit wake word OR any substantive speech
      // (≥3 chars). User asked for instant response without needing to say "자비스" first.
      const hasWake = this.containsWakeWord(combined);
      const hasSpeech = buf.length >= 3;
      if (hasWake || hasSpeech) {
        this.events.onWake();
        this.commandBuffer = buf;
        this.hasHeardSpeech = buf.length > 0;
        this.setMode('command');
        if (isWhisperReady()) {
          void this.recorder.start();
        }
        this.armSilenceTimer(
          this.hasHeardSpeech ? END_OF_SPEECH_SILENCE_MS : INITIAL_SILENCE_MS,
        );
        this.armHardTimer();
        void this.startVad();
        if (buf.length > 0) this.events.onPartialCommand(buf);
      }
      return;
    }

    if (this.mode === 'output') {
      // Barge-in like a real conversation: the moment the user talks, JARVIS stops.
      // Speech that is mostly JARVIS's own sentence is speaker bleed — ignored.
      const hasWake = this.containsWakeWord(combined);
      const ttsContainsWake = this.outputEcho
        ? WAKE_WORDS.some((w) => this.outputEcho.includes(w))
        : false;
      const hasStop = this.containsStopWord(combined);
      const own = this.stripOutputEcho(buf);
      const ownLen = own.replace(/[\s.,!?'"·…~]+/g, '').length;
      const userTalking = ownLen >= 3 && !this.isLikelyEcho(own);
      if ((hasWake && !ttsContainsWake) || hasStop || userTalking) {
        this.commandBuffer = hasStop ? this.stripStopWord(own) : this.stripWakeWord(own).trim();
        this.hasHeardSpeech = this.commandBuffer.length > 0;
        this.setMode('command');
        if (isWhisperReady()) {
          void this.recorder.start();
        }
        this.armSilenceTimer(
          this.hasHeardSpeech ? END_OF_SPEECH_SILENCE_MS : INITIAL_SILENCE_MS,
        );
        this.armHardTimer();
        void this.startVad();
        this.events.onInterrupt(this.commandBuffer);
        if (this.commandBuffer.length > 0) {
          this.events.onPartialCommand(this.commandBuffer);
        }
      }
      return;
    }

    if (this.mode === 'command') {
      this.commandBuffer = buf;
      if (buf.length > 0) {
        this.hasHeardSpeech = true;
        this.events.onPartialCommand(buf);
        // Reset the "are they done?" timer — user is still talking.
        this.armSilenceTimer(END_OF_SPEECH_SILENCE_MS);
      }
      // (Removed the old 700ms premature-finalize shortcut — it cut users off.)
    }
  }

  /**
   * Heuristic: does the recognized speech look like speaker echo of JARVIS's TTS?
   *
   * Compute the longest contiguous substring of user input found in the TTS text.
   * If most of the user input overlaps the TTS text, it's almost certainly bleed.
   * Real user speech (even on the same topic) introduces novel character sequences.
   */
  private isLikelyEcho(buf: string): boolean {
    if (!this.outputEcho) return false;
    const u = buf.toLowerCase().replace(/[\s.,!?'"·…~]+/g, '');
    const t = this.outputEcho.replace(/[\s.,!?'"·…~]+/g, '');
    if (u.length < 2) return true; // sub-syllable input is noise
    // Longest substring of u that appears anywhere in t
    let maxLen = 0;
    for (let len = u.length; len > maxLen; len--) {
      for (let start = 0; start + len <= u.length; start++) {
        if (t.includes(u.slice(start, start + len))) {
          maxLen = len;
          break;
        }
      }
    }
    // If ≥70% of the user input is a contiguous substring of TTS, treat as echo.
    return maxLen / u.length >= 0.7;
  }

  private containsStopWord(text: string): boolean {
    return STOP_WORDS.some((w) => text.includes(w));
  }

  private stripStopWord(text: string): string {
    let out = text;
    for (const w of STOP_WORDS) {
      const idx = out.toLowerCase().lastIndexOf(w);
      if (idx >= 0) out = out.slice(idx + w.length);
    }
    return out.trim();
  }

  private handleError(e: SRErrorEvent) {
    const code = e.error || 'unknown';
    if (code === 'no-speech' || code === 'aborted') return;
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      this.events.onError('마이크 권한이 거부되었습니다. 브라우저 설정에서 허용해주세요.', true);
      this.wantRunning = false;
      return;
    }
    if (code === 'network') {
      this.netErrorAt = Date.now();
      return; // transient — handleEnd restarts with a short back-off
    }
    this.events.onError(`recognition error: ${code}`, false);
  }

  private netErrorAt = 0;

  private handleEnd() {
    if (!this.wantRunning) return;
    // Browsers stop continuous=true after a while → restart (after a network
    // blip, wait a moment so the restart doesn't fail straight away).
    if (Date.now() - this.netErrorAt < 1500) window.setTimeout(() => this.tryStart(), 600);
    else this.tryStart();
  }

  private armSilenceTimer(ms = END_OF_SPEECH_SILENCE_MS) {
    this.clearSilenceTimer();
    this.silenceTimer = window.setTimeout(() => this.finalizeCommand('silence'), ms);
  }

  /** Spin up RMS VAD on the recorder's mic stream to detect end-of-speech faster. */
  private async startVad(): Promise<void> {
    this.stopVad();
    const stream = await this.recorder.ensureStream();
    if (!stream) return;
    this.vad = new SimpleVAD({
      silenceMs: VAD_SILENCE_MS,
      onSpeech: () => {
        // Real audio detected — user is talking; push the SR-text silence timer out.
        this.hasHeardSpeech = true;
        this.armSilenceTimer(END_OF_SPEECH_SILENCE_MS);
      },
      onSilence: () => {
        // VAD says they're done — finalize without waiting for the SR text timer.
        if (this.mode === 'command' && this.commandBuffer.trim().length > 0) {
          void this.finalizeCommand('vad');
        }
      },
    });
    this.vad.start(stream);
  }

  private stopVad(): void {
    if (this.vad) {
      this.vad.stop();
      this.vad = null;
    }
  }

  private armHardTimer() {
    this.clearHardTimer();
    this.hardTimer = window.setTimeout(() => this.finalizeCommand('hard-timeout'), COMMAND_HARD_TIMEOUT_MS);
  }

  private clearSilenceTimer() {
    if (this.silenceTimer !== null) {
      window.clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private clearHardTimer() {
    if (this.hardTimer !== null) {
      window.clearTimeout(this.hardTimer);
      this.hardTimer = null;
    }
  }

  private clearTimers() {
    this.clearSilenceTimer();
    this.clearHardTimer();
  }

  private async finalizeCommand(
    _reason: 'silence' | 'hard-timeout' | 'vad',
  ): Promise<void> {
    if (this.mode !== 'command') return;
    this.clearTimers();
    this.stopVad();
    const fallback = this.commandBuffer.trim();
    this.commandBuffer = '';

    let candidate = '';
    let raw = '';

    if (isWhisperReady()) {
      try {
        const blob = await this.recorder.stopAndCollect();
        if (blob && blob.size > 0) {
          // Race Whisper against a 2s timeout — Whisper's Korean accuracy is
          // far better than Chrome SR, so wait a bit longer to use it when
          // possible. Falls back to SR only when Whisper is genuinely stuck.
          raw = (
            await Promise.race([
              transcribe(blob),
              new Promise<string>((_, rej) =>
                setTimeout(() => rej(new Error('whisper-timeout')), 2000),
              ),
            ])
          ).trim();
          candidate = this.stripWakeWord(this.stripOutputEcho(raw)).trim();
        }
      } catch {
        /* fall through to SR fallback */
      }
    } else {
      this.recorder.stop();
    }

    // Always apply echo + wake strip to SR fallback as well — same bleed risk.
    const cleanedFallback = this.stripWakeWord(
      this.stripOutputEcho(fallback),
    ).trim();

    // Pick the best candidate: prefer Whisper if it produced meaningful text
    let final = candidate || cleanedFallback;

    // Heuristic: if final is suspiciously short OR is clearly bleed-dominated,
    // treat as empty wake → caller goes to STANDBY without re-running prior task.
    if (final.length < 3) final = '';
    else if (this.isMostlyEcho(final)) final = '';

    if (process.env.NODE_ENV !== 'production') {
      console.info('[finalize]', {
        raw: raw.slice(0, 120),
        whisperCleaned: candidate.slice(0, 120),
        srRaw: fallback.slice(0, 120),
        srCleaned: cleanedFallback.slice(0, 120),
        final: final.slice(0, 120),
        echo: this.outputEcho.slice(0, 80),
      });
    }

    this.events.onFinalCommand(final);
  }

  /** Returns true when the input is mostly contained in the prior TTS text. */
  private isMostlyEcho(text: string): boolean {
    if (!this.outputEcho || text.length < 4) return false;
    const t = text.toLowerCase().replace(/[\s.,!?'"·…~]+/g, '');
    const e = this.outputEcho.toLowerCase().replace(/[\s.,!?'"·…~]+/g, '');
    if (t.length < 4 || e.length < 8) return false;
    // Trigram overlap: how many of the input's 3-char sequences appear in echo
    const tri = new Set<string>();
    for (let i = 0; i + 3 <= t.length; i++) tri.add(t.slice(i, i + 3));
    if (tri.size === 0) return false;
    let shared = 0;
    for (const g of tri) {
      if (e.includes(g)) shared++;
    }
    const ratio = shared / tri.size;
    return ratio >= 0.6; // 60%+ overlap with prior reply → echo
  }

  /**
   * Remove any substring overlap with JARVIS's prior TTS text (outputEcho)
   * from the recorded transcript. Mic picks up speaker bleed even with
   * echo-cancellation; this is the post-hoc filter.
   */
  private stripOutputEcho(text: string): string {
    if (!this.outputEcho || this.outputEcho.length < 8) return text;
    const echo = this.outputEcho.toLowerCase();
    const lower = text.toLowerCase();

    // Case 1: text starts with a tail of the echo (recorder caught speaker tail)
    for (
      let len = Math.min(echo.length, lower.length);
      len >= 6;
      len -= 1
    ) {
      const echoSuffix = echo.slice(-len);
      if (lower.startsWith(echoSuffix)) {
        return text.slice(len).trim();
      }
    }
    // Case 2: text is mostly contained in echo (entire transcript is bleed)
    if (lower.length > 8 && echo.includes(lower)) return '';
    // Case 3: large fragment of echo appears anywhere — strip just that fragment
    for (
      let len = Math.min(echo.length, 60);
      len >= 12;
      len -= 4
    ) {
      for (let i = 0; i + len <= echo.length; i += 4) {
        const frag = echo.slice(i, i + len);
        const idx = lower.indexOf(frag);
        if (idx >= 0) {
          return (text.slice(0, idx) + ' ' + text.slice(idx + len))
            .replace(/\s+/g, ' ')
            .trim();
        }
      }
    }
    return text;
  }

  private containsWakeWord(text: string): boolean {
    return WAKE_WORDS.some((w) => text.includes(w));
  }

  private stripWakeWord(text: string): string {
    let out = text;
    for (const w of WAKE_WORDS) {
      const idx = out.toLowerCase().lastIndexOf(w);
      if (idx >= 0) {
        out = out.slice(idx + w.length);
      }
    }
    return out.trim();
  }
}

/**
 * Pick the highest-confidence alternative from an SR result.
 * Falls back to longest non-empty transcript if confidence is unreliable
 * (Chrome often returns 0 / 1 with no nuance).
 */
function pickBestAlternative(result: import('./types').SRResult): string {
  const len = result.length;
  if (len === 0) return '';
  let bestText = result[0]?.transcript ?? '';
  let bestConf = result[0]?.confidence ?? 0;
  for (let j = 1; j < len; j++) {
    const alt = result[j];
    if (!alt) continue;
    const conf = alt.confidence ?? 0;
    const text = alt.transcript ?? '';
    if (conf > bestConf || (conf === bestConf && text.length > bestText.length)) {
      bestConf = conf;
      bestText = text;
    }
  }
  return bestText;
}
