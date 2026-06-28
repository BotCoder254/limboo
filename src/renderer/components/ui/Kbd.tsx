/**
 * Keyboard-shortcut hint chip. Renders one or more keys; on macOS the common
 * modifiers are shown as symbols.
 */
import { cn } from '@/renderer/lib/cn';

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function display(key: string): string {
  if (!IS_MAC) return key;
  return key
    .replace(/Mod|Cmd|Ctrl/i, '⌘')
    .replace(/Alt|Option/i, '⌥')
    .replace(/Shift/i, '⇧');
}

export function Kbd({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <span className={cn('flex items-center gap-1', className)}>
      {keys.map((k) => (
        <kbd
          key={k}
          className="flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1.5 font-mono text-[10px] text-faint"
        >
          {display(k)}
        </kbd>
      ))}
    </span>
  );
}
