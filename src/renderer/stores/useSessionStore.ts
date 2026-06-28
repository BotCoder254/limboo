/**
 * Session store — the list of development workspaces shown in the left sidebar.
 *
 * Phase 1 has no persistence layer or agent yet, so sessions live only in
 * memory and start EMPTY (no mock data). Creating a session is wired to the
 * "New Session" action; later phases will back this with the SQLite-backed
 * Session Manager over IPC without changing the component API.
 */
import { create } from 'zustand';
import type { Session } from '@shared/types';

interface SessionState {
  sessions: Session[];
  selectedId: string | null;
  createSession: () => string;
  selectSession: (id: string) => void;
  removeSession: (id: string) => void;
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  selectedId: null,

  createSession: () => {
    const id = newId();
    const session: Session = {
      id,
      title: 'New session',
      branch: 'main',
      status: 'active',
      updatedAt: Date.now(),
      adds: 0,
      dels: 0,
      unread: 0,
      pinned: false,
    };
    set((s) => ({ sessions: [session, ...s.sessions], selectedId: id }));
    return id;
  },

  selectSession: (id) => set({ selectedId: id }),

  removeSession: (id) =>
    set((s) => {
      const sessions = s.sessions.filter((session) => session.id !== id);
      const selectedId =
        s.selectedId === id ? (sessions[0]?.id ?? null) : s.selectedId;
      return { sessions, selectedId };
    }),
}));
