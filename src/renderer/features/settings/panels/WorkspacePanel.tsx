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
import { useFileSystemStore } from '@/renderer/stores/useFileSystemStore';
import { useUIStore } from '@/renderer/stores/useUIStore';
import { CircularProgress } from '@/renderer/components/ui';
import { Section, Field, StackedField, Toggle, TextInput } from '../controls';
import { detectedStack, suggestedIgnores } from '../detectIgnores';

export function WorkspacePanel() {
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === s.activeId) ?? null);

  if (!workspace) {
    return (
      <Section title="Workspace" hint="Settings here apply to the active workspace only.">
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-line px-4 py-10 text-center">
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
  const reindex = useFileSystemStore((s) => s.reindex);
  const progress = useFileSystemStore((s) => s.progressByWs[workspace.id]);
  const addToast = useUIStore((s) => s.addToast);
  const [ignoredDraft, setIgnoredDraft] = useState(workspace.config.ignoredDirs.join('\n'));
  const [rescanning, setRescanning] = useState(false);
  const indexing = !!progress && progress.phase !== 'done';

  // Project-detection driven suggestions (advisory; applied only on click).
  const stack = detectedStack(workspace.metadata);
  const suggestions = suggestedIgnores(workspace.metadata);
  const current = new Set(
    ignoredDraft
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const missingSuggestions = suggestions.filter((s) => !current.has(s));

  const applySuggestions = () => {
    const merged = Array.from(new Set([...current, ...suggestions])).sort();
    setIgnoredDraft(merged.join('\n'));
    void updateConfig(workspace.id, { ignoredDirs: merged }).catch((err) =>
      addToast({
        title: 'Could not apply suggestions',
        description: err instanceof Error ? err.message : String(err),
        tone: 'danger',
      }),
    );
  };

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
      // Refresh detected metadata AND rebuild the file index (progress streams
      // into the ring below and the Files drawer header).
      await Promise.all([rescan(workspace.id), reindex(workspace.id)]);
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
      {stack.length > 0 && (
        <StackedField
          id="detected"
          label="Detected stack"
          hint="Auto-detected from the project's lockfiles, config, and sources."
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {stack.map((item) => (
              <span
                key={item}
                className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] text-muted"
              >
                {item}
              </span>
            ))}
            {missingSuggestions.length > 0 && (
              <button
                type="button"
                onClick={applySuggestions}
                className="ml-1 rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20"
                title={`Adds: ${missingSuggestions.join(', ')}`}
              >
                Add {missingSuggestions.length} recommended ignore
                {missingSuggestions.length === 1 ? '' : 's'}
              </button>
            )}
          </div>
        </StackedField>
      )}

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
        label="Refresh & reindex"
        hint="Re-detect languages, frameworks, and the git branch, and rebuild the file index."
      >
        <div className="flex items-center gap-2">
          {indexing && <CircularProgress value={progress?.percent ?? 0} size={28} showLabel />}
          <button
            type="button"
            disabled={rescanning || indexing}
            onClick={() => void runRescan()}
            className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-fg transition-colors hover:border-line-strong disabled:opacity-60"
          >
            <RefreshCw size={13} className={rescanning || indexing ? 'animate-spin' : undefined} />
            {rescanning || indexing ? 'Rescanning…' : 'Rescan'}
          </button>
        </div>
      </Field>
    </Section>
  );
}
