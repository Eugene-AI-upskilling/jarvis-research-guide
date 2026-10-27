export interface TTSOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
}

const STORAGE_KEY = 'jarvis_tts_voice';

export interface VoiceOption {
  name: string;
  lang: string;
  isDefault: boolean;
  localService: boolean;
  group: 'korean' | 'english' | 'other';
}

export class TTSEngine {
  private synth: SpeechSynthesis | null = null;
  private selectedVoice: SpeechSynthesisVoice | null = null;
  private autoVoice: SpeechSynthesisVoice | null = null;
  private allVoices: SpeechSynthesisVoice[] = [];
  private voicesLoaded = false;
  private listeners: Array<() => void> = [];
  private storedName: string | null = null;

  constructor() {
    if (typeof window === 'undefined') return;
    if (!('speechSynthesis' in window)) return;
    this.synth = window.speechSynthesis;
    try {
      this.storedName = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      this.storedName = null;
    }
    this.refreshVoices();
    this.synth.addEventListener('voiceschanged', () => {
      this.refreshVoices();
      this.listeners.forEach((l) => l());
    });
  }

  isSupported(): boolean {
    return this.synth !== null;
  }

  hasVoice(): boolean {
    return this.activeVoice() !== null;
  }

  voiceName(): string | null {
    return this.activeVoice()?.name ?? null;
  }

  onVoicesReady(cb: () => void): () => void {
    this.listeners.push(cb);
    if (this.voicesLoaded) cb();
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  /** All voices, Korean-first then English then others. */
  listVoices(): VoiceOption[] {
    return this.allVoices.map((v) => ({
      name: v.name,
      lang: v.lang,
      isDefault: v.default,
      localService: v.localService,
      group: this.groupOf(v),
    }));
  }

  setVoiceByName(name: string | null): void {
    if (name === null) {
      this.selectedVoice = null;
      this.persist(null);
      return;
    }
    const found = this.allVoices.find((v) => v.name === name);
    if (!found) return;
    this.selectedVoice = found;
    this.persist(name);
  }

  private generation = 0;

  /**
   * Speak sentence by sentence. Chrome's online voices silently stop on long
   * utterances (~15s); short chunks avoid that and sound more natural.
   */
  async speak(text: string, opts: TTSOptions = {}): Promise<void> {
    const gen = ++this.generation;
    const parts = text
      .split(/(?<=[.!?。…])\s+|\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    for (const part of parts) {
      if (gen !== this.generation) return;
      await this.speakOne(part, opts);
    }
  }

  private speakOne(text: string, opts: TTSOptions): Promise<void> {
    if (!this.synth || !text.trim()) return Promise.resolve();
    const voice = this.activeVoice();
    return new Promise<void>((resolve, reject) => {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = voice?.lang ?? 'ko-KR';
      if (voice) utter.voice = voice;
      utter.rate = opts.rate ?? 1.08;
      utter.pitch = opts.pitch ?? 0.85;
      utter.volume = opts.volume ?? 1.0;
      utter.onend = () => resolve();
      utter.onerror = (e) => {
        if (e.error === 'canceled' || e.error === 'interrupted') resolve();
        else reject(new Error(`tts error: ${e.error}`));
      };
      this.synth!.cancel(); // ensure clean queue
      this.synth!.speak(utter);
    });
  }

  cancel(): void {
    this.generation++;
    this.synth?.cancel();
  }

  // ───── internals ─────

  private activeVoice(): SpeechSynthesisVoice | null {
    return this.selectedVoice ?? this.autoVoice;
  }

  private groupOf(v: SpeechSynthesisVoice): VoiceOption['group'] {
    if (/^ko/i.test(v.lang)) return 'korean';
    if (/^en/i.test(v.lang)) return 'english';
    return 'other';
  }

  private persist(name: string | null) {
    try {
      if (name === null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, name);
    } catch {
      /* ignore */
    }
  }

  private refreshVoices(): void {
    if (!this.synth) return;
    const voices = this.synth.getVoices();
    if (voices.length === 0) return;
    this.voicesLoaded = true;

    // Sort: Korean → English → others; within group: neural/Google first, then alpha
    const groupRank = (v: SpeechSynthesisVoice) => {
      if (/^ko/i.test(v.lang)) return 0;
      if (/^en/i.test(v.lang)) return 1;
      return 2;
    };
    const qualityRank = (v: SpeechSynthesisVoice) => {
      if (/google|neural|natural|premium|online/i.test(v.name)) return 0;
      return 1;
    };
    this.allVoices = [...voices].sort((a, b) => {
      const g = groupRank(a) - groupRank(b);
      if (g !== 0) return g;
      const q = qualityRank(a) - qualityRank(b);
      if (q !== 0) return q;
      return a.name.localeCompare(b.name);
    });

    const koVoices = this.allVoices.filter((v) => /^ko/i.test(v.lang));
    const malePatterns = [
      /InJoon|in-?joon/i,
      /Bongjin|bong-?jin/i,
      /Hyunsu|hyun-?su/i,
      /Seoul.*Male|male.*korean/i,
      /남성|남자/i,
    ];
    const neuralPatterns = [/google|neural|natural|premium|online/i];

    this.autoVoice =
      koVoices.find((v) => malePatterns.some((p) => p.test(v.name))) ??
      koVoices.find((v) => neuralPatterns.some((p) => p.test(v.name))) ??
      koVoices[0] ??
      null;

    if (this.storedName) {
      const restored = this.allVoices.find((v) => v.name === this.storedName);
      if (restored) this.selectedVoice = restored;
    }
  }
}
