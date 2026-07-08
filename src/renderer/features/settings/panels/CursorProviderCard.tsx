/**
 * Cursor provider card — Settings › Agent › Providers. Authentication (the
 * interactive `cursor-agent login` flow with a manual-browser mode, or a
 * Cursor API key held safeStorage-encrypted in the main process) plus CLI
 * maintenance: executable-path override, sandbox mode, and self-update.
 *
 * Security posture: this card never sees, caches, or renders a secret. The
 * key lives only in transient local input state (cleared on save/unmount) and
 * crosses IPC exactly once; everything rendered comes from the secret-free
 * {@link CursorAuthState}. URLs are the shared CURSOR_URLS constants and open
 * only through the validated `window.limboo.system.openExternal` path.
 */
import { useEffect, useState } from 'react';
import { CURSOR_URLS } from '@shared/constants';
import { Spinner } from '@/renderer/components/ui';
import { cursorStatusMeta } from '@/renderer/features/agent/status';
import { useAgentStore } from '@/renderer/stores/useAgentStore';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { useUIStore } from '@/renderer/stores/useUIStore';
import {
  ActionButton,
  Field,
  SecretInput,
  SegmentedControl,
  StackedField,
  TextInput,
  Toggle,
} from '../controls';
import { ProviderStatusRow } from './ProviderCard';

