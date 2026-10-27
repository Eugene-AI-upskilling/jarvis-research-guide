'use client';

/**
 * Local Whisper STT via Hugging Face transformers.js — runs the model entirely
 * in the browser (no server roundtrip, no API key, no per-call cost).
 *
 * Uses whisper-small for solid Korean accuracy. First load downloads ~244MB of
 * model weights into IndexedDB. Subsequent loads are instant from cache.
 * Inference uses CPU/GPU on the user's machine.
 */

// Domain vocabulary fed to Whisper as a decoder prompt — biases the model
// toward domain words it would otherwise mishear (e.g. "코스닥", "공매도").
// Keep under ~200 chars to fit Whisper's
// prompt context window comfortably.
const WHISPER_PROMPT_KO =
  '자비스 고객님 주가 주식 종목 코스피 코스닥 금리 환율 하락 급락 공매도 손절 PER PBR 분산투자 리포트 실적 반도체';

type ProgressEvent = {
  status?: string;
  name?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
};

type AsrPipeline = (
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<{ text?: string }>;

type LoadStatus =
  | { state: 'idle' }
  | { state: 'loading'; progress: number; file: string }
  | { state: 'ready' }
  | { state: 'error'; message: string };

let pipe: AsrPipeline | null = null;
let status: LoadStatus = { state: 'idle' };
let inFlight: Promise<void> | null = null;
const listeners = new Set<(s: LoadStatus) => void>();

function emit() {
  listeners.forEach((cb) => cb(status));
}

export function onWhisperStatus(cb: (s: LoadStatus) => void): () => void {
  listeners.add(cb);
  cb(status);
  return () => {
    listeners.delete(cb);
  };
}

export function getWhisperStatus(): LoadStatus {
  return status;
}

export function isWhisperReady(): boolean {
  return status.state === 'ready' && pipe !== null;
}

/** Kick off model download / load. Idempotent — safe to call repeatedly. */
export async function loadWhisper(): Promise<void> {
  if (status.state === 'ready') return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    status = { state: 'loading', progress: 0, file: 'initializing' };
    emit();

    try {
      const mod = (await import(
        '@huggingface/transformers'
      )) as typeof import('@huggingface/transformers');

      pipe = (await mod.pipeline(
        'automatic-speech-recognition',
        'Xenova/whisper-small',
        {
          progress_callback: (p: ProgressEvent) => {
            if (p.status === 'progress' && typeof p.progress === 'number') {
              status = {
                state: 'loading',
                progress: Math.round(p.progress),
                file: p.file ?? p.name ?? 'model',
              };
              emit();
            }
          },
        },
      )) as unknown as AsrPipeline;

      status = { state: 'ready' };
      emit();
    } catch (err) {
      const message =
        err instanceof Error ? err.message.slice(0, 200) : 'unknown';
      status = { state: 'error', message };
      pipe = null;
      emit();
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Transcribe a recorded audio blob to Korean text.
 * Caller must ensure isWhisperReady() before invoking.
 */
export async function transcribe(blob: Blob): Promise<string> {
  if (!pipe) throw new Error('Whisper not loaded');
  const audio = await blobToFloat32(blob);
  if (audio.length < 1600) {
    // Less than ~100ms of audio → not worth transcribing
    return '';
  }
  const result = await pipe(audio, {
    language: 'korean',
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
    // Decoder prompt — biases Whisper toward JARVIS domain vocabulary.
    initial_prompt: WHISPER_PROMPT_KO,
    // No-speech threshold — drop hallucinations on near-silent audio.
    no_speech_threshold: 0.6,
  });
  return (result.text ?? '').trim();
}

async function blobToFloat32(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  // 16kHz mono — Whisper's expected input rate
  const ctx = new (window.AudioContext ||
    (
      window as unknown as { webkitAudioContext: typeof AudioContext }
    ).webkitAudioContext)({ sampleRate: 16000 });
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  } finally {
    void ctx.close();
  }
  // Mix to mono
  if (audioBuffer.numberOfChannels === 1) {
    return audioBuffer.getChannelData(0);
  }
  const len = audioBuffer.length;
  const out = new Float32Array(len);
  const ch = audioBuffer.numberOfChannels;
  for (let c = 0; c < ch; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < len; i++) out[i]! += data[i]! / ch;
  }
  return out;
}
