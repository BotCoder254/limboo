/**
 * Frameless title bar (full width, draggable). Left: brand wordmark + a context
 * pill reflecting the active session. Center: a VSCode-style search box that opens
 * the Global Search modal (Cmd/Ctrl+P). Right: settings and the custom window
 * controls. Interactive children opt out of the drag region via `no-drag`.
 */
import { Search, Settings } from 'lucide-react';
import { Wordmark } from '@/renderer/components/brand/Logo';
import { Badge, IconButton, Kbd } from '@/renderer/components/ui';
import { WindowControls } from './WindowControls';
import { WorkspaceSwitcher } from '@/renderer/features/workspace/WorkspaceSwitcher';
import { useUIStore } from '@/renderer/stores/useUIStore';
import { useUpdateStore } from '@/renderer/stores/useUpdateStore';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { useTypewriter } from '@/renderer/hooks/useTypewriter';
import { SEARCH_PLACEHOLDERS } from '@/renderer/features/search/GlobalSearch';

export function TitleBar() {
  const openSearch = useUIStore((s) => s.openSearch);
  const openModal = useUIStore((s) => s.openModal);
  const openOnClick = useSettingsStore((s) => s.settings.search.openOnClick);
  const typed = useTypewriter(SEARCH_PLACEHOLDERS);
  const updateStage = useUpdateStore((s) => s.status.stage);
  // A pending update is anything actionable — lit even after the strip is dismissed
  // so the user can always reach it via Settings → Updates.
  const hasUpdate =
    updateStage === 'available' ||
    updateStage === 'downloading' ||
    updateStage === 'downloaded';

  return (
    <header className="drag-region flex h-10 shrink-0 items-center justify-between border-b border-line bg-surface pl-3 pr-0">
      <div className="flex items-center gap-2">
        <Wordmark />
        <WorkspaceSwitcher />
      </div>

      {/* Centered search box — the universal entry point (VSCode-style). The empty
          space around it stays draggable; only the box opts out via `no-drag`. */}
      <div className="no-drag flex min-w-0 flex-1 justify-center px-4">
        <button
          type="button"
          onClick={() => {
            if (openOnClick) openSearch();
          }}
          aria-disabled={!openOnClick}
          title={openOnClick ? 'Search everything' : 'Press Cmd/Ctrl+P to search'}
          className="no-drag group flex h-6 w-full max-w-md items-center gap-2 rounded-md border border-line bg-surface-2 px-2 text-faint transition-colors hover:border-line-strong hover:text-muted aria-disabled:cursor-default aria-disabled:hover:border-line aria-disabled:hover:text-faint"
        >
          <Search size={13} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left text-[12px]">
            {typed}
            <span className="animate-caret ml-px inline-block text-muted">▏</span>
          </span>
          <Kbd keys={['Mod', 'P']} className="shrink-0" />
        </button>
      </div>

      <div className="flex items-center">
        <div className="no-drag flex items-center gap-1 pr-2">
          <span className="relative">
            <IconButton
              label={hasUpdate ? 'Settings — update available' : 'Settings'}
              onClick={() => openModal('settings')}
            >
              <Settings size={15} />
            </IconButton>
            {hasUpdate && (
              <Badge
                tone="accent"
                className="pointer-events-none absolute -right-0.5 -top-0.5 h-3.5 min-w-3.5 px-0.5 text-[9px]"
              >
                1
              </Badge>
            )}
          </span>
        </div>
        <WindowControls />
      </div>
    </header>
  );
}
