import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface TTSRequest {
  text: string;
  voice_id?: string;
  stability?: number;
  similarity_boost?: number;
  style?: number;
}

const DEFAULT_VOICE = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'; // Adam (multilingual)
// Turbo v2.5 — first-byte ~300ms (vs ~1.2s for multilingual_v2), Korean supported.
const DEFAULT_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5';

export async function POST(req: Request) {
  let body: TTSRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const text = (body.text ?? '').toString().trim();
  if (!text) {
    return NextResponse.json({ ok: false, error: 'empty text' }, { status: 400 });
  }
  if (text.length > 800) {
    return NextResponse.json({ ok: false, error: 'text too long' }, { status: 400 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: 'ELEVENLABS_API_KEY 미설정' },
      { status: 500 },
    );
  }

  const voiceId = (body.voice_id || DEFAULT_VOICE).trim();
  // /stream endpoint = chunked transfer (first audio bytes sent before generation finishes)
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`;

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: DEFAULT_MODEL,
        voice_settings: {
          stability: body.stability ?? 0.5,
          similarity_boost: body.similarity_boost ?? 0.75,
          style: body.style ?? 0,
          use_speaker_boost: true,
        },
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text();
      return NextResponse.json(
        {
          ok: false,
          error: `ElevenLabs ${upstream.status}: ${detail.slice(0, 200)}`,
        },
        { status: upstream.status },
      );
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 200) : 'fetch failed',
      },
      { status: 500 },
    );
  }
}
