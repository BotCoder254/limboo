/**
 * In-app "Create workspace" panel. Replaces the old behaviour where clicking
 * "Create workspace" immediately opened the native OS folder dialog — instead the
 * launcher switches to this form, so the user stays inside the app. It collects a
 * folder name, a parent location (the only place a native picker is used, behind an
 * explicit "Browse" button), and an optional "Initialize git repository" toggle,
 * then calls the validated `workspace:createNew` IPC which creates the directory and
 * enters the new workspace.
 *
 * All filesystem work + authoritative validation happen in the main process; this
 * form only does light, friendly pre-checks to guide input.
 */
import { useMemo, useState } from 'react';
import { ArrowLeft, FolderSearch, GitBranch, FolderPlus } from 'lucide-react';
import { cn } from '@/renderer/lib/cn';
import { Logo } from '@/renderer/components/brand/Logo';
import { useWorkspaceStore } from '@/renderer/stores/useWorkspaceStore';
import { useUIStore } from '@/renderer/stores/useUIStore';
import { WorkspaceActionButton } from './WorkspaceActionButton';

/** Mirror of the main-process name guard, for immediate inline feedback only. */
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:"/\\|?*\x00-\x1f\x7f]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function nameError(name: string): string | null {
  const n = name.trim();
  if (n.length === 0) return null; // empty = just disabled, not an error yet
  if (n === '.' || n === '..') return 'Not a valid folder name.';
  if (ILLEGAL.test(n)) return 'Remove characters like / \\ : * ? " < > |.';
  if (/[. ]$/.test(n)) return 'Cannot end with a space or a dot.';
  if (RESERVED.test(n)) return 'That is a reserved system name.';
  return null;
}

export function WorkspaceCreatePanel() {
  const pickDirectory = useWorkspaceStore((s) => s.pickDirectory);
  const createNew = useWorkspaceStore((s) => s.createNew);
  const setLauncherView = useWorkspaceStore((s) => s.setLauncherView);
  const addToast = useUIStore((s) => s.addToast);

  const [name, setName] = useState('');
  const [parentPath, setParentPath] = useState('');
  const [initGit, setInitGit] = useState(true);
  const [busy, setBusy] = useState(false);

  const err = useMemo(() => nameError(name), [name]);
  const canCreate = name.trim().length > 0 && parentPath.trim().length > 0 && !err && !busy;

  const preview = useMemo(() => {
    const p = parentPath.trim().replace(/[/\\]+$/, '');
    const n = name.trim();
    if (!p) return '';
    // Join with the separator already present in the parent path (win vs posix).
    const sep = p.includes('\\') ? '\\' : '/';
    return n ? `${p}${sep}${n}` : p;
  }, [parentPath, name]);

  const browse = async () => {
    try {
      const dir = await pickDirectory();
      if (dir) setParentPath(dir);
    } catch {
      /* cancelling the picker is not an error */
    }
  };

  const submit = async () => {
    if (!canCreate) return;
    setBusy(true);
    try {
      await createNew(name.trim(), parentPath.trim(), initGit);
      // On success the store flips activeId and the shell replaces this screen.
    } catch (e) {
      addToast({
        title: 'Could not create workspace',
        description: e instanceof Error ? e.message : String(e),
        tone: 'danger',
      });
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-xl flex-col justify-center gap-6 py-8">
      <button
        type="button"
        onClick={() => setLauncherView('list')}
        className="flex w-fit items-center gap-1.5 text-[12px] text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={14} />
        Back to workspaces
      </button>

      <div className="flex flex-col gap-3">
        <Logo size={40} />
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold tracking-tight text-fg">Create a workspace</h1>
          <p className="text-[12px] text-muted">
            Limboo creates the project folder, then profiles it automatically.
          </p>
        </div>
      </div>

      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {/* Name */}
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-muted">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-project"
            className={cn(
              'rounded-lg border bg-surface-2 px-3 py-2.5 text-[14px] text-fg placeholder:text-faint focus:outline-none',
              err ? 'border-danger' : 'border-line focus:border-line-strong',
            )}
          />
          {err && <span className="text-[11px] text-danger">{err}</span>}
        </label>

        {/* Location */}
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-muted">Location</span>
          <div className="flex items-center gap-2">
            <input
              value={parentPath}
              onChange={(e) => setParentPath(e.target.value)}
              placeholder="Choose a parent folder…"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[14px] text-fg placeholder:text-faint focus:border-line-strong focus:outline-none"
            />
            <button
              type="button"
              onClick={browse}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-fg transition-colors hover:border-line-strong"
            >
              <FolderSearch size={15} />
              Browse
            </button>
          </div>
          {preview && (
            <span className="truncate font-mono text-[11px] text-faint" title={preview}>
              → {preview}
            </span>
          )}
        </label>

        {/* Initialize git */}
        <button
          type="button"
          onClick={() => setInitGit((v) => !v)}
          className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-line-strong"
        >
          <span className="flex items-center gap-2 text-[13px] text-fg">
            <GitBranch size={15} className="text-muted" />
            Initialize git repository
          </span>
          <span
            className={cn(
              'relative h-5 w-9 rounded-full transition-colors',
              initGit ? 'bg-accent' : 'bg-line-strong',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 h-4 w-4 rounded-full bg-base transition-all',
                initGit ? 'left-[18px]' : 'left-0.5',
              )}
            />
          </span>
        </button>

        <div className="mt-1 flex items-center justify-end gap-2">
          <WorkspaceActionButton
            icon={FolderPlus}
            variant="primary"
            size="lg"
            disabled={!canCreate}
            onClick={submit}
          >
            {busy ? 'Creating…' : 'Create workspace'}
          </WorkspaceActionButton>
        </div>
      </form>
    </div>
  );
}