export function CursorProviderCard() {
  const auth = useAgentStore((s) => s.cursorAuth);
  const refresh = useAgentStore((s) => s.cursorRefresh);
  const loginStart = useAgentStore((s) => s.cursorLoginStart);
  const loginCancel = useAgentStore((s) => s.cursorLoginCancel);
  const logout = useAgentStore((s) => s.cursorLogout);
  const setApiKey = useAgentStore((s) => s.cursorSetApiKey);
  const removeApiKey = useAgentStore((s) => s.cursorRemoveApiKey);
  const updating = useAgentStore((s) => s.cursorUpdating);
  const updateCli = useAgentStore((s) => s.cursorUpdateCli);
  const cursorPrefs = useSettingsStore((s) => s.settings.agent.cursor);
  const update = useSettingsStore((s) => s.update);
  const addToast = useUIStore((s) => s.addToast);

  // The key exists ONLY here between typing and save; cleared on save/unmount.
  const [keyDraft, setKeyDraft] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  useEffect(() => () => setKeyDraft(''), []);

  // Executable-path override: draft locally, commit on blur (main validates
  // fail-closed, re-probes, and reports problems via the auth state's error).
  const [pathDraft, setPathDraft] = useState(cursorPrefs.executablePath);
  useEffect(() => setPathDraft(cursorPrefs.executablePath), [cursorPrefs.executablePath]);
  const commitPath = () => {
    const next = pathDraft.trim();
    if (next === cursorPrefs.executablePath) return;
    void update({ agent: { cursor: { executablePath: next } } });
  };

  const openExternal = (url: string) => void window.limboo?.system?.openExternal?.(url);
  const meta = cursorStatusMeta(auth?.status ?? 'unknown');
  const login = auth?.login ?? { phase: 'idle' as const };
  const loginBusy = login.phase !== 'idle' && login.phase !== 'failed';
  const installed = !!auth && auth.status !== 'not-installed' && auth.status !== 'unknown';

  const statusLine = (() => {
    if (!auth) return 'Checking the Cursor CLI…';
    switch (auth.status) {
      case 'not-installed':
        return auth.error ?? 'Cursor CLI (cursor-agent) not found on PATH.';
      case 'authenticated-cli':
        return `Logged in as ${auth.account?.email ?? auth.account?.name ?? 'your Cursor account'}${
          auth.cliVersion ? ` · CLI ${auth.cliVersion}` : ''
        }`;
      case 'authenticated-api-key':
        return `API key configured${
          auth.apiKey.source === 'env'
            ? ' via CURSOR_API_KEY'
            : auth.apiKey.updatedAt
              ? ` · updated ${new Date(auth.apiKey.updatedAt).toLocaleDateString()}`
              : ''
        }`;
      case 'not-authenticated':
        if (cursorPrefs.preferredAuth === 'api-key' && !auth.apiKey.configured) {
          return `Installed${auth.cliVersion ? ` (CLI ${auth.cliVersion})` : ''} — API key preferred but none configured yet.`;
        }
        return `Installed${auth.cliVersion ? ` (CLI ${auth.cliVersion})` : ''} — sign in or add an API key.`;
      default:
        return 'Checking the Cursor CLI…';
    }
  })();

  const saveKey = async () => {
    const ok = await setApiKey(keyDraft.trim());
    if (ok) {
      setKeyDraft('');
      setShowKeyInput(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      {/* Status row — the shared provider layout (same as the Claude Code card). */}
      <ProviderStatusRow provider="cursor" name="Cursor" statusLine={statusLine} meta={meta} />

      {/* Actions per state. */}
      {auth?.status === 'not-installed' && (
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <ActionButton label="Refresh" onClick={refresh} />
          <ActionButton label="Install guide" onClick={() => openExternal(CURSOR_URLS.install)} />
          <ActionButton label="Docs" onClick={() => openExternal(CURSOR_URLS.docs)} />
        </div>
      )}

      {(auth?.status === 'authenticated-cli' || auth?.status === 'authenticated-api-key') && (
        <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
          {auth.status === 'authenticated-cli' && (
            <>
              <ActionButton label="Logout" danger onClick={() => void logout()} />
              <ActionButton label="Re-authenticate" onClick={() => void loginStart(cursorPrefs.manualBrowserLogin)} />
            </>
          )}
          {auth.status === 'authenticated-api-key' && auth.apiKey.source === 'encrypted' && (
            <>
              <ActionButton label="Replace…" onClick={() => setShowKeyInput((v) => !v)} />
              <ActionButton label="Remove" danger onClick={() => void removeApiKey()} />
            </>
          )}
          <ActionButton label="Refresh" onClick={refresh} />
          <ActionButton
            label="Open Dashboard"
            onClick={() =>
              openExternal(
                auth.status === 'authenticated-api-key' ? CURSOR_URLS.apiKeys : CURSOR_URLS.dashboard,
              )
            }
          />
        </div>
      )}

      {/* Which credential wins when both exist — consumed by the main-process
          probe classification (and the future runtime's spawn env). */}
      {installed && (
        <Field
          id="cursorPreferredAuth"
          label="Preferred authentication"
          hint="Auto prefers an API key when one is configured. API key ignores a CLI login; CLI sign-in ignores a stored key (it is kept, just not used)."
        >
          <SegmentedControl
            value={cursorPrefs.preferredAuth}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'api-key', label: 'API key' },
              { value: 'cli-login', label: 'CLI sign-in' },
            ]}
            onChange={(v) =>
              // Persist first, then re-classify — the probe reads the setting in main.
              void update({ agent: { cursor: { preferredAuth: v } } }).then(refresh)
            }
          />
        </Field>
      )}

      {/* CLI maintenance — version + self-update (refused during active runs). */}
      {installed && (
        <Field
          id="cursorUpdateCli"
          label="CLI version"
          hint="Runs cursor-agent update. Refused while an agent run is active."
        >
          <span className="flex items-center gap-2 text-[11px] text-muted">
            <span className="font-mono">{auth?.cliVersion ?? 'unknown'}</span>
            {updating ? (
              <span className="flex items-center gap-1.5">
                <Spinner size={12} />
                Updating…
              </span>
            ) : (
              <ActionButton label="Update CLI" onClick={() => void updateCli()} />
            )}
          </span>
        </Field>
      )}

      {/* Sandbox posture for runs — a literal-whitelisted --sandbox flag. */}
      {installed && (
        <Field
          id="cursorSandbox"
          label="Sandbox"
          hint="Cursor's execution sandbox for runs. Auto leaves the CLI's default; Enabled/Disabled passes --sandbox explicitly."
        >
          <SegmentedControl
            value={cursorPrefs.sandbox}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'enabled', label: 'Enabled' },
              { value: 'disabled', label: 'Disabled' },
            ]}
            onChange={(v) => void update({ agent: { cursor: { sandbox: v } } })}
          />
        </Field>
      )}

      {/* Session hooks bridge — Limboo's per-tool permission prompts, registered
          per run via a session-scoped hooks.json. Capability-gated: it can only
          tighten (the deny-first rule file applies either way). */}
      {installed && (
        <Field
          id="cursorHooks"
          label="Permission hooks"
          hint="Auto registers Limboo's interactive per-tool approval prompts for each run (applies when the CLI executes hooks; only ever tightens). Off skips registering them."
        >
          <SegmentedControl
            value={cursorPrefs.hooks}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'off', label: 'Off' },
            ]}
            onChange={(v) => void update({ agent: { cursor: { hooks: v } } })}
          />
        </Field>
      )}

      {auth?.status === 'not-authenticated' && (
        <>
          {/* Path 1 — interactive CLI sign-in. */}
          <Field
            id="cursorProvider"
            label="Sign in with Cursor"
            hint="Runs cursor-agent login — the CLI authenticates in your browser and keeps its own credentials. Limboo never reads or copies them."
          >
            {loginBusy ? (
              <span className="flex items-center gap-2 text-[11px] text-muted">
                <Spinner size={12} />
                {login.phase === 'verifying' ? 'Verifying sign-in…' : 'Waiting for sign-in…'}
                <ActionButton label="Cancel" onClick={loginCancel} />
              </span>
            ) : (
              <ActionButton
                label="Sign in"
                primary
                onClick={() => void loginStart(cursorPrefs.manualBrowserLogin)}
              />
            )}
          </Field>
          <Field
            id="cursorManualLogin"
            label="Manual browser login"
            hint="Print the login URL instead of auto-opening a browser — for remote or headless setups. You copy or open the link yourself."
          >
            <Toggle
              checked={cursorPrefs.manualBrowserLogin}
              onChange={(v) => void update({ agent: { cursor: { manualBrowserLogin: v } } })}
            />
          </Field>
          {login.phase === 'waiting-manual-url' && login.url && (
            <div className="mx-2 flex flex-col gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-2">
              <span className="break-all font-mono text-[11px] text-muted">{login.url}</span>
              <div className="flex items-center gap-1.5">
                <ActionButton
                  label="Copy URL"
                  onClick={() => {
                    void window.limboo?.system?.clipboardWrite?.(login.url ?? '');
                    addToast({ title: 'Login URL copied', tone: 'info' });
                  }}
                />
                <ActionButton label="Open Browser" onClick={() => openExternal(login.url ?? '')} />
                <ActionButton label="Cancel" onClick={loginCancel} />
              </div>
            </div>
          )}
          {login.phase === 'failed' && (
            <div className="flex items-center gap-2 px-2 py-1">
              <span className="text-[11px] text-danger">{login.error ?? 'Sign-in failed.'}</span>
              <ActionButton label="Retry" onClick={() => void loginStart(cursorPrefs.manualBrowserLogin)} />
            </div>
          )}

          {/* Path 2 — API key (automation / SDK). */}
          <StackedField
            id="cursorApiKey"
            label="API key"
            hint="Stored encrypted on this machine via the OS keychain (never in settings files, never shown again). Get a key from the Cursor Dashboard."
          >
            {auth.encryptionAvailable ? (
              <div className="flex items-center gap-1.5">
                <SecretInput
                  value={keyDraft}
                  placeholder="Paste your Cursor API key"
                  onChange={setKeyDraft}
                />
                <ActionButton label="Save key" primary onClick={() => void saveKey()} />
                <ActionButton
                  label="Open Dashboard"
                  onClick={() => openExternal(CURSOR_URLS.apiKeys)}
                />
              </div>
            ) : (
              <span className="text-[11px] text-warning">
                OS keychain encryption is unavailable — API key storage is disabled. Use the sign-in
                flow or set CURSOR_API_KEY in your environment instead.
              </span>
            )}
          </StackedField>
        </>
      )}

      {/* Replace-key input (authenticated-api-key state). */}
      {auth?.status === 'authenticated-api-key' && showKeyInput && (
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <SecretInput value={keyDraft} placeholder="Paste the new API key" onChange={setKeyDraft} />
          <ActionButton label="Save key" primary onClick={() => void saveKey()} />
        </div>
      )}

      {/* Executable override — always rendered: it IS the recovery path when
          cursor-agent lives outside PATH / the default install dir. */}
      <StackedField
        id="cursorExecutablePath"
        label="Executable path"
        hint="Absolute path to cursor-agent — the binary, the install directory, or the .cmd shim (shims and directories resolve to the native node.exe layout). When set it is used exclusively (no PATH fallback); leave blank to auto-detect. Validation errors show in the status line above."
      >
        <TextInput
          value={pathDraft}
          placeholder="Auto-detect (PATH, %LOCALAPPDATA%\cursor-agent, ~/.local/bin)"
          onChange={setPathDraft}
          onBlur={commitPath}
        />
      </StackedField>

      <p className="px-2 text-[11px] text-faint">
        Once connected, pick a Composer model under Model &amp; thinking to run Cursor as the coding
        agent. Runs are propose-only until you approve their changes.
      </p>
    </div>
  );
}
