/**
 * Cursor provider card — Settings › Agent › Providers. Authentication only
 * (the runtime adapter is a later phase): connect via the interactive
 * `cursor-agent login` flow (with a manual-browser mode for headless setups)
 * or a Cursor API key held safeStorage-encrypted in the main process.
 *
 * Security posture: this card never sees, caches, or renders a secret. The
 * key lives only in transient local input state (cleared on save/unmount) and
 * crosses IPC exactly once; everything rendered comes from the secret-free
 * {@link CursorAuthState}. URLs open only through the validated
 * `window.limboo.system.openExternal` path.
 */
import { useEffect, useState } from 'react';
import { Spinner } from '@/renderer/components/ui';
import { cursorStatusMeta } from '@/renderer/features/agent/status';
import { useAgentStore } from '@/renderer/stores/useAgentStore';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { useUIStore } from '@/renderer/stores/useUIStore';
import { ActionButton, Field, SegmentedControl, StackedField, Toggle } from '../controls';
import { ProviderStatusRow } from './ProviderCard';

const DOCS_URL = 'https://cursor.com/docs/cli/overview';
const DASHBOARD_URL = 'https://cursor.com/dashboard';
/** API keys live under Dashboard → API Keys (docs: cursor.com/dashboard/api). */
const API_KEYS_URL = 'https://cursor.com/dashboard/api';

export function CursorProviderCard() {
  const auth = useAgentStore((s) => s.cursorAuth);
  const refresh = useAgentStore((s) => s.cursorRefresh);
  const loginStart = useAgentStore((s) => s.cursorLoginStart);
  const loginCancel = useAgentStore((s) => s.cursorLoginCancel);
  const logout = useAgentStore((s) => s.cursorLogout);
  const setApiKey = useAgentStore((s) => s.cursorSetApiKey);
  const removeApiKey = useAgentStore((s) => s.cursorRemoveApiKey);
  const cursorPrefs = useSettingsStore((s) => s.settings.agent.cursor);
  const update = useSettingsStore((s) => s.update);
  const addToast = useUIStore((s) => s.addToast);

  // The key exists ONLY here between typing and save; cleared on save/unmount.
  const [keyDraft, setKeyDraft] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  useEffect(() => () => setKeyDraft(''), []);

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
          <ActionButton label="Install guide" onClick={() => openExternal(DOCS_URL)} />
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
              openExternal(auth.status === 'authenticated-api-key' ? API_KEYS_URL : DASHBOARD_URL)
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
                <input
                  type="password"
                  value={keyDraft}
                  placeholder="Paste your Cursor API key"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  className="w-64 rounded-md border border-line bg-surface-2 px-2 py-1 text-[12px] text-fg placeholder:text-faint focus:border-line-strong focus:outline-none"
                />
                <ActionButton label="Save key" primary onClick={() => void saveKey()} />
                <ActionButton label="Open Dashboard" onClick={() => openExternal(API_KEYS_URL)} />
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
          <input
            type="password"
            value={keyDraft}
            placeholder="Paste the new API key"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setKeyDraft(e.target.value)}
            className="w-64 rounded-md border border-line bg-surface-2 px-2 py-1 text-[12px] text-fg placeholder:text-faint focus:border-line-strong focus:outline-none"
          />
          <ActionButton label="Save key" primary onClick={() => void saveKey()} />
        </div>
      )}

      <p className="px-2 text-[11px] text-faint">
        Running Cursor agents arrives in a later update — connect your account now so it&apos;s ready.
      </p>
    </div>
  );
}
