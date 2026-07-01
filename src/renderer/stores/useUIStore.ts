/**
 * UI store — transient interface state that isn't persisted: command palette
 * visibility, the active modal (e.g. Settings), and toast notifications.
 */
import { create } from 'zustand';

export type ModalId = 'settings' | null;

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: 'info' | 'success' | 'warning' | 'danger';
}

interface UIState {
  paletteOpen: boolean;
  searchOpen: boolean;
  activeModal: ModalId;
  toasts: Toast[];

  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;

  openSearch: () => void;
  closeSearch: () => void;
  toggleSearch: () => void;

  openModal: (id: Exclude<ModalId, null>) => void;
  closeModal: () => void;

  addToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  paletteOpen: false,
  searchOpen: false,
  activeModal: null,
  toasts: [],

  // The command palette and Global Search are mutually exclusive overlays.
  openPalette: () => set({ paletteOpen: true, searchOpen: false }),
  closePalette: () => set({ paletteOpen: false }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen, searchOpen: false })),

  openSearch: () => set({ searchOpen: true, paletteOpen: false }),
  closeSearch: () => set({ searchOpen: false }),
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen, paletteOpen: false })),

  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),

  addToast: (toast) =>
    set((s) => ({
      toasts: [...s.toasts, { ...toast, id: `t_${Date.now()}_${s.toasts.length}` }],
    })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
