// Web Speech API type augmentation (SpeechRecognition is non-standard in TS dom lib)

export interface SRAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

export interface SRResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(i: number): SRAlternative;
  [index: number]: SRAlternative;
}

export interface SRResultList {
  readonly length: number;
  item(i: number): SRResult;
  [index: number]: SRResult;
}

export interface SRResultEvent extends Event {
  readonly resultIndex: number;
  readonly results: SRResultList;
}

export interface SRErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

export interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SRResultEvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onstart: ((e: Event) => void) | null;
  onaudiostart: ((e: Event) => void) | null;
  onend: ((e: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isVoiceSupported(): boolean {
  return getSpeechRecognitionCtor() !== null && typeof window !== 'undefined' && 'speechSynthesis' in window;
}
