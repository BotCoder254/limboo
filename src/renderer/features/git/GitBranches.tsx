/**
 * Branch list + lightweight switching. Switching is guarded: if the working tree
 * is dirty, a pre-flight prompt explains the situation and offers to checkpoint
 * (then switch), force-switch, or cancel — rather than exposing raw git errors.
 */
import { useEffect, useState } from 'react';
import { Check, GitBranch, Plus } from 'lucide-react';
import type { GitBranch as GitBranchModel } from '@shared/types';
import { EmptyState, IconButton } from '@/renderer/components/ui';
import { cn } from '@/renderer/lib/cn';
import { useGitStore } from '@/renderer/stores/useGitStore';
import { useUIStore } from '@/renderer/stores/useUIStore';

export function GitBranches() {
  const branches = useGitStore((s) => s.branches);
  const loadBranches = useGitStore((s) => s.loadBranches);
  const createBranch = useGitStore((s) => s.createBranch);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    void loadBranches();
  }, [loadBranches]);

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed) await createBranch(trimmed);
    setName('');
    setCreating(false);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-1.5 py-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">
          Branches
        </span>
        <IconButton label="New branch" size="sm" onClick={() => setCreating((v) => !v)}>
          <Plus size={13} />
        </IconButton>
      </div>

      {creating && (
        <div className="px-1.5 pb-1">
          <input
            autoFocus
            value={name}
            placeholder="new-branch-name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
              if (e.key === 'Escape') setCreating(false);
            }}
            onBlur={() => void submit()}
            className="w-full rounded-md border border-line bg-surface-2 px-2 py-1 text-[12px] text-fg placeholder:text-faint focus:border-line-strong focus:outline-none"
          />
        </div>
      )}

      {branches.length === 0 ? (
        <EmptyState compact icon={GitBranch} title="No branches" description="" />
      ) : (
        <ul className="flex flex-col gap-0.5">
          {branches.map((b) => (
            <BranchRow key={b.name} branch={b} />
          ))}
        </ul>
      )}
    </div>
  );
}

function BranchRow({ branch }: { branch: GitBranchModel }) {
  const checkout = useGitStore((s) => s.checkout);
  const addToast = useUIStore((s) => s.addToast);
  const createCheckpoint = useGitStore((s) => s.createCheckpoint);
  // Dirty-tree pre-flight prompt (changed-file count), or null.
  const [dirty, setDirty] = useState<number | null>(null);

  const trySwitch = async (force = false) => {
    const result = await checkout(branch.name, force);
    if (result.ok) {
      setDirty(null);
      addToast({ title: `Switched to ${branch.name}`, tone: 'info' });
      return;
    }
    if (result.blockedByDirty) {
      setDirty(result.changedFiles ?? 0);
    } else {
      addToast({ title: 'Could not switch branch', description: result.error ?? '', tone: 'danger' });
    }
  };

  return (
    <li>
      <button
        type="button"
        disabled={branch.current}
        onClick={() => void trySwitch()}
        className={cn(
          'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
          branch.current ? 'bg-surface-2' : 'hover:bg-surface-2',
        )}
      >
        <GitBranch size={13} className={branch.current ? 'text-accent' : 'text-faint'} />
        <span className="min-w-0 flex-1 truncate text-[12px] text-fg">{branch.name}</span>
        {(branch.ahead > 0 || branch.behind > 0) && (
          <span className="font-mono text-[10px] text-faint">
            {branch.ahead > 0 && `↑${branch.ahead}`} {branch.behind > 0 && `↓${branch.behind}`}
          </span>
        )}
        {branch.current && <Check size={13} className="text-accent" />}
      </button>

      {dirty !== null && (
        <div className="mx-2 mb-1 mt-0.5 rounded-md border border-warning/40 bg-warning/10 p-2">
          <p className="text-[11px] leading-relaxed text-fg">
            {dirty} uncommitted change{dirty === 1 ? '' : 's'} would be carried into{' '}
            <span className="font-medium">{branch.name}</span>. Checkpoint first, switch anyway, or
            cancel.
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={async () => {
                await createCheckpoint(`Before switching to ${branch.name}`);
                await trySwitch(true);
              }}
              className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-base hover:opacity-90"
            >
              Checkpoint &amp; switch
            </button>
            <button
              type="button"
              onClick={() => void trySwitch(true)}
              className="rounded-md border border-line px-2 py-0.5 text-[11px] text-muted hover:text-fg"
            >
              Switch anyway
            </button>
            <button
              type="button"
              onClick={() => setDirty(null)}
              className="rounded-md px-2 py-0.5 text-[11px] text-faint hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
