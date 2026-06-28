/**
 * Layout store — the live, fast-updating UI layout (sidebar widths + which
 * activity drawer tab is open). Width changes during a resize drag stay local
 * for smoothness and are persisted to the main-process settings file
 * (debounced) so the layout is restored on the next launch.
 */
import { create } from 'zustand';
import type { ActivityTab } from '@shared/types';
import { LAYOUT_LIMITS, clamp } from '@shared/constants';
import { debounce } from '@/renderer/lib/debounce';

interface LayoutState {
  leftWidth: number;
  rightWidth: number;
  /** Open drawer tab, or null when the drawer is collapsed. */
  activeTab: ActivityTab | null;
  /** Remembers the last open tab so "toggle sidebar" can restore it. */
  lastTab: ActivityTab;
  /** Whether the left sessions sidebar is collapsed to a thin rail. */
  sessionsCollapsed: boolean;

  seed: (layout: {
    leftWidth: number;
    rightWidth: number;
    activeTab: ActivityTab | null;
    sessionsCollapsed?: boolean;
  }) => void;
  setLeftWidth: (width: number) => void;
  setRightWidth: (width: number) => void;
  setActiveTab: (tab: ActivityTab | null) => void;
  toggleTab: (tab: ActivityTab) => void;
  /** Collapse the drawer if open, otherwise reopen the last-used tab. */
  toggleDrawer: () => void;
  /** Collapse / expand the left sessions sidebar. */
  setSessionsCollapsed: (collapsed: boolean) => void;
}

const persist = debounce((layout: Partial<LayoutState>) => {
  void window.limboo?.settings.set({
    layout: {
      leftWidth: layout.leftWidth,
      rightWidth: layout.rightWidth,
      activeTab: layout.activeTab,
      sessionsCollapsed: layout.sessionsCollapsed,
    },
  });
}, 300);

export const useLayoutStore = create<LayoutState>((set, get) => ({
  leftWidth: LAYOUT_LIMITS.left.default,
  rightWidth: LAYOUT_LIMITS.right.default,
  activeTab: 'files',
  lastTab: 'files',
  sessionsCollapsed: false,

  seed: (layout) =>
    set({
      leftWidth: layout.leftWidth,
      rightWidth: layout.rightWidth,
      activeTab: layout.activeTab,
      lastTab: layout.activeTab ?? 'files',
      sessionsCollapsed: layout.sessionsCollapsed ?? false,
    }),

  setLeftWidth: (width) => {
    const leftWidth = clamp(width, LAYOUT_LIMITS.left.min, LAYOUT_LIMITS.left.max);
    set({ leftWidth });
    persist(get());
  },

  setRightWidth: (width) => {
    const rightWidth = clamp(width, LAYOUT_LIMITS.right.min, LAYOUT_LIMITS.right.max);
    set({ rightWidth });
    persist(get());
  },

  setActiveTab: (tab) => {
    set(tab ? { activeTab: tab, lastTab: tab } : { activeTab: null });
    persist(get());
  },

  toggleTab: (tab) => {
    const next = get().activeTab === tab ? null : tab;
    set(next ? { activeTab: next, lastTab: next } : { activeTab: null });
    persist(get());
  },

  toggleDrawer: () => {
    const { activeTab, lastTab } = get();
    set(activeTab ? { activeTab: null } : { activeTab: lastTab, lastTab });
    persist(get());
  },

  setSessionsCollapsed: (collapsed) => {
    set({ sessionsCollapsed: collapsed });
    persist(get());
  },
}));
