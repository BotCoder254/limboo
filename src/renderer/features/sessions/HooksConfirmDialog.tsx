/**
 * Confirmation for repo-authored commands (limboo.json): setup/teardown hooks,
 * named scripts, and supervised services. The exact commands are displayed
 * verbatim — approving acknowledges THEM specifically (the main process
 * re-verifies via the config hash, so an edited limboo.json between display
 * and run fails closed). Approval also runs setup hooks when the session has a
 * ready worktree to run them in. Matches the app modal idiom.
 */
import { useEffect } from 'react';
import { ShieldAlert, TerminalSquare, X } from 'lucide-react';
import { useSessionStore } from '@/renderer/stores/useSessionStore';

export function HooksConfirmDialog() {
  const prompt = useSessionStore((s) => s.hooksPrompt);
  const confirm = useSessionStore((s) => s.confirmSetupHooks);
  const dismiss = useSessionStore((s) => s.dismissSetupHooks);

  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prompt, dismiss]);

  if (!prompt) return null;

  const { config } = prompt;
  const scripts = Object.entries(config.scripts);
  const services = Object.entries(config.services);
  const hasSetup = config.setup.length > 0;

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onMouseDown={dismiss}
    >
      <div
        className="animate-pop-in flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-md border border-line-strong bg-elevated shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-fg">
            <ShieldAlert size={14} className="text-warning" />
            Approve repo commands?
          </span>
          <button
            type="button"
            aria-label="Close"
            onClick={dismiss}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
          <p className="text-[12px] leading-relaxed text-muted">
            This repository&apos;s <span className="font-medium text-fg">limboo.json</span> declares
            commands Limboo can run for this session — setup/teardown hooks, on-demand scripts, and
            supervised services. They run in visible terminals inside the session&apos;s checkout.
          </p>
          {hasSetup && <CommandSection label="Setup hooks" rows={config.setup.map((c) => [null, c])} />}
          {config.teardown.length > 0 && (
            <CommandSection label="Teardown hooks" rows={config.teardown.map((c) => [null, c])} />
          )}
          {scripts.length > 0 && <CommandSection label="Scripts" rows={scripts} />}
          {services.length > 0 && (
            <CommandSection label="Services" rows={services.map(([n, s]) => [n, s.command])} />
          )}
          <p className="text-[11px] leading-relaxed text-faint">
            Approving acknowledges these exact commands for this workspace. If the repo changes
            them, you will be asked again.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-fg transition-colors hover:border-line-strong"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-base transition-opacity hover:opacity-90"
          >
            {hasSetup ? 'Approve & run setup' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One titled block of `[name?, command]` rows in the shared code-well style. */
function CommandSection({ label, rows }: { label: string; rows: Array<[string | null, string]> }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">{label}</span>
      <div className="flex flex-col gap-1 rounded-md border border-line bg-surface-2 px-3 py-2.5">
        {rows.map(([name, cmd], i) => (
          <div key={i} className="flex items-start gap-2 text-[12px]">
            <TerminalSquare size={12} className="mt-0.5 shrink-0 text-faint" />
            {name && <span className="shrink-0 font-medium text-fg">{name}</span>}
            <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-fg">{cmd}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
