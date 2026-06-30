/**
 * Frameless title bar (full width, draggable). Left: brand wordmark + a context
 * pill reflecting the active session. Right: search (opens the command palette),
 * settings, and the custom window controls. Interactive children opt out of the
 * drag region via `no-drag`.
 */
import { Search, Settings } from 'lucide-react';
import { Wordmark } from '@/renderer/components/brand/Logo';
import { Badge, IconButton } from '@/renderer/components/ui';
import { WindowControls } from './WindowControls';
import { WorkspaceSwitcher } from '@/renderer/features/workspace/WorkspaceSwitcher';
import { useUIStore } from '@/renderer/stores/useUIStore';
import { useUpdateStore } from '@/renderer/stores/useUpdateStore';

export function TitleBar() {
  const openPalette = useUIStore((s) => s.openPalette);
  const openModal = useUIStore((s) => s.openModal);
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

      <div className="flex items-center">
        <div className="no-drag flex items-center gap-1 pr-2">
          <IconButton label="Search (Cmd/Ctrl+K)" onClick={openPalette}>
            <Search size={15} />
          </IconButton>
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
