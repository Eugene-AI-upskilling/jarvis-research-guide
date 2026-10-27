import { create } from 'zustand';

export type JarvisState =
  | 'BOOTING'
  | 'STANDBY'
  | 'LISTENING'
  | 'THINKING'
  | 'SPEAKING'
  | 'ERROR';

export interface TranscriptEntry {
  id: string;
  speaker: 'user' | 'jarvis';
  text: string;
  ts: number;
}

export interface TaskEntry {
  id: string;
  label: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  ts: number;
}

export interface CodeTaskFile {
  path: string;
  action: 'create' | 'edit' | 'read' | 'delete';
}

export interface CodeTaskChunk {
  id: string;
  path: string;
  action: 'write' | 'edit';
  content: string;
  previous?: string;
  ts: number;
}

export interface CodeTaskState {
  status: 'idle' | 'running' | 'done' | 'failed';
  task: string | null;
  workdir: string | null;
  workspace: string | null;
  steps: string[];
  files: CodeTaskFile[];
  chunks: CodeTaskChunk[];
  shellCommands: string[];
  blockedCommands: Array<{ command: string; reason: string }>;
  summary: string | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface ResearchSource {
  title: string;
  url: string;
}

export interface ResearchTaskState {
  status: 'idle' | 'running' | 'done' | 'failed';
  query: string | null;
  summary: string | null;
  sources: ResearchSource[];
  searchQueries: string[];
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

interface JarvisStore {
  state: JarvisState;
  prevState: JarvisState | null;
  errorMessage: string | null;
  transcript: TranscriptEntry[];
  tasks: TaskEntry[];
  voiceAmplitude: number;
  codeTask: CodeTaskState;
  researchTask: ResearchTaskState;

  setState: (next: JarvisState) => void;
  setError: (message: string | null) => void;
  pushTranscript: (entry: Omit<TranscriptEntry, 'id' | 'ts'>) => void;
  clearTranscript: () => void;
  upsertTask: (task: Omit<TaskEntry, 'ts'> & { ts?: number }) => void;
  removeTask: (id: string) => void;
  setVoiceAmplitude: (value: number) => void;

  startCodeTask: (task: string, workdir: string, workspace: string) => void;
  pushCodeStep: (label: string) => void;
  pushCodeFile: (file: CodeTaskFile) => void;
  pushCodeChunk: (chunk: Omit<CodeTaskChunk, 'id' | 'ts'>) => void;
  pushCodeShell: (cmd: string) => void;
  pushCodeBlocked: (cmd: string, reason: string) => void;
  finishCodeTask: (summary: string, ok: boolean) => void;
  failCodeTask: (message: string) => void;
  resetCodeTask: () => void;

  startResearchTask: (query: string) => void;
  pushResearchSearchQuery: (q: string) => void;
  pushResearchSource: (source: ResearchSource) => void;
  finishResearchTask: (summary: string, ok: boolean) => void;
  failResearchTask: (message: string) => void;
  resetResearchTask: () => void;
}

const INITIAL_CODE_TASK: CodeTaskState = {
  status: 'idle',
  task: null,
  workdir: null,
  workspace: null,
  steps: [],
  files: [],
  chunks: [],
  shellCommands: [],
  blockedCommands: [],
  summary: null,
  error: null,
  startedAt: null,
  finishedAt: null,
};

const INITIAL_RESEARCH_TASK: ResearchTaskState = {
  status: 'idle',
  query: null,
  summary: null,
  sources: [],
  searchQueries: [],
  error: null,
  startedAt: null,
  finishedAt: null,
};

const VALID_TRANSITIONS: Record<JarvisState, JarvisState[]> = {
  BOOTING: ['STANDBY', 'ERROR'],
  STANDBY: ['LISTENING', 'THINKING', 'ERROR'],
  LISTENING: ['THINKING', 'STANDBY', 'ERROR'],
  THINKING: ['SPEAKING', 'STANDBY', 'ERROR'],
  SPEAKING: ['LISTENING', 'STANDBY', 'ERROR'],
  ERROR: ['STANDBY'],
};

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export const useJarvisStore = create<JarvisStore>((set, get) => ({
  state: 'BOOTING',
  prevState: null,
  errorMessage: null,
  transcript: [],
  tasks: [],
  voiceAmplitude: 0,
  codeTask: INITIAL_CODE_TASK,
  researchTask: INITIAL_RESEARCH_TASK,

  setState: (next) => {
    const current = get().state;
    if (current === next) return;
    const allowed = VALID_TRANSITIONS[current];
    if (!allowed.includes(next)) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          `[jarvis-store] illegal transition: ${current} → ${next}`,
        );
      }
      return;
    }
    set({ state: next, prevState: current });
  },

