/**
 * Command palette — a centered, filterable overlay (Cmd/Ctrl+K) listing every
 * palette command. Fully keyboard-navigable: type to filter, ↑/↓ to move, Enter
 * to run, Esc to dismiss. Driven by the UI store.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { paletteCommands } from '@/renderer/lib/commands';
import type { Command } from '@/renderer/lib/commands';
import { Kbd } from '@/renderer/components/ui';
import { cn } from '@/renderer/lib/cn';
import { useUIStore } from '@/renderer/stores/useUIStore';

export function CommandPalette() {
  const open = useUIStore((s) => s.paletteOpen);
  const close = useUIStore((s) => s.closePalette);

  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo<Command[]>(() => {
    const all = paletteCommands();
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((c) => c.title.toLowerCase().includes(q));
  }, [query]);

  // Reset state each time the palette opens; focus the input.
  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (index > results.length - 1) setIndex(Math.max(0, results.length - 1));
  }, [results, index]);

  if (!open) return null;

  const run = (command: Command) => {
    command.run();
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const command = results[index];
      if (command) run(command);
    }
  };

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh]"
      onMouseDown={close}
    >
      <div
        className="animate-pop-in flex w-full max-w-xl flex-col overflow-hidden rounded-md border border-line-strong bg-elevated shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search size={15} className="shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a command…"
            className="flex-1 bg-transparent py-3 text-[13px] text-fg placeholder:text-faint focus:outline-none"
          />
          <Kbd keys={['Esc']} />
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-faint">No matching commands</div>
          ) : (
            results.map((command, i) => (
              <button
                key={command.id}
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => run(command)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] transition-colors',
                  i === index ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
                )}
              >
                <span className="flex-1 truncate">{command.title}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-faint">
                  {command.section}
                </span>
                {command.keys && <Kbd keys={command.keys} />}
                {i === index && <CornerDownLeft size={13} className="shrink-0 text-faint" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
