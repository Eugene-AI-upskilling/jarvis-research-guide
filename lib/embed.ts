'use client';

import { useEffect, useState } from 'react';

/**
 * Embed modes — JARVIS inside another site's iframe.
 *
 * popup: opened by public/embed.js. URL: /?embed=1&q=<question>
 *   Parent → iframe:  postMessage({ type: 'jarvis:ask', question })
 *   iframe → parent:  postMessage({ type: 'jarvis:close' })
 *
 * hero: Insight Lab home Hero (URL: /?embed=hero). Only the holographic core is drawn;
 *   the host page owns the question box and the answer engine (Eugene research first,
 *   web fallback), and drives the core's state:
 *   Parent → iframe:  postMessage({ type: 'jarvis:state', state: 'STANDBY'|'LISTENING'|'THINKING'|'SPEAKING'|'ERROR' })
 *   iframe → parent:  postMessage({ type: 'jarvis:ready' })
 */
export type EmbedMode = 'popup' | 'hero' | null;

export function useEmbed(): { embed: boolean; mode: EmbedMode; question: string | null } {
  const [state, setState] = useState<{ embed: boolean; mode: EmbedMode; question: string | null }>({
    embed: false,
    mode: null,
    question: null,
  });
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const v = p.get('embed');
    const mode: EmbedMode = v === 'hero' ? 'hero' : v === '1' ? 'popup' : null;
    setState({ embed: mode !== null, mode, question: p.get('q') });
    if (mode) document.documentElement.dataset.embed = mode === 'hero' ? 'hero' : '1';
  }, []);
  return state;
}

export function isEmbedded(): boolean {
  return typeof document !== 'undefined' && !!document.documentElement.dataset.embed;
}

export function closeEmbed() {
  window.parent?.postMessage({ type: 'jarvis:close' }, '*');
}