  setError: (message) =>
    set((s) => ({
      state: message ? 'ERROR' : s.state,
      prevState: message ? s.state : s.prevState,
      errorMessage: message,
    })),

  pushTranscript: (entry) =>
    set((s) => ({
      transcript: [
        ...s.transcript.slice(-49),
        { id: newId(), ts: Date.now(), ...entry },
      ],
    })),

  clearTranscript: () => set({ transcript: [] }),

  upsertTask: (task) =>
    set((s) => {
      const ts = task.ts ?? Date.now();
      const existing = s.tasks.findIndex((t) => t.id === task.id);
      if (existing >= 0) {
        const next = s.tasks.slice();
        next[existing] = { ...next[existing]!, ...task, ts };
        return { tasks: next };
      }
      return { tasks: [...s.tasks, { ...task, ts }] };
    }),

  removeTask: (id) =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),

  setVoiceAmplitude: (value) =>
    set({ voiceAmplitude: Math.min(1, Math.max(0, value)) }),

  startCodeTask: (task, workdir, workspace) =>
    set({
      codeTask: {
        ...INITIAL_CODE_TASK,
        status: 'running',
        task,
        workdir,
        workspace,
        startedAt: Date.now(),
      },
    }),

  pushCodeStep: (label) =>
    set((s) => ({
      codeTask: {
        ...s.codeTask,
        steps: [...s.codeTask.steps.slice(-19), label],
      },
    })),

  pushCodeFile: (file) =>
    set((s) => {
      const filtered = s.codeTask.files.filter(
        (f) => !(f.path === file.path && f.action === file.action),
      );
      return {
        codeTask: { ...s.codeTask, files: [...filtered, file].slice(-12) },
      };
    }),

  pushCodeChunk: (chunk) =>
    set((s) => ({
      codeTask: {
        ...s.codeTask,
        chunks: [
          ...s.codeTask.chunks.slice(-19),
          { id: newId(), ts: Date.now(), ...chunk },
        ],
      },
    })),

  pushCodeShell: (cmd) =>
    set((s) => ({
      codeTask: {
        ...s.codeTask,
        shellCommands: [...s.codeTask.shellCommands.slice(-9), cmd],
      },
    })),

  pushCodeBlocked: (cmd, reason) =>
    set((s) => ({
      codeTask: {
        ...s.codeTask,
        blockedCommands: [
          ...s.codeTask.blockedCommands.slice(-4),
          { command: cmd, reason },
        ],
      },
    })),

  finishCodeTask: (summary, ok) =>
    set((s) => ({
      codeTask: {
        ...s.codeTask,
        status: ok ? 'done' : 'failed',
        summary,
        finishedAt: Date.now(),
      },
    })),

  failCodeTask: (message) =>
    set((s) => ({
      codeTask: {
        ...s.codeTask,
        status: 'failed',
        error: message,
        finishedAt: Date.now(),
      },
    })),

  resetCodeTask: () => set({ codeTask: INITIAL_CODE_TASK }),

  startResearchTask: (query) =>
    set({
      researchTask: {
        ...INITIAL_RESEARCH_TASK,
        status: 'running',
        query,
        startedAt: Date.now(),
      },
    }),

  pushResearchSearchQuery: (q) =>
    set((s) => ({
      researchTask: {
        ...s.researchTask,
        searchQueries: [...s.researchTask.searchQueries, q].slice(-5),
      },
    })),

  pushResearchSource: (source) =>
    set((s) => {
      if (s.researchTask.sources.some((x) => x.url === source.url)) {
        return {};
      }
      return {
        researchTask: {
          ...s.researchTask,
          sources: [...s.researchTask.sources, source].slice(-8),
        },
      };
    }),

  finishResearchTask: (summary, ok) =>
    set((s) => ({
      researchTask: {
        ...s.researchTask,
        status: ok ? 'done' : 'failed',
        summary,
        finishedAt: Date.now(),
      },
    })),

  failResearchTask: (message) =>
    set((s) => ({
      researchTask: {
        ...s.researchTask,
        status: 'failed',
        error: message,
        finishedAt: Date.now(),
      },
    })),

  resetResearchTask: () => set({ researchTask: INITIAL_RESEARCH_TASK }),
}));
