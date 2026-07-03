/**
 * Updates — control the in-app updater (electron-updater + GitHub releases) and
 * show its live status. Auto-update only runs in a packaged build; in dev / a
 * browser preview the main manager reports `disabled` and the actions no-op.
 */
import { RefreshCw } from 'lucide-react';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { useUpdateStore } from '@/renderer/stores/useUpdateStore';
import { Section, Field, Toggle } from '../controls';

const STAGE_LABEL: Record<string, string> = {
  idle: 'Up to date',
  disabled: 'Unavailable in this build',
  checking: 'Checking for updates…',
  available: 'Update available',
  'not-available': 'Up to date',
  downloading: 'Downloading…',
  downloaded: 'Ready to install',
  error: 'Update check failed',
};

export function UpdatesPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const status = useUpdateStore((s) => s.status);
  const busy = useUpdateStore((s) => s.busy);
  const check = useUpdateStore((s) => s.check);
  const install = useUpdateStore((s) => s.install);

  const disabled = status.stage === 'disabled';

  return (
    <Section
      title="Updates"
      hint="Limboo updates over HTTPS from its GitHub releases and verifies the signed installer before applying. No update credentials are stored."
    >
      <Field
        id="updateStatus"
        label="Status"
        hint={
          status.stage === 'error' && status.error
            ? status.error
            : status.version && (status.stage === 'available' || status.stage === 'downloaded')
              ? `Limboo ${status.version} ${status.stage === 'downloaded' ? 'downloaded' : 'available'}`
              : `Current version ${status.currentVersion || '—'}`
        }
      >
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted">
            {status.stage === 'downloading' && status.resuming
              ? 'Resuming…'
              : (STAGE_LABEL[status.stage] ?? status.stage)}
          </span>
          {status.stage === 'downloading' && (
            <span className="text-[12px] tabular-nums text-faint">{status.percent ?? 0}%</span>
          )}
        </div>
      </Field>

      <Field id="updateCheck" label="Check for updates" hint="Look for a newer release now.">
        {status.stage === 'downloaded' ? (
          <button
            type="button"
            onClick={() => void install()}
            className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-base transition-opacity hover:opacity-90"
          >
            <RefreshCw size={13} /> Restart & install
          </button>
        ) : (
          <button
            type="button"
            disabled={disabled || busy || status.stage === 'checking'}
            onClick={() => void check()}
            className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-fg transition-colors hover:border-line-strong disabled:opacity-40"
          >
            <RefreshCw size={13} className={busy || status.stage === 'checking' ? 'animate-spin' : ''} />
            Check now
          </button>
        )}
      </Field>

      <Field
        id="updateAutoCheck"
        label="Check automatically"
        hint="Look for updates shortly after launch and hourly."
      >
        <Toggle
          checked={settings.updates.autoCheck}
          disabled={disabled}
          onChange={(autoCheck) => void update({ updates: { autoCheck } })}
        />
      </Field>

      <Field
        id="updateAutoDownload"
        label="Download automatically"
        hint="Download an available update in the background; otherwise wait for you."
      >
        <Toggle
          checked={settings.updates.autoDownload}
          disabled={disabled}
          onChange={(autoDownload) => void update({ updates: { autoDownload } })}
        />
      </Field>
    </Section>
  );
}
