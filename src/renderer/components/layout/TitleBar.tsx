/**
 * Frameless title bar (full width, draggable). Left: brand wordmark + a context
 * pill reflecting the active session. Right: search (opens the command palette),
 * settings, and the custom window controls. Interactive children opt out of the
 * drag region via `no-drag`.
 */
import { Search, Settings } from 'lucide-react';
import { Wordmark } from '@/renderer/components/brand/Logo';
import { IconButton } from '@/renderer/components/ui';
import { WindowControls } from './WindowControls';
import { WorkspaceSwitcher } from '@/renderer/features/workspace/WorkspaceSwitcher';
import { useUIStore } from '@/renderer/stores/useUIStore';

export function TitleBar() {
  const openPalette = useUIStore((s) => s.openPalette);
  const openModal = useUIStore((s) => s.openModal);

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
          <IconButton label="Settings" onClick={() => openModal('settings')}>
            <Settings size={15} />
          </IconButton>
        </div>
        <WindowControls />
      </div>
    </header>
  );
}
