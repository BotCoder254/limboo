/**
 * Settings — a professional two-pane modal: a searchable, icon-led navigation
 * rail on the left and the active category's panel on the right. The catalog
 * (`catalog.tsx`) drives the nav, routing, and deep search; panels write through
 * the existing stores, so this layer is purely presentational.
 *
 * Dark-only by product rule: no theme toggle, no light palette, no gradients.
 */
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { AppSettings } from '@shared/types';
import { useUIStore } from '@/renderer/stores/useUIStore';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { SETTINGS_CATALOG } from './catalog';
import { SettingsNav } from './SettingsNav';
import { SettingsHighlightContext } from './controls';
import { diffSettings } from './diffSettings';
import { UnsavedSettingsDialog } from './UnsavedSettingsDialog';

const DEFAULT_CATEGORY = 'general';

export function SettingsModal() {
  const open = useUIStore((s) => s.activeModal === 'settings');
  const close = useUIStore((s) => s.closeModal);

  const [activeId, setActiveId] = useState(DEFAULT_CATEGORY);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Snapshot of settings captured when the modal opened — the "saved baseline"
  // used to detect (and revert) changes made during this session.
  const baselineRef = useRef<AppSettings | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [changes, setChanges] = useState<string[]>([]);

  // Reset to a clean state each time the modal is opened.
  useEffect(() => {
    if (open) {
      setActiveId(DEFAULT_CATEGORY);
      setQuery('');
      setHighlight(null);
      setConfirmOpen(false);
      // Capture the baseline (layout is persisted separately and excluded below).
      baselineRef.current = useSettingsStore.getState().settings;
    }
  }, [open]);

  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);

  // Compute the pending changes vs. the opening baseline (excluding layout, which
  // the modal never edits and which persists on its own).
  const pendingChanges = (): string[] => {
    const base = baselineRef.current;
    if (!base) return [];
    return diffSettings(base, useSettingsStore.getState().settings).filter(
      (p) => !p.startsWith('layout'),
    );
  };

  // Ambiguous close (X / backdrop / Escape): confirm if there are pending changes.
  const attemptClose = () => {
    const diff = pendingChanges();
    if (diff.length > 0) {
      setChanges(diff);
      setConfirmOpen(true);
    } else {
      close();
    }
  };

  const keepEditing = () => setConfirmOpen(false);

  // Revert every changed leaf back to the opening baseline, then close. The full
  // baseline is a complete override for the deep-merge in `update`; layout cannot
  // change while the modal is open, so re-applying it is a harmless no-op.
  const discardChanges = () => {
    const base = baselineRef.current;
    if (base) void useSettingsStore.getState().update(base);
    setConfirmOpen(false);
    close();
  };

  // Escape closes via the confirm path (the nested dialog handles its own Escape
  // in capture phase, so this only fires when the confirm is not open).
  useEffect(() => {
    if (!open || confirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') attemptClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, confirmOpen]);

  if (!open) return null;

  const selectCategory = (id: string) => {
    setActiveId(id);
    setHighlight(null);
  };

  const selectField = (categoryId: string, fieldId: string) => {
    setActiveId(categoryId);
    setHighlight(fieldId);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlight(null), 1600);
  };

  const category = SETTINGS_CATALOG.find((c) => c.id === activeId) ?? SETTINGS_CATALOG[0];
  const Panel = category.Panel;

  return (
    <>
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onMouseDown={attemptClose}
    >
      <div
        className="animate-pop-in flex h-[78vh] max-h-[640px] w-full max-w-3xl overflow-hidden rounded-md border border-line-strong bg-elevated shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <SettingsNav
          query={query}
          setQuery={setQuery}
          activeId={activeId}
          onSelectCategory={selectCategory}
          onSelectField={selectField}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
            <span className="text-[13px] font-semibold text-fg">{category.label}</span>
            <button
              type="button"
              aria-label="Close"
              onClick={attemptClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <X size={15} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <SettingsHighlightContext.Provider value={highlight}>
              <Panel />
            </SettingsHighlightContext.Provider>
          </div>

          <div className="flex h-12 shrink-0 items-center justify-end border-t border-line px-4">
            <button
              type="button"
              onClick={close}
              className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-base transition-opacity hover:opacity-90"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>

    {confirmOpen && (
      <UnsavedSettingsDialog
        changes={changes}
        onKeepEditing={keepEditing}
        onDiscard={discardChanges}
      />
    )}
    </>
  );
}
