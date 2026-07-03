/**
 * Global in-app keyboard shortcuts. Maps key combos declared on commands (in
 * `lib/commands.ts`) to their `run()` handlers, plus a couple of always-on keys
 * (Escape to dismiss overlays). `Mod` resolves to Cmd on macOS, Ctrl elsewhere.
 *
 * Typing into inputs/textareas is respected: shortcuts that are a bare key are
 * ignored while a field is focused; modifier combos still fire.
 */
import { useEffect } from 'react';
import { COMMANDS } from '@/renderer/lib/commands';
import { useUIStore } from '@/renderer/stores/useUIStore';

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function matches(e: KeyboardEvent, keys: string[]): boolean {
  const wantMod = keys.includes('Mod');
  // A literal `Ctrl` always means the Control key — even on macOS, where tab
  // cycling (Ctrl+Tab) conventionally uses Control rather than Command.
  const wantCtrl = keys.includes('Ctrl');
  const wantShift = keys.includes('Shift');
  const wantAlt = keys.includes('Alt');
  const main = keys[keys.length - 1].toLowerCase();

  if (wantCtrl) {
    if (!e.ctrlKey) return false;
  } else {
    const hasMod = IS_MAC ? e.metaKey : e.ctrlKey;
    if (wantMod !== hasMod) return false;
  }
  if (wantShift !== e.shiftKey) return false;
  if (wantAlt !== e.altKey) return false;
  return e.key.toLowerCase() === main;
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Escape closes the palette / active modal first.
      if (e.key === 'Escape') {
        const ui = useUIStore.getState();
        if (ui.paletteOpen) {
          ui.closePalette();
          return;
        }
        if (ui.searchOpen) {
          ui.closeSearch();
          return;
        }
        if (ui.activeModal) {
          ui.closeModal();
          return;
        }
      }

      for (const command of COMMANDS) {
        if (command.keys && matches(e, command.keys)) {
          e.preventDefault();
          command.run();
          return;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
