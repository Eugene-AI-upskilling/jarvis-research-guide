'use client';

import { useEffect, useState } from 'react';

/**
 * Popup ("embed") mode — JARVIS opened inside another site's iframe by
 * public/embed.js. URL: /?embed=1&q=<question>
 *
 * Parent → iframe:  postMessage({ type: 'jarvis:ask', question })
 * iframe → parent:  postMessage({ type: 'jarvis:close' })
 */
export function useEmbed(): { embed: boolean; question: string | null } {
  const [state, setState] = useState<{ embed: boolean; question: string | null }>({ embed: false, question: null });
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const embed = p.get('embed') === '1';
    setState({ embed, question: p.get('q') });
    if (embed) document.documentElement.dataset.embed = '1';
  }, []);
  return state;
}

export function isEmbedded(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.embed === '1';
}

export function closeEmbed() {
  window.parent?.postMessage({ type: 'jarvis:close' }, '*');
}
