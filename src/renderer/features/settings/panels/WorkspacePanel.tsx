/**
 * Per-workspace configuration — scoped to the *active* workspace, independent
 * from the global preferences. Shows an empty state when no workspace is open.
 * The ignored-dirs textarea commits on blur (parsed, deduped) to avoid splitting
 * mid-keystroke.
 */
import { useState } from 'react';
import { FolderGit2, RefreshCw } from 'lucide-react';
import type { Workspace } from '@shared/types';
import { useWorkspaceStore } from '@/renderer/stores/useWorkspaceStore';
import { useUIStore } from '@/renderer/stores/useUIStore';
import { Section, Field, StackedField, Toggle, TextInput } from '../controls';

export function WorkspacePanel() {
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === s.activeId) ?? null);

  if (!workspace) {
    return (
      <Section title="Workspace" hint="Settings here apply to the active workspace only.">
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-4 py-10 text-center">
          <FolderGit2 size={26} className="text-faint" />
          <p className="text-[13px] text-muted">No workspace is open.</p>
          <p className="max-w-xs text-[11px] leading-relaxed text-faint">
            Open or create a workspace to configure its ignored directories, shell, and
            terminal-approval policy.
          </p>
        </div>
      </Section>
    );
  }

  return <WorkspaceConfig key={workspace.id} workspace={workspace} />;
}

function WorkspaceConfig({ workspace }: { workspace: Workspace }) {
  const updateConfig = useWorkspaceStore((s) => s.updateConfig);
  const rescan = useWorkspaceStore((s) => s.rescan);
  const addToast = useUIStore((s) => s.addToast);
  const [ignoredDraft, setIgnoredDraft] = useState(workspace.config.ignoredDirs.join('\n'));
  const [rescanning, setRescanning] = useState(false);

  const commitIgnored = () => {
    const ignoredDirs = Array.from(
      new Set(
        ignoredDraft
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    );
    void updateConfig(workspace.id, { ignoredDirs }).catch((err) =>
      addToast({
        title: 'Could not save ignored directories',
        description: err instanceof Error ? err.message : String(err),
        tone: 'danger',
      }),
    );
  };

  const runRescan = async () => {
    setRescanning(true);
    try {
      await rescan(workspace.id);
      addToast({ title: `Rescanned ${workspace.name}`, tone: 'info' });
    } catch (err) {
      addToast({
        title: 'Could not rescan workspace',
        description: err instanceof Error ? err.message : String(err),
        tone: 'danger',
      });
    } finally {
      setRescanning(false);
    }
  };

  return (
    <Section
      title="Workspace"
      hint={`Settings for ${workspace.name} only — separate from the global preferences.`}
    >
      <Field
        id="approveTerminal"
        label="Approve terminal commands"
        hint="Require confirmation before the agent runs shell commands."
      >
        <Toggle
          checked={workspace.config.approveTerminalCommands}
          onChange={(approveTerminalCommands) =>
            void updateConfig(workspace.id, { approveTerminalCommands })
          }
        />
      </Field>

      <Field id="preferredShell" label="Preferred shell" hint="Leave blank to use the OS default.">
        <TextInput
          value={workspace.config.preferredShell}
          placeholder="OS default"
          onChange={(preferredShell) => void updateConfig(workspace.id, { preferredShell })}
        />
      </Field>

      <StackedField
        id="ignoredDirs"
        label="Ignored directories"
        hint="One per line. Excluded from stats and indexing. Relative paths only."
      >
        <textarea
          value={ignoredDraft}
          onChange={(e) => setIgnoredDraft(e.target.value)}
          onBlur={commitIgnored}
          spellCheck={false}
          rows={4}
          placeholder="node_modules&#10;dist&#10;.git"
          className="w-full resize-y rounded-md border border-line bg-surface-2 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-fg placeholder:text-faint focus:border-line-strong focus:outline-none"
        />
      </StackedField>

      <Field
        id="rescan"
        label="Refresh detected metadata"
        hint="Re-detect languages, frameworks, and the git branch."
      >
        <button
          type="button"
          disabled={rescanning}
          onClick={() => void runRescan()}
          className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-fg transition-colors hover:border-line-strong disabled:opacity-60"
        >
          <RefreshCw size={13} className={rescanning ? 'animate-spin' : undefined} />
          {rescanning ? 'Rescanning…' : 'Rescan'}
        </button>
      </Field>
    </Section>
  );
}
