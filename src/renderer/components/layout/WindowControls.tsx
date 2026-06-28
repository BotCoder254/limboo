/**
 * Custom window controls (minimize / maximize-restore / close) for the frameless
 * window. Wired to the main process through `window.limboo.window.*`; the
 * maximize icon swaps to "restore" in sync with the real window state.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import { cn } from '@/renderer/lib/cn';

export function WindowControls() {
  const [isMax, setIsMax] = useState(false);

  useEffect(() => {
    const api = window.limboo?.window;
    if (!api) return;
    void api.isMaximized().then(setIsMax);
    return api.onMaximizedChange(setIsMax);
  }, []);

  return (
    <div className="no-drag flex h-10 items-stretch">
      <WindowButton label="Minimize" onClick={() => window.limboo?.window.minimize()}>
        <Minus size={15} />
      </WindowButton>
      <WindowButton
        label={isMax ? 'Restore' : 'Maximize'}
        onClick={() => window.limboo?.window.maximize()}
      >
        {isMax ? <Copy size={12} /> : <Square size={12} />}
      </WindowButton>
      <WindowButton label="Close" danger onClick={() => window.limboo?.window.close()}>
        <X size={15} />
      </WindowButton>
    </div>
  );
}

function WindowButton({
  children,
  label,
  onClick,
  danger,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex w-11 items-center justify-center text-muted transition-colors hover:text-fg',
        danger ? 'hover:bg-danger hover:text-white' : 'hover:bg-surface-2',
      )}
    >
      {children}
    </button>
  );
}
