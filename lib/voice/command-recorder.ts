'use client';

/**
 * MediaRecorder wrapper that captures the user's command audio while the
 * voice engine is in 'command' mode. The resulting blob is fed to Whisper
 * for high-quality Korean transcription, replacing the Web Speech API text.
 */
export class CommandRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType: string = '';

  async ensureStream(): Promise<MediaStream | null> {
    if (this.stream && this.stream.active) return this.stream;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      return this.stream;
    } catch {
      return null;
    }
  }

  /** Begin recording. Idempotent — if already recording, restarts cleanly. */
  async start(): Promise<boolean> {
    const stream = await this.ensureStream();
    if (!stream) return false;
    this.stop(); // discard any in-flight recorder
    this.chunks = [];
    this.mimeType = pickMimeType();
    try {
      this.recorder = new MediaRecorder(
        stream,
        this.mimeType ? { mimeType: this.mimeType } : undefined,
      );
      this.recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data);
      };
      this.recorder.start(250);
      return true;
    } catch {
      this.recorder = null;
      return false;
    }
  }

  /** Stop and return the accumulated audio blob. Returns null if nothing captured. */
  async stopAndCollect(): Promise<Blob | null> {
    const rec = this.recorder;
    if (!rec) return null;
    if (rec.state === 'inactive') {
      const blob = this.makeBlob();
      this.recorder = null;
      this.chunks = [];
      return blob;
    }
    return new Promise<Blob | null>((resolve) => {
      rec.onstop = () => {
        const blob = this.makeBlob();
        this.recorder = null;
        this.chunks = [];
        resolve(blob);
      };
      try {
        rec.stop();
      } catch {
        resolve(null);
      }
    });
  }

  /** Discard any in-progress recording without returning data. */
  stop(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch {
        /* ignore */
      }
    }
    this.recorder = null;
    this.chunks = [];
  }

  /** Release the underlying mic stream. */
  release(): void {
    this.stop();
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }

  private makeBlob(): Blob | null {
    if (this.chunks.length === 0) return null;
    return new Blob(this.chunks, {
      type: this.mimeType || 'audio/webm',
    });
  }
}

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}
