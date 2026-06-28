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
  activeModal: ModalId;
  toasts: Toast[];

  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;

  openModal: (id: Exclude<ModalId, null>) => void;
  closeModal: () => void;

  addToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  paletteOpen: false,
  activeModal: null,
  toasts: [],

  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),

  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),

  addToast: (toast) =>
    set((s) => ({
      toasts: [...s.toasts, { ...toast, id: `t_${Date.now()}_${s.toasts.length}` }],
    })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
