'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useJarvisStore } from '@/store/jarvis-store';
import { VoiceEngine, type VoiceMode } from '@/lib/voice/voice-engine';
import { TTSEngine, type VoiceOption } from '@/lib/voice/tts';
import { ElevenLabsTTS } from '@/lib/voice/tts-elevenlabs';
import { isVoiceSupported } from '@/lib/voice/types';
import { mockRespond } from '@/lib/voice/mock-llm';
import { onWhisperStatus } from '@/lib/voice/whisper';
import { soundEngine } from '@/lib/audio/sound-engine';
import type { ApiResponse } from '@/lib/ai/types';
import type { CodeStreamEvent } from '@/lib/ai/code-events';
import { useBriefStore } from '@/store/brief-store';
import { askQuestion, cancelTurn, loadBrief, registerSpeaker } from '@/lib/brief/ask';

/**
 * Market / money words → straight to research, skipping the intent-router round
 * trip (~1.5s). Everything else (greetings, small talk) still goes via /api/chat.
 */
const FINANCE_RE =
  /주가|주식|종목|코스피|코스닥|지수|금리|환율|증시|시장|하락|상승|폭락|급락|반등|떨어|올랐|내렸|실적|배당|매수|매도|투자|펀드|채권|etf|공매도|per|pbr|삼성|하이닉스|현대차|네이버|카카오|나스닥|다우|s&p|엔비디아|테슬라|애플|반도체|2차전지|경제|물가|인플레|연준|fomc|유가|달러|엔화|원화|비트코인|코인|리포트|증권|손절|물타기|분산|변동성|vix|시총|상장/i;

type VoiceUIState =
  | 'unsupported'
  | 'idle'
  | 'enabling'
  | 'active'
  | 'paused'
  | 'error';

const PREVIEW_TEXT = '안녕하세요 고객님, 자비스 음성 테스트입니다.';

