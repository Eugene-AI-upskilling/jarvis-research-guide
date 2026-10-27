'use client';

/**
 * ElevenLabs TTS client. Calls our /api/tts proxy, plays the returned MP3 stream
 * through an HTMLAudioElement, and exposes cancel() so JARVIS's voice can be
 * interrupted (wake word / stop word).
 */

export interface ElevenLabsSpeakOptions {
  voiceId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
}

export class ElevenLabsTTS {
  private audio: HTMLAudioElement | null = null;
  private currentObjectUrl: string | null = null;
  private available: boolean | null = null; // null = unknown, set on first call

  isAvailable(): boolean | null {
    return this.available;
  }

  async speak(text: string, opts: ElevenLabsSpeakOptions = {}): Promise<void> {
    if (!text.trim()) return;
    this.cancel();

    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        voice_id: opts.voiceId,
        stability: opts.stability,
        similarity_boost: opts.similarityBoost,
        style: opts.style,
      }),
    });

    if (!res.ok) {
      this.available = false;
      const errText = await res.text().catch(() => '');
      throw new Error(
        `ElevenLabs unavailable: ${res.status} ${errText.slice(0, 120)}`,
      );
    }
    if (!res.body) {
      this.available = false;
      throw new Error('ElevenLabs response had no body');
    }
    this.available = true;

    // Try MediaSource streaming first (first audio bytes → instant playback).
    // Falls back to blob mode if MSE / mp3 SourceBuffer isn't supported.
    if (canStreamMpeg()) {
      return this.playStreaming(res.body);
    }
    return this.playFromBlob(res);
  }

  private playStreaming(body: ReadableStream<Uint8Array>): Promise<void> {
    return new Promise((resolve, reject) => {
      const mediaSource = new MediaSource();
      const objectUrl = URL.createObjectURL(mediaSource);
      this.currentObjectUrl = objectUrl;
      const audio = new Audio(objectUrl);
      audio.preload = 'auto';
      this.audio = audio;

      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        if (this.currentObjectUrl === objectUrl) {
          URL.revokeObjectURL(objectUrl);
          this.currentObjectUrl = null;
        }
        if (this.audio === audio) this.audio = null;
      };

      audio.onended = () => {
        cleanup();
        resolve();
      };
      audio.onerror = () => {
        cleanup();
        reject(new Error('audio playback failed'));
      };

      mediaSource.addEventListener(
        'sourceopen',
        () => {
          let sourceBuffer: SourceBuffer;
          try {
            sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
          } catch (e) {
            cleanup();
            reject(e instanceof Error ? e : new Error('addSourceBuffer failed'));
            return;
          }

          const reader = body.getReader();
          const queue: Uint8Array[] = [];
          let readerDone = false;
          let started = false;

          const pump = async () => {
            try {
              while (true) {
                const { value, done } = await reader.read();
                if (done) {
                  readerDone = true;
                  break;
                }
                queue.push(value);
                drain();
              }
              drain();
            } catch (e) {
              cleanup();
              reject(e instanceof Error ? e : new Error('stream read failed'));
            }
          };

          const drain = () => {
            if (sourceBuffer.updating) return;
            const next = queue.shift();
            if (next) {
              try {
                // Copy into a fresh Uint8Array<ArrayBuffer> so the DOM lib's
                // BufferSource type (which excludes SharedArrayBuffer) is happy.
                sourceBuffer.appendBuffer(new Uint8Array(next));
              } catch (e) {
                cleanup();
                reject(e instanceof Error ? e : new Error('appendBuffer failed'));
              }
              return;
            }
            if (readerDone && mediaSource.readyState === 'open') {
              try {
                mediaSource.endOfStream();
              } catch {
                /* ignore — stream may already be ended */
              }
            }
          };

          sourceBuffer.addEventListener('updateend', () => {
            // Kick off playback as soon as we've appended the first chunk.
            if (!started) {
              started = true;
              audio.play().catch((e) => {
                cleanup();
                reject(e);
              });
            }
            drain();
          });

          void pump();
        },
        { once: true },
      );
    });
  }

  private playFromBlob(res: Response): Promise<void> {
    return res.blob().then(
      (blob) =>
        new Promise<void>((resolve, reject) => {
          if (blob.size === 0) {
            reject(new Error('Empty audio'));
            return;
          }
          const objectUrl = URL.createObjectURL(blob);
          this.currentObjectUrl = objectUrl;
          const audio = new Audio(objectUrl);
          audio.preload = 'auto';
          this.audio = audio;

          const cleanup = () => {
            if (this.currentObjectUrl === objectUrl) {
              URL.revokeObjectURL(objectUrl);
              this.currentObjectUrl = null;
            }
            if (this.audio === audio) this.audio = null;
          };

          audio.onended = () => {
            cleanup();
            resolve();
          };
          audio.onerror = () => {
            cleanup();
            reject(new Error('audio playback failed'));
          };
          audio.play().catch((e) => {
            cleanup();
            reject(e);
          });
        }),
    );
  }

  cancel(): void {
    if (this.audio) {
      try {
        this.audio.pause();
        this.audio.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
    if (this.currentObjectUrl) {
      try {
        URL.revokeObjectURL(this.currentObjectUrl);
      } catch {
        /* ignore */
      }
      this.currentObjectUrl = null;
    }
    this.audio = null;
  }
}

function canStreamMpeg(): boolean {
  if (typeof window === 'undefined' || typeof MediaSource === 'undefined') {
    return false;
  }
  try {
    return MediaSource.isTypeSupported('audio/mpeg');
  } catch {
    return false;
  }
}
