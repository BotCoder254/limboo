/**
 * TerminalPanel — the full-height integrated terminal workspace. Rendered as the
 * "Terminal" tab inside the right activity drawer (see ActivityDrawer). Owns the
 * terminal tab strip, the active xterm view, and the agent-command mirror strip.
 * Visual language inherits the activity drawer (h-9 header, hairline borders).
 *
 * The composer is NOT part of this panel — it stays anchored in the center
 * column so the user can keep prompting while terminals run.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, TerminalSquare, X } from 'lucide-react';
import { EmptyState, IconButton } from '@/renderer/components/ui';
import { cn } from '@/renderer/lib/cn';
import { useWorkspaceStore } from '@/renderer/stores/useWorkspaceStore';
import { useLayoutStore } from '@/renderer/stores/useLayoutStore';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { useTerminalStore } from '@/renderer/stores/useTerminalStore';
import { TerminalView } from './TerminalView';
import { AgentCommandBlock } from './AgentCommandBlock';

/**
 * Stable empty references. Zustand v5 selectors must return a referentially
 * stable value when "missing" — returning a fresh `[]`/`{}` literal each render
 * makes useSyncExternalStore loop ("Maximum update depth exceeded").
 */
const EMPTY_TERMINALS: import('@shared/types').TerminalSession[] = [];
const EMPTY_COMMANDS: import('@shared/types').TerminalCommandRecord[] = [];

export function TerminalPanel() {
  const workspaceId = useWorkspaceStore((s) => s.activeId);
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);
  const closeTerminal = () => setActiveTab(null);
  const [showCommands, setShowCommands] = useState(false);

  const terminals = useTerminalStore((s) =>
    workspaceId ? s.byWorkspace[workspaceId] ?? EMPTY_TERMINALS : EMPTY_TERMINALS,
  );
  const activeId = useTerminalStore((s) =>
    workspaceId ? s.activeByWorkspace[workspaceId] ?? null : null,
  );
  const commands = useTerminalStore((s) =>
    activeId ? s.commandsByTerminal[activeId] ?? EMPTY_COMMANDS : EMPTY_COMMANDS,
  );
  const load = useTerminalStore((s) => s.load);
  const create = useTerminalStore((s) => s.create);
  const kill = useTerminalStore((s) => s.kill);
  const rename = useTerminalStore((s) => s.rename);
  const setActive = useTerminalStore((s) => s.setActive);
  const confirmKill = useSettingsStore((s) => s.settings.agent.terminal.confirmKill);

  // Close a terminal, confirming first when it still has a running process.
  const closeOne = (id: string) => {
    if (!workspaceId) return;
    const t = terminals.find((x) => x.id === id);
    if (confirmKill && t?.status === 'running') {
      const ok = window.confirm(`Close “${t.title}”? Its running process will be terminated.`);
      if (!ok) return;
    }
    void kill(workspaceId, id);
  };

  // Auto-create the first terminal once per workspace so opening the panel
  // immediately reveals a shell (guarded so re-renders never spawn duplicates).
  const autoCreated = useRef<Set<string>>(new Set());

  // Load the workspace's terminals whenever the active workspace changes, then
  // open one if the workspace has none yet.
  useEffect(() => {
    if (!workspaceId) return;
    void (async () => {
      await load(workspaceId);
      const list = useTerminalStore.getState().byWorkspace[workspaceId] ?? [];
      if (list.length === 0 && !autoCreated.current.has(workspaceId)) {
        autoCreated.current.add(workspaceId);
        await create(workspaceId);
      }
    })();
  }, [workspaceId, load, create]);

  if (!workspaceId) {
    return (
      <Shell onClose={closeTerminal}>
        <EmptyState
          compact
          icon={TerminalSquare}
          title="No workspace"
          description="Open a workspace to use the integrated terminal."
        />
      </Shell>
    );
  }

  return (
    <Shell
      onClose={closeTerminal}
      tabs={
        <TabStrip
          terminals={terminals}
          activeId={activeId}
          onSelect={(id) => setActive(workspaceId, id)}
          onClose={closeOne}
          onRename={(id, title) => void rename(workspaceId, id, title)}
        />
      }
      onNew={() => void create(workspaceId)}
    >
      {terminals.length === 0 ? (
        <EmptyState
          compact
          icon={TerminalSquare}
          title="No terminals"
          description="Open a shell scoped to this workspace."
          action={
            <button
              type="button"
              onClick={() => void create(workspaceId)}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-base transition-opacity hover:opacity-90"
            >
              <Plus size={13} />
              New terminal
            </button>
          }
        />
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          {commands.length > 0 && (
            <div className="flex shrink-0 flex-col border-b border-line">
              <button
                type="button"
                onClick={() => setShowCommands((v) => !v)}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-faint transition-colors hover:text-muted"
              >
                {showCommands ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                Agent commands ({commands.length})
              </button>
              {showCommands && (
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto px-2 pb-2">
                  {commands.map((rec) => (
                    <AgentCommandBlock key={rec.callId} record={rec} />
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Keep one mounted xterm per active terminal; remount on id change. */}
          <div className="min-h-0 flex-1 bg-base p-2">
            {activeId && (
              <TerminalView key={activeId} workspaceId={workspaceId} terminalId={activeId} />
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------------ */

function Shell({
  children,
  tabs,
  onNew,
  onClose,
}: {
  children: React.ReactNode;
  tabs?: React.ReactNode;
  onNew?: () => void;
  onClose: () => void;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col border-l border-line bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line pl-2 pr-1.5">
        <TerminalSquare size={13} className="shrink-0 text-muted" />
        <div className="min-w-0 flex-1 overflow-x-auto">{tabs}</div>
        {onNew && (
          <IconButton label="New terminal" size="sm" onClick={onNew}>
            <Plus size={14} />
          </IconButton>
        )}
        <IconButton label="Close terminal" size="sm" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function TabStrip({
  terminals,
  activeId,
  onSelect,
  onClose,
  onRename,
}: {
  terminals: import('@shared/types').TerminalSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-0.5">
      {terminals.map((t) => {
        const isActive = t.id === activeId;
        const exited = t.status !== 'running';
        return (
          <div
            key={t.id}
            className={cn(
              'group flex items-center gap-1 rounded-md px-2 py-1 text-[12px] transition-colors',
              isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            {editingId === t.id ? (
              <input
                autoFocus
                defaultValue={t.title}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v) onRename(t.id, v);
                  setEditingId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="w-24 bg-transparent text-[12px] text-fg outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => onSelect(t.id)}
                onDoubleClick={() => setEditingId(t.id)}
                className="max-w-[10rem] truncate"
                title={`${t.title}${exited ? ' (exited)' : ''}`}
              >
                <span className={cn(exited && 'line-through opacity-60')}>{t.title}</span>
              </button>
            )}
            <button
              type="button"
              aria-label={`Close ${t.title}`}
              onClick={() => onClose(t.id)}
              className="rounded p-0.5 text-faint opacity-0 transition-opacity hover:text-fg group-hover:opacity-100"
            >
              <X size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
