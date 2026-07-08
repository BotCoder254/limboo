/**
 * Settings › Agent › Troubleshooting — live provider diagnostics + the common
 * fixes for setup problems (stale PATH after installing the Cursor CLI,
 * shim-only Windows installs, preferred-auth confusion). Read-only over the
 * secret-free CursorAuthState / AgentInstall the stores already hold; the only
 * actions are the existing re-probe, a clipboard copy of a redacted diagnostic
 * block, and opening the official install guide via the validated
 * `system.openExternal` path.
 */
import { CURSOR_URLS } from '@shared/constants';
import type { CursorAuthState } from '@shared/types';
import { cursorStatusMeta } from '@/renderer/features/agent/status';
import { useAgentStore } from '@/renderer/stores/useAgentStore';
import { useUIStore } from '@/renderer/stores/useUIStore';
import { ActionButton, Section, StackedField } from '../controls';

const KIND_LABEL: Record<string, string> = {
  exe: 'Native executable',
  cmd: 'Batch shim (auth only — runs need the native layout)',
  node: 'Direct node.exe + index.js (native Windows install)',
};

const SOURCE_LABEL: Record<string, string> = {
  override: 'Executable path setting',
  path: 'PATH',
  where: 'where.exe (PATH search)',
  'install-dir': 'Install-directory probe',
};

function DiagRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-24 shrink-0 text-[11px] text-faint">{label}</span>
      <span className={`min-w-0 break-all text-[11px] text-muted ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}

function cursorDiagnosticText(
  auth: CursorAuthState | null,
  claude: { installed: boolean; version?: string; error?: string },
  bridge?: { hooksActive: boolean | null; mcpActive: boolean | null; at: number },
): string {
  const lines = [
    '--- Limboo agent diagnostics ---',
    `Claude Code: ${claude.installed ? `connected${claude.version ? ` (${claude.version})` : ''}` : claude.error ?? 'not connected'}`,
    `Cursor status: ${auth?.status ?? 'unknown'}`,
    `Cursor executable: ${auth?.exec?.path ?? 'not resolved'}`,
    `Cursor launch kind: ${auth?.exec ? KIND_LABEL[auth.exec.kind] ?? auth.exec.kind : '—'}`,
    `Cursor found via: ${auth?.exec?.source ? SOURCE_LABEL[auth.exec.source] ?? auth.exec.source : '—'}`,
    `Cursor CLI version: ${auth?.cliVersion ?? '—'}`,
    `Cursor account: ${auth?.account?.email ?? auth?.account?.name ?? '—'}`,
    `Last checked: ${auth?.lastCheckedAt ? new Date(auth.lastCheckedAt).toISOString() : 'never'}`,
    `Run bridge hooks: ${bridgeLabel(bridge?.hooksActive, 'hooks')}`,
    `Run bridge MCP: ${bridgeLabel(bridge?.mcpActive, 'mcp')}`,
  ];
  if (auth?.error) lines.push(`Last error: ${auth.error}`);
  return lines.join('\n');
}

/** Human line for one bridge layer's last-run connectivity. */
function bridgeLabel(active: boolean | null | undefined, kind: 'hooks' | 'mcp'): string {
  if (active === undefined) return 'No Cursor run yet this session.';
  if (active === null) return 'Not registered for the last run.';
  if (active) return kind === 'hooks' ? 'Active — prompts bridged on the last run.' : 'Active — Limboo memory/search served on the last run.';
  return kind === 'hooks'
    ? 'Registered, but no hook connected — this CLI version likely does not execute hooks (the deny-first rules still applied).'
    : 'Registered, but the servers never connected — they may need a one-time approval in Cursor.';
}

export function AgentTroubleshooting() {
  const auth = useAgentStore((s) => s.cursorAuth);
  const refresh = useAgentStore((s) => s.cursorRefresh);
  const install = useAgentStore((s) => s.install);
  const bridge = useAgentStore((s) => s.cursorBridge);
  const addToast = useUIStore((s) => s.addToast);

  const meta = cursorStatusMeta(auth?.status ?? 'unknown');
  const openExternal = (url: string) => void window.limboo?.system?.openExternal?.(url);
  const copyDiagnostics = () => {
    void window.limboo?.system?.clipboardWrite?.(cursorDiagnosticText(auth, install, bridge));
    addToast({ title: 'Diagnostics copied', tone: 'info' });
  };

  return (
    <Section
      title="Troubleshooting"
      hint="Live detection details for each provider, and the fixes for the setup issues we see most."
    >
      <StackedField
        id="troubleshootCursor"
        label="Cursor CLI detection"
        hint="Exactly what the last probe resolved. Refresh re-runs the full detection (PATH, %LOCALAPPDATA%\cursor-agent, ~/.local/bin, and the Executable path setting)."
      >
        <div className="flex flex-col gap-1 rounded-md border border-line bg-surface-2 px-2.5 py-2">
          <DiagRow label="Status" value={`${meta.label}${auth?.status ? ` (${auth.status})` : ''}`} />
          <DiagRow label="Executable" value={auth?.exec?.path ?? 'not resolved'} mono />
          {auth?.exec && (
            <DiagRow label="Launch" value={KIND_LABEL[auth.exec.kind] ?? auth.exec.kind} />
          )}
          {auth?.exec?.source && (
            <DiagRow label="Found via" value={SOURCE_LABEL[auth.exec.source] ?? auth.exec.source} />
          )}
          <DiagRow label="CLI version" value={auth?.cliVersion ?? '—'} mono />
          <DiagRow label="Account" value={auth?.account?.email ?? auth?.account?.name ?? '—'} />
          <DiagRow
            label="Last checked"
            value={auth?.lastCheckedAt ? new Date(auth.lastCheckedAt).toLocaleString() : 'never'}
          />
          {auth?.error && <span className="text-[11px] text-danger">{auth.error}</span>}
        </div>
        <div className="flex items-center gap-1.5 pt-1.5">
          <ActionButton label="Refresh detection" onClick={refresh} />
          <ActionButton label="Copy diagnostics" onClick={copyDiagnostics} />
          <ActionButton label="Install guide" onClick={() => openExternal(CURSOR_URLS.install)} />
        </div>
      </StackedField>

      <StackedField
        id="troubleshootBridge"
        label="Cursor run bridge"
        hint="Whether the last Cursor run's permission hooks and Limboo memory/search MCP servers connected over the per-run bridge. Both layers only ever tighten — runs stay safe without them."
      >
        <div className="flex flex-col gap-1 rounded-md border border-line bg-surface-2 px-2.5 py-2">
          <DiagRow label="Hooks" value={bridgeLabel(bridge?.hooksActive, 'hooks')} />
          <DiagRow label="MCP" value={bridgeLabel(bridge?.mcpActive, 'mcp')} />
          <DiagRow
            label="Last run"
            value={bridge?.at ? new Date(bridge.at).toLocaleString() : '—'}
          />
        </div>
      </StackedField>

      <StackedField id="troubleshootClaude" label="Claude Code">
        <div className="rounded-md border border-line bg-surface-2 px-2.5 py-2">
          <DiagRow
            label="Status"
            value={
              install.installed
                ? `Connected${install.version ? ` · ${install.version}` : ''}`
                : install.error ?? 'Not connected — Claude Code was not detected on this machine.'
            }
          />
        </div>
      </StackedField>

      <StackedField id="troubleshootTips" label="Common fixes">
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[11px] text-muted">
          <li>
            <span className="text-fg">Installed the Cursor CLI but still see “Install CLI”?</span>{' '}
            Hit Refresh detection — Limboo probes PATH, the native Windows install at{' '}
            <span className="font-mono">%LOCALAPPDATA%\cursor-agent</span>, and{' '}
            <span className="font-mono">~/.local/bin</span>. The installer edits PATH only for new
            processes, so a Limboo started before the install won’t see it via PATH — the direct
            install-directory probe covers that; a full app restart also works.
          </li>
          <li>
            <span className="text-fg">Installed somewhere custom?</span> Set the Executable path in
            the Cursor provider card above — it accepts the binary, the install directory, or the{' '}
            <span className="font-mono">cursor-agent.cmd</span> shim (Limboo resolves the shim to
            its native layout). When set it is used exclusively, never falling back to PATH.
          </li>
          <li>
            <span className="text-fg">Signed in but showing “Sign in required”?</span> Check
            Preferred authentication in the provider card — under “API key” a CLI login is
            deliberately ignored, and under “CLI sign-in” a stored key is kept but unused.
          </li>
          <li>
            <span className="text-fg">Runs failing right after a CLI update?</span> Use Update CLI
            (or Refresh detection) so Limboo re-resolves the newest installed version before the
            next run.
          </li>
        </ul>
      </StackedField>
    </Section>
  );
}
