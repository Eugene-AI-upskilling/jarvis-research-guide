import { create } from 'zustand';
import type { Brief } from '@/lib/brief/types';

export interface BriefCardState {
  id: string;
  question: string;
  status: 'loading' | 'done' | 'failed';
  brief: Brief | null;
  /** Title / one-liner that arrive before the full card (streamed). */
  preview: { title?: string; summary?: string } | null;
  error: string | null;
  /** Offset from the board centre, px. */
  x: number;
  y: number;
  scale: number;
  z: number;
  createdAt: number;
}

interface BriefStore {
  cards: BriefCardState[];
  focusedId: string | null;
  /** Card the hands / wheel act on — the focused card, else the last touched one. */
  activeId: string | null;
  faceMode: boolean;
  topZ: number;

  addCard: (question: string) => string;
  resolveCard: (id: string, brief: Brief) => void;
  previewCard: (id: string, preview: { title?: string; summary?: string }) => void;
  failCard: (id: string, error: string) => void;
  restartCard: (id: string) => void;
  moveCard: (id: string, x: number, y: number) => void;
  scaleCard: (id: string, scale: number) => void;
  bringToFront: (id: string) => void;
  focusCard: (id: string | null) => void;
  removeCard: (id: string) => void;
  clearAll: () => void;
  setFaceMode: (on: boolean) => void;
}

export const MIN_SCALE = 0.45;
export const MAX_SCALE = 3.2;

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

// New cards fan out around the centre so they don't stack exactly.
const SLOTS: Array<[number, number]> = [
  [0, 0],
  [-260, -40],
  [260, -40],
  [-200, 120],
  [200, 120],
  [0, -140],
];

export const useBriefStore = create<BriefStore>((set, get) => ({
  cards: [],
  focusedId: null,
  activeId: null,
  faceMode: false,
  topZ: 1,

  addCard: (question) => {
    const id = `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const { cards, topZ } = get();
    const [x, y] = SLOTS[cards.length % SLOTS.length]!;
    set({
      cards: [
        ...cards,
        {
          id,
          question,
          status: 'loading',
          brief: null,
          preview: null,
          error: null,
          x,
          y,
          scale: 1,
          z: topZ + 1,
          createdAt: Date.now(),
        },
      ],
      topZ: topZ + 1,
      activeId: id,
      // The newest answer always opens large.
      focusedId: id,
    });
    return id;
  },

  resolveCard: (id, brief) =>
    set((s) => ({
      cards: s.cards.map((c) => (c.id === id ? { ...c, status: 'done', brief, error: null } : c)),
    })),

  previewCard: (id, preview) =>
    set((s) => ({ cards: s.cards.map((c) => (c.id === id ? { ...c, preview } : c)) })),

  failCard: (id, error) =>
    set((s) => ({
      cards: s.cards.map((c) => (c.id === id ? { ...c, status: 'failed', error } : c)),
    })),

  restartCard: (id) =>
    set((s) => ({
      cards: s.cards.map((c) => (c.id === id ? { ...c, status: 'loading', error: null } : c)),
    })),

  moveCard: (id, x, y) =>
    set((s) => ({ cards: s.cards.map((c) => (c.id === id ? { ...c, x, y } : c)) })),

  scaleCard: (id, scale) =>
    set((s) => ({
      cards: s.cards.map((c) => (c.id === id ? { ...c, scale: clampScale(scale) } : c)),
    })),

  bringToFront: (id) =>
    set((s) => ({
      topZ: s.topZ + 1,
      activeId: id,
      cards: s.cards.map((c) => (c.id === id ? { ...c, z: s.topZ + 1 } : c)),
    })),

  focusCard: (id) => {
    if (id) get().bringToFront(id);
    set({ focusedId: id });
  },

  removeCard: (id) =>
    set((s) => ({
      cards: s.cards.filter((c) => c.id !== id),
      focusedId: s.focusedId === id ? null : s.focusedId,
      activeId: s.activeId === id ? null : s.activeId,
    })),

  clearAll: () => set({ cards: [], focusedId: null, activeId: null }),

  setFaceMode: (on) => set({ faceMode: on }),
}));