export function VoiceController() {
  const setStoreState = useJarvisStore((s) => s.setState);
  const pushTranscript = useJarvisStore((s) => s.pushTranscript);
  const storeState = useJarvisStore((s) => s.state);
  const startCodeTask = useJarvisStore((s) => s.startCodeTask);
  const pushCodeStep = useJarvisStore((s) => s.pushCodeStep);
  const pushCodeFile = useJarvisStore((s) => s.pushCodeFile);
  const pushCodeChunk = useJarvisStore((s) => s.pushCodeChunk);
  const pushCodeShell = useJarvisStore((s) => s.pushCodeShell);
  const pushCodeBlocked = useJarvisStore((s) => s.pushCodeBlocked);
  const finishCodeTask = useJarvisStore((s) => s.finishCodeTask);
  const failCodeTask = useJarvisStore((s) => s.failCodeTask);
  const startResearchTask = useJarvisStore((s) => s.startResearchTask);
  const pushResearchSearchQuery = useJarvisStore(
    (s) => s.pushResearchSearchQuery,
  );
  const pushResearchSource = useJarvisStore((s) => s.pushResearchSource);
  const finishResearchTask = useJarvisStore((s) => s.finishResearchTask);
  const failResearchTask = useJarvisStore((s) => s.failResearchTask);

  const engineRef = useRef<VoiceEngine | null>(null);
  const ttsRef = useRef<TTSEngine | null>(null);
  const elevenRef = useRef<ElevenLabsTTS | null>(null);
  const followupRef = useRef(false);
  const codeAbortRef = useRef<AbortController | null>(null);
  const researchAbortRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef(false);
  const [uiState, setUiState] = useState<VoiceUIState>('idle');
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [voiceLabel, setVoiceLabel] = useState<string>('—');
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [whisperLabel, setWhisperLabel] = useState<string>('');
  // null = not yet probed; true = ElevenLabs working; false = unavailable / failed
  const [elevenActive, setElevenActive] = useState<boolean | null>(null);

  // Eagerly construct TTS engine on first render so the voice list populates immediately
  if (typeof window !== 'undefined' && !ttsRef.current) {
    ttsRef.current = new TTSEngine();
  }

  useEffect(() => {
    const tts = ttsRef.current;
    if (!tts) return;
    const sync = () => {
      setVoiceOptions(tts.listVoices());
      setVoiceLabel(tts.voiceName() ?? '—');
      setSelectedVoiceName(tts.voiceName() ?? null);
    };
    sync();
    return tts.onVoicesReady(sync);
  }, []);

  // Boot-time support check (BOOTING state means support is unknown until boot finishes)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isVoiceSupported()) setUiState('unsupported');
  }, []);

  // Subscribe to Whisper model status — surfaced in the voice status row
  useEffect(() => {
    return onWhisperStatus((s) => {
      switch (s.state) {
        case 'idle':
          setWhisperLabel('');
          break;
        case 'loading':
          setWhisperLabel(`whisper ${s.progress}%`);
          break;
        case 'ready':
          setWhisperLabel('whisper ready');
          break;
        case 'error':
          setWhisperLabel(`whisper failed: ${s.message.slice(0, 40)}`);
          break;
      }
    });
  }, []);

  // Auto-clear non-fatal error messages after 5s so transient network blips don't
  // stay on screen forever (Web Speech API loses Google STT briefly, etc.)
  useEffect(() => {
    if (!errorMsg) return;
    if (uiState === 'error') return; // fatal — keep visible
    const t = window.setTimeout(() => setErrorMsg(null), 5000);
    return () => window.clearTimeout(t);
  }, [errorMsg, uiState]);

  // Listen for hand-pinch gesture → silent JARVIS interrupt + wake
  // (same effect as saying "그만" or "자비스" mid-speech)
  useEffect(() => {
    const onPinch = () => {
      cancelTurn();
      ttsRef.current?.cancel();
      elevenRef.current?.cancel();
      cancelRequestedRef.current = true;
      codeAbortRef.current?.abort();
      researchAbortRef.current?.abort();
      soundEngine.playWake();
      setStoreState('LISTENING');
    };
    window.addEventListener('jarvis:pinch', onPinch);
    return () => window.removeEventListener('jarvis:pinch', onPinch);
  }, [setStoreState]);

  // CodingConsole STOP button — abort the in-flight code agent without touching TTS/state.
  useEffect(() => {
    const onCancelCode = () => {
      codeAbortRef.current?.abort();
    };
    window.addEventListener('jarvis:cancel-code', onCancelCode);
    return () => window.removeEventListener('jarvis:cancel-code', onCancelCode);
  }, []);

  const runCodeAgentStream = useCallback(
    async (
      taskText: string,
      workspace: string,
    ): Promise<{ summary: string; ok: boolean; cancelled?: boolean }> => {
      // Cancel any prior task (shouldn't happen, but be defensive)
      codeAbortRef.current?.abort();
      const ac = new AbortController();
      codeAbortRef.current = ac;
      try {
        const res = await fetch('/api/code', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ task: taskText, workspace }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          return { summary: '코드 작업 서버 호출에 실패했습니다.', ok: false };
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let result: { summary: string; ok: boolean } = {
          summary: '작업이 종료되었지만 요약을 받지 못했습니다.',
          ok: true,
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';
          for (const block of events) {
            const dataLine = block
              .split('\n')
              .find((l) => l.startsWith('data:'));
            if (!dataLine) continue;
            const json = dataLine.slice(5).trim();
            if (!json) continue;
            let event: CodeStreamEvent;
            try {
              event = JSON.parse(json) as CodeStreamEvent;
            } catch {
              continue;
            }
            switch (event.type) {
              case 'started':
                startCodeTask(taskText, event.workdir, event.workspace);
                pushCodeStep('agent session started');
                break;
              case 'step':
                pushCodeStep(event.label);
                break;
              case 'file':
                pushCodeFile({ path: event.path, action: event.action });
                break;
              case 'code-chunk':
                pushCodeChunk({
                  path: event.path,
                  action: event.action,
                  content: event.content,
                  previous: event.previous,
                });
                break;
              case 'shell':
                if (event.blocked) {
                  pushCodeBlocked(event.command, event.reason ?? 'dangerous');
                } else {
                  pushCodeShell(event.command);
                }
                break;
              case 'thought':
                pushCodeStep(`thinking — ${event.text.slice(0, 80)}`);
                break;
              case 'result':
                finishCodeTask(event.summary, event.ok);
                result = { summary: event.summary, ok: event.ok };
                break;
              case 'error':
                failCodeTask(event.message);
                result = { summary: event.message, ok: false };
                break;
            }
          }
        }
        return result;
      } catch (err) {
        // Aborted by user — not an error, surface as cancellation.
        if (
          (err as { name?: string })?.name === 'AbortError' ||
          ac.signal.aborted
        ) {
          failCodeTask('사용자가 중단했습니다');
          return { summary: '작업을 중단했습니다.', ok: false, cancelled: true };
        }
        const msg =
          err instanceof Error ? err.message : '코드 에이전트 통신 오류';
        failCodeTask(msg);
        return { summary: msg, ok: false };
      } finally {
        if (codeAbortRef.current === ac) codeAbortRef.current = null;
      }
    },
    [
      startCodeTask,
      pushCodeStep,
      pushCodeFile,
      pushCodeChunk,
      pushCodeShell,
      pushCodeBlocked,
      finishCodeTask,
      failCodeTask,
    ],
  );

  const runResearch = useCallback(
    async (
      queryText: string,
    ): Promise<{ summary: string; ok: boolean; cancelled?: boolean }> => {
      researchAbortRef.current?.abort();
      const ac = new AbortController();
      researchAbortRef.current = ac;
      try {
        startResearchTask(queryText);
        // Voice questions open the same visual card as clicked questions.
        const cardId = useBriefStore.getState().addCard(queryText);
        const brief = await loadBrief(cardId, queryText);
        if (ac.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        if (!brief) {
          const msg = '죄송합니다 고객님, 지금은 자료를 불러오지 못했습니다.';
          failResearchTask(msg);
          return { summary: msg, ok: false };
        }
        for (const s of brief.sources) pushResearchSource(s);
        finishResearchTask(brief.summary, true);
        return { summary: brief.spoken, ok: true };
      } catch (err) {
        if (
          (err as { name?: string })?.name === 'AbortError' ||
          ac.signal.aborted
        ) {
          failResearchTask('사용자가 중단했습니다');
          return { summary: '검색을 중단했습니다.', ok: false, cancelled: true };
        }
        const msg = err instanceof Error ? err.message : '리서치 통신 오류';
        failResearchTask(msg);
        return { summary: msg, ok: false };
      } finally {
        if (researchAbortRef.current === ac) researchAbortRef.current = null;
      }
    },
    [
      startResearchTask,
      pushResearchSearchQuery,
      pushResearchSource,
      finishResearchTask,
      failResearchTask,
    ],
  );

  /**
   * Speak through TTS. Mic stays ON during playback — any user speech triggers
   * an immediate barge-in (TTS cancels, engine flips to command mode). The echo
   * filter (in voice-engine) compares recognized text to the TTS text so JARVIS's
   * own audio bleed-through doesn't self-interrupt.
   *
   * The `locked` flag is preserved for callers but ignored — barge-in is now
   * uniformly enabled per user request.
   */
  const speakAndListen = useCallback(
    async (text: string, _locked = false): Promise<void> => {
      void _locked;
      const engine = engineRef.current;
      const tts = ttsRef.current;
      const eleven = elevenRef.current;
      if (!engine || !tts) return;
      engine.enterOutputMode(text);
      setStoreState('SPEAKING');
      soundEngine.duckAmbient();
      try {
        // Prefer ElevenLabs (high-quality neural voice) when configured.
        // Falls back to browser SpeechSynthesis on any failure.
        if (eleven && eleven.isAvailable() !== false) {
          try {
            await eleven.speak(text);
            setElevenActive(true);
            return;
          } catch {
            setElevenActive(false);
            /* fall through to browser TTS */
          }
        }
        await tts.speak(text);
      } catch {
        /* swallow */
      } finally {
        soundEngine.unduckAmbient();
      }
    },
    [setStoreState],
  );

  const handleFinalCommand = useCallback(
    async (text: string) => {
      const engine = engineRef.current;
      const tts = ttsRef.current;
      if (!engine || !tts) return;

      // Drop split-utterance fragments and accidental follow-up speech while a
      // long-running async task (code agent / research) is already in flight.
      // The user must explicitly interrupt with "그만" / "자비스" / pinch / STOP
      // to start a new command. Wake-word barge-in still works in voice-engine.
      if (text.trim().length >= 2) cancelTurn();

      // Reset cancel flag at the start of a fresh turn.
      cancelRequestedRef.current = false;

      const cleaned = text.trim();
      const wasFollowup = followupRef.current;
      followupRef.current = false;

      // Empty buffer in follow-up window = user chose silence; quietly return to standby.
      if (cleaned.length === 0) {
        setStoreState('STANDBY');
        if (!wasFollowup) {
          // came from explicit wake but no speech — silent return
        }
        engine.enterWakeMode();
        return;
      }

      pushTranscript({ speaker: 'user', text: cleaned });
      setStoreState('THINKING');

      if (FINANCE_RE.test(cleaned)) {
        // The shared turn speaks a short ack if needed, the answer as soon as it
        // exists, then keeps listening (registered speaker) — no router hop.
        await askQuestion(cleaned, { fromVoice: true, withContext: true });
        return;
      }

      // Pull last few turns as conversation context (capped to keep payload small)
      const recentHistory = useJarvisStore
        .getState()
        .transcript.slice(-7, -1) // exclude the user message we just pushed
        .map((entry) => ({
          role: (entry.speaker === 'user' ? 'user' : 'assistant') as
            | 'user'
            | 'assistant',
          content: entry.text,
        }));

      let reply: string;
      let route: string = 'mock';
      let payload: Record<string, unknown> | undefined;
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: cleaned, history: recentHistory }),
        });
        const json = (await res.json()) as ApiResponse;
        if (!json.ok) throw new Error(json.error);
        reply = json.reply;
        route = json.route;
        payload = json.payload;
        if (json.notice && process.env.NODE_ENV !== 'production') {
          console.info(
            `[jarvis-router] route=${json.route} source=${json.source} — ${json.notice}`,
          );
        }
      } catch {
        reply = await mockRespond(cleaned);
      }

      if (route !== 'research_web') pushTranscript({ speaker: 'jarvis', text: reply });

      // Async tasks (code/research) skip the ack TTS — Siri/Alexa style.
      // The user gets a start chime + the live console/transcript as visual ack,
      // and only hears the result when the task finishes. Saves 2~3s per turn.
      const isAsyncTask = route === 'execute_code_task';
      if (route === 'research_web') {
        // handled below — ack is spoken while the research runs
      } else if (!isAsyncTask) {
        // Chat / local / open_webpage — speak the short reply normally.
        await speakAndListen(reply, /* locked */ false);
        // User cut in — the engine is already capturing their words; leave it be.
        if (cancelRequestedRef.current) {
          cancelRequestedRef.current = false;
          if (engine.getMode() !== 'command') {
            followupRef.current = true;
            setStoreState('LISTENING');
            engine.resumeInFollowupMode();
          }
          return;
        }
      } else {
        // Async task — play start chime now so the user gets immediate audio feedback.
        soundEngine.playTaskStart();
      }

      // If router chose execute_code_task, hand off to Claude Agent SDK
      if (route === 'execute_code_task') {
        const codeTaskText =
          (payload && typeof payload.task_summary === 'string'
            ? (payload.task_summary as string)
            : null) ||
          (payload && typeof payload.original_request === 'string'
            ? (payload.original_request as string)
            : null) ||
          cleaned;
        const workspace =
          payload && typeof payload.workspace === 'string'
            ? (payload.workspace as string)
            : 'sandbox';

        setStoreState('THINKING');
        const result = await runCodeAgentStream(codeTaskText, workspace);
        if (result.ok) soundEngine.playTaskDone();
        else if (!result.cancelled) soundEngine.playError();
        pushTranscript({ speaker: 'jarvis', text: result.summary });
        await speakAndListen(result.summary, /* locked */ !result.cancelled);
      } else if (route === 'open_webpage') {
        let url =
          payload && typeof payload.url === 'string'
            ? (payload.url as string)
            : null;

        // YouTube playback intent: convert search URL → first video URL so it auto-plays.
        // If the YT API key isn't set or lookup fails, just open the search results page.
        if (url) {
          const ytMatch = url.match(
            /youtube\.com\/results\?search_query=([^&]+)/i,
          );
          if (ytMatch && ytMatch[1]) {
            try {
              const q = decodeURIComponent(ytMatch[1]);
              const res = await fetch(
                `/api/youtube-search?q=${encodeURIComponent(q)}`,
              );
              if (res.ok) {
                const json = (await res.json()) as {
                  ok: boolean;
                  watchUrl?: string;
                };
                if (json.ok && json.watchUrl) url = json.watchUrl;
              }
            } catch {
              /* keep search URL as fallback */
            }
          }
        }

        if (url) {
          try {
            const res = await fetch('/api/open', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ url }),
            });
            if (!res.ok) {
              window.open(url, '_blank', 'noopener,noreferrer');
            }
          } catch {
            try {
              window.open(url, '_blank', 'noopener,noreferrer');
            } catch {
              /* swallow */
            }
          }
        }
      } else if (route === 'research_web') {
        const researchQuery =
          (payload && typeof payload.query === 'string'
            ? (payload.query as string)
            : null) || cleaned;

        await askQuestion(researchQuery, { fromVoice: true, withContext: true, ack: reply });
        return;
      }
      void isAsyncTask;

      // tail so speaker echo dies before mic re-engages; then auto-listen for follow-up
      await new Promise((r) => setTimeout(r, 200));
      followupRef.current = true;
      setStoreState('LISTENING');
      engine.resumeInFollowupMode();
    },
    [
      pushTranscript,
      setStoreState,
      runCodeAgentStream,
      runResearch,
      speakAndListen,
    ],
  );

  const enable = useCallback(async () => {
    if (uiState === 'active' || uiState === 'enabling') return;
    setErrorMsg(null);
    setUiState('enabling');

    // Request mic permission up front so the user sees one prompt.
    // Explicit constraints request browser-level echo cancellation, noise suppression,
    // and auto gain control — usually defaults to true in modern browsers but making
    // it explicit ensures the request is honored on environments where defaults differ.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      setUiState('error');
      setErrorMsg('마이크 접근이 거부되었습니다.');
      return;
    }

    if (!ttsRef.current) ttsRef.current = new TTSEngine();
    const tts = ttsRef.current;
    if (!elevenRef.current) elevenRef.current = new ElevenLabsTTS();
    setVoiceLabel(tts.voiceName() ?? '—');

    // Start the ambient circuit hum — tied to voice enable so the AudioContext
    // gets created on a real user gesture (browser requirement).
    soundEngine.startAmbient();

    // Kick off Whisper download in the background. Voice still works (Web Speech)
    // while the model loads — Whisper takes over once ready.
    // (Whisper second pass removed — it added up to 2s per turn.)

    if (!engineRef.current) {
      engineRef.current = new VoiceEngine({
        onReady: () => {
          // Mic is actually capturing audio now — flip UI active + audible "ready" cue.
          setUiState('active');
          soundEngine.playWake();
        },
        onWake: () => {
          soundEngine.playWake();
          setStoreState('LISTENING');
        },
        onPartialCommand: (partial) => {
          void partial;
        },
        onFinalCommand: (final) => {
          void handleFinalCommand(final);
        },
        onInterrupt: (_partial) => {
          // User started talking mid-output — stop everything in flight.
          cancelTurn();
          ttsRef.current?.cancel();
          elevenRef.current?.cancel();
          cancelRequestedRef.current = true;
          codeAbortRef.current?.abort();
          researchAbortRef.current?.abort();
          soundEngine.playWake();
          setStoreState('LISTENING');
        },
        onModeChange: (m) => setVoiceMode(m),
        onError: (msg, fatal) => {
          setErrorMsg(msg);
          if (fatal) {
            setUiState('error');
            engineRef.current?.stop();
          } else {
            soundEngine.playError();
          }
        },
      });
    }

    const ok = engineRef.current.start();
    if (!ok) {
      setUiState('error');
      return;
    }
    // Stay in 'enabling' until VoiceEngine.onReady fires (real audio capture).
    // Safety fallback: if onReady never arrives within 2.5s, flip active anyway.
    window.setTimeout(() => {
      setUiState((cur) => (cur === 'enabling' ? 'active' : cur));
    }, 2500);
    if (storeState === 'STANDBY') setStoreState('STANDBY'); // no-op, just to nudge
  }, [handleFinalCommand, setStoreState, storeState, uiState]);

  const disable = useCallback(() => {
    engineRef.current?.stop();
    ttsRef.current?.cancel();
    elevenRef.current?.cancel();
    soundEngine.stopAmbient();
    setUiState('idle');
    setVoiceMode('idle');
    setStoreState('STANDBY');
  }, [setStoreState]);

  const handleVoiceChange = useCallback((name: string) => {
    const tts = ttsRef.current;
    if (!tts) return;
    if (name === '__auto__') {
      tts.setVoiceByName(null);
    } else {
      tts.setVoiceByName(name);
    }
    setSelectedVoiceName(tts.voiceName() ?? null);
    setVoiceLabel(tts.voiceName() ?? '—');
  }, []);

  const previewVoice = useCallback(async () => {
    const tts = ttsRef.current;
    if (!tts || previewing) return;
    setPreviewing(true);
    try {
      await tts.speak(PREVIEW_TEXT, { rate: 1, pitch: 0.85 });
    } catch {
      /* ignore */
    } finally {
      setPreviewing(false);
    }
  }, [previewing]);

  const groupedOptions = useMemo(() => {
    const ko = voiceOptions.filter((v) => v.group === 'korean');
    const en = voiceOptions.filter((v) => v.group === 'english');
    const other = voiceOptions.filter((v) => v.group === 'other');
    return { ko, en, other };
  }, [voiceOptions]);

  // Tapping a question turns the conversation on, so visitors can just talk next.
  useEffect(() => {
    const onEnsure = () => {
      if (uiState === 'idle' || uiState === 'paused') void enable();
    };
    window.addEventListener('jarvis:ensure-voice', onEnsure);
    return () => window.removeEventListener('jarvis:ensure-voice', onEnsure);
  }, [uiState, enable]);

  // While the mic loop runs, clicked questions speak through it (echo-aware)
  // and then hand the mic back to wake-word listening.
  useEffect(() => {
    if (uiState !== 'active') {
      registerSpeaker(null);
      return;
    }
    registerSpeaker(async (text, { final }) => {
      await speakAndListen(text);
      const engine = engineRef.current;
      if (!engine || cancelRequestedRef.current) {
        // Interrupted — the engine is already capturing the user's words.
        cancelRequestedRef.current = false;
        return false;
      }
      if (final) {
        followupRef.current = true;
        setStoreState('LISTENING');
        engine.resumeInFollowupMode();
      }
      return true;
    });
    return () => registerSpeaker(null);
  }, [uiState, speakAndListen, setStoreState]);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      engineRef.current?.stop();
      ttsRef.current?.cancel();
    };
  }, []);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--font-jetbrains)',
        pointerEvents: 'auto',
      }}
    >
      {uiState === 'unsupported' ? (
        <div
          style={{
            fontSize: 11,
            color: 'var(--holo-red)',
            letterSpacing: '0.2em',
            opacity: 0.85,
          }}
        >
          ⚠ 이 브라우저에선 음성 미지원 — Chrome / Edge 권장
        </div>
      ) : (
        <>
          <button
            onClick={uiState === 'active' ? disable : enable}
            disabled={uiState === 'enabling'}
            className="holo-btn"
            style={{
              padding: '8px 22px',
              background:
                uiState === 'active'
                  ? `rgba(var(--state-rgb), 0.18)`
                  : 'rgba(0,20,40,.55)',
              border: `1px solid rgba(var(--state-rgb), 0.7)`,
              color: 'var(--state-bright)',
              fontFamily: 'inherit',
              fontSize: 11,
              letterSpacing: '0.32em',
              backdropFilter: 'blur(6px)',
              boxShadow: `0 0 12px rgba(var(--state-rgb), 0.5), 0 0 28px rgba(var(--state-rgb), 0.25)`,
              textShadow: `0 0 6px rgba(var(--state-rgb), 0.7)`,
            }}
          >
            {uiState === 'enabling'
              ? '◦ ACTIVATING · 마이크 워밍업'
              : uiState === 'active'
                ? '◉ VOICE ACTIVE · 자비스 호출하세요'
                : 'ENABLE VOICE'}
          </button>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 9,
              letterSpacing: '0.22em',
              color: 'var(--holo-text-dim)',
              opacity: 0.85,
            }}
          >
            <span>mode: {voiceMode}</span>
            {whisperLabel && (
              <>
                <span style={{ opacity: 0.4 }}>·</span>
                <span
                  style={{
                    color: whisperLabel.startsWith('whisper ready')
                      ? 'var(--state-bright)'
                      : whisperLabel.startsWith('whisper failed')
                        ? 'var(--holo-red)'
                        : 'var(--holo-text-dim)',
                  }}
                >
                  {whisperLabel}
                </span>
              </>
            )}
            <span style={{ opacity: 0.4 }}>·</span>
            <button
              onClick={() => setPickerOpen((v) => !v)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--state-bright)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 9,
                letterSpacing: 'inherit',
                textShadow: '0 0 4px rgba(var(--state-rgb), .55)',
                padding: 0,
              }}
              title="목소리 변경"
            >
              tts:{' '}
              {elevenActive === true
                ? '자비스 음성 (ElevenLabs)'
                : elevenActive === false
                  ? `${voiceLabel} · ElevenLabs 실패`
                  : `${voiceLabel} → ElevenLabs 우선`}{' '}
              {pickerOpen ? '▲' : '▼'}
            </button>
          </div>

          {pickerOpen && (
            <VoicePicker
              groups={groupedOptions}
              selected={selectedVoiceName}
              onChange={handleVoiceChange}
              onPreview={previewVoice}
              previewing={previewing}
              elevenActive={elevenActive}
            />
          )}

          {errorMsg && (
            <div
              style={{
                fontSize: 10,
                color: 'var(--holo-red)',
                letterSpacing: '0.16em',
                opacity: 0.95,
                maxWidth: 380,
                textAlign: 'center',
              }}
            >
              ⚠ {errorMsg}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function VoicePicker({
  groups,
  selected,
  onChange,
  onPreview,
  previewing,
  elevenActive,
}: {
  groups: { ko: VoiceOption[]; en: VoiceOption[]; other: VoiceOption[] };
  selected: string | null;
  onChange: (name: string) => void;
  onPreview: () => void;
  previewing: boolean;
  elevenActive: boolean | null;
}) {
  return (
    <div
      style={{
        marginTop: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        alignItems: 'stretch',
        background: 'rgba(0, 20, 40, 0.65)',
        border: `1px solid rgba(var(--state-rgb), 0.5)`,
        borderRadius: 4,
        padding: '8px 10px',
        backdropFilter: 'blur(8px)',
        boxShadow: `0 0 14px rgba(var(--state-rgb), 0.35)`,
      }}
    >
      {/* Primary voice = ElevenLabs (고객님 클론) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 10,
          letterSpacing: '0.18em',
          color:
            elevenActive === false
              ? 'var(--holo-red)'
              : 'var(--state-bright)',
          textShadow: 'var(--holo-text-glow)',
        }}
      >
        <span style={{ opacity: 0.55 }}>PRIMARY</span>
        <span>
          ◉ {elevenActive === false ? 'ElevenLabs · 실패' : '자비스 음성 (ElevenLabs)'}
        </span>
      </div>
      <div
        style={{
          fontSize: 8,
          letterSpacing: '0.15em',
          color: 'var(--holo-text-dim)',
          opacity: 0.55,
        }}
      >
        FALLBACK · OS 브라우저 TTS (ElevenLabs 실패 시 사용)
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <select
        value={selected ?? '__auto__'}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: 'rgba(0, 8, 20, 0.85)',
          color: 'var(--state-bright)',
          border: `1px solid rgba(var(--state-rgb), 0.5)`,
          fontFamily: 'var(--font-jetbrains)',
          fontSize: 11,
          letterSpacing: '0.04em',
          padding: '4px 8px',
          minWidth: 280,
          maxWidth: 380,
          cursor: 'pointer',
          outline: 'none',
        }}
      >
        <option value="__auto__">◦ AUTO (기본 자동 선택)</option>
        {groups.ko.length > 0 && (
          <optgroup label="── 한국어 ──">
            {groups.ko.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.lang}){v.localService ? '' : ' · online'}
              </option>
            ))}
          </optgroup>
        )}
        {groups.en.length > 0 && (
          <optgroup label="── English ──">
            {groups.en.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.lang}){v.localService ? '' : ' · online'}
              </option>
            ))}
          </optgroup>
        )}
        {groups.other.length > 0 && (
          <optgroup label="── Other ──">
            {groups.other.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.lang})
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <button
        onClick={onPreview}
        disabled={previewing}
        className="holo-btn"
        style={{
          background: previewing
            ? 'rgba(var(--state-rgb), 0.25)'
            : 'rgba(var(--state-rgb), 0.12)',
          border: `1px solid rgba(var(--state-rgb), 0.6)`,
          color: 'var(--state-bright)',
          fontFamily: 'var(--font-jetbrains)',
          fontSize: 10,
          letterSpacing: '0.18em',
          padding: '4px 12px',
          textShadow: '0 0 4px rgba(var(--state-rgb), .6)',
        }}
        title="선택한 목소리로 테스트 발화"
      >
        {previewing ? '◦ playing' : '▶ test'}
      </button>
      </div>
    </div>
  );
}
