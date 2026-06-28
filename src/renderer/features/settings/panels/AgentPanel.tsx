/**
 * Coding-agent settings. Limboo orchestrates the local, already-authenticated
 * Claude Code (via the Claude Agent SDK) — it never stores Anthropic credentials.
 * This panel shows the live connection status (lifecycle-aware) and the knobs
 * that shape how the agent is driven: model, thinking, permissions, web search,
 * turn budget, and the connection-monitoring / reliability controls.
 */
import { Bot } from 'lucide-react';
import { AGENT_CONNECTION_LIMITS, AGENT_LIMITS, AGENT_MODELS } from '@shared/constants';
import { cn } from '@/renderer/lib/cn';
import { ProviderIcon } from '@/renderer/components/brand/ProviderIcon';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { useAgentStore } from '@/renderer/stores/useAgentStore';
import { lifecycleMeta } from '@/renderer/features/agent/status';
import { Field, Section, Select, SegmentedControl, StackedField, Toggle } from '../controls';

export function AgentPanel() {
  const agent = useSettingsStore((s) => s.settings.agent);
  const update = useSettingsStore((s) => s.update);
  const lifecycle = useAgentStore((s) => s.lifecycle);
  const install = useAgentStore((s) => s.install);

  const meta = lifecycleMeta(lifecycle, install.installed);
  const set = <K extends keyof typeof agent>(key: K, value: (typeof agent)[K]) =>
    void update({ agent: { [key]: value } });
  const setConn = <K extends keyof typeof agent.connection>(
    key: K,
    value: (typeof agent.connection)[K],
  ) => void update({ agent: { connection: { [key]: value } } });
  const setPlan = <K extends keyof typeof agent.plan>(key: K, value: (typeof agent.plan)[K]) =>
    void update({ agent: { plan: { [key]: value } } });

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Coding agent"
        hint="Limboo orchestrates the local Claude Code process and reuses its existing authentication — your API keys never pass through this app."
      >
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-elevated text-muted">
            <Bot size={18} />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="text-[13px] text-fg">Claude Code</span>
            <span className="text-[11px] text-faint">
              {install.installed
                ? 'Connected — reusing your local Claude Code login.'
                : install.error ?? 'Not connected.'}
            </span>
          </div>
          <span className="ml-auto flex items-center gap-1.5 rounded-full bg-elevated px-2 py-0.5 text-[10px] text-muted">
            <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
            {meta.label}
          </span>
        </div>
      </Section>

      <Section title="Model & thinking">
        <StackedField id="model" label="Model" hint="Which Claude model the agent runs. Default Sonnet 4.6.">
          <div className="flex flex-wrap gap-1.5">
            {AGENT_MODELS.map((m) => {
              const active = agent.model === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => set('model', m.value)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] transition-colors',
                    active
                      ? 'border-accent/50 bg-elevated text-fg'
                      : 'border-line bg-surface-2 text-muted hover:text-fg',
                  )}
                >
                  <ProviderIcon provider={m.provider} size={13} className={active ? 'text-accent' : 'text-faint'} />
                  {m.label}
                </button>
              );
            })}
          </div>
        </StackedField>
        <Field id="thinking" label="Extended thinking" hint="How much the agent reasons before acting. Default Adaptive.">
          <SegmentedControl
            value={agent.thinking}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on', label: 'On' },
              { value: 'adaptive', label: 'Adaptive' },
            ]}
            onChange={(value) => set('thinking', value)}
          />
        </Field>
      </Section>

      <Section title="Permissions & tools" hint="Control which agent actions need your approval before they run.">
        <Field
          id="permissionMode"
          label="Approval policy"
          hint="Edits & commands (default) prompts for writes and shell; Everything prompts for all tools; Auto runs without prompting (still path-guarded to the workspace) — use with care."
        >
          <SegmentedControl
            value={agent.permissionMode}
            options={[
              { value: 'approve-edits', label: 'Edits & commands' },
              { value: 'approve-all', label: 'Everything' },
              { value: 'auto', label: 'Auto' },
            ]}
            onChange={(value) => set('permissionMode', value)}
          />
        </Field>
        <Field
          id="autoApproveReads"
          label="Auto-approve reads"
          hint="Let the agent read, search, and look things up without prompting. Default on — reads can't modify your project."
        >
          <Toggle checked={agent.autoApproveReads} onChange={(v) => set('autoApproveReads', v)} />
        </Field>
        <Field
          id="webSearch"
          label="Web search"
          hint="Allow the built-in web search / fetch tools. Default on. Turning this off keeps the agent fully offline-local."
        >
          <Toggle checked={agent.webSearch} onChange={(v) => set('webSearch', v)} />
        </Field>
        <StackedField
          id="maxTurns"
          label={`Max turns per run · ${agent.maxTurns}`}
          hint="Upper bound on the agent's internal steps before it yields back to you. Default 24. Higher allows longer autonomous runs."
        >
          <input
            type="range"
            min={AGENT_LIMITS.maxTurns.min}
            max={AGENT_LIMITS.maxTurns.max}
            step={1}
            value={agent.maxTurns}
            onChange={(e) => set('maxTurns', Number(e.target.value))}
            className="w-full accent-accent"
          />
        </StackedField>
      </Section>

      <Section
        title="Plan Mode"
        hint="The review-first workflow: the agent analyzes the repository read-only and proposes a plan you approve before any files change."
      >
        <Field
          id="planDefaultMode"
          label="Default composer mode"
          hint="What new sessions start in. Plan-first (default) is safest — the agent proposes before it changes anything."
        >
          <SegmentedControl
            value={agent.plan.defaultMode}
            options={[
              { value: 'plan', label: 'Plan' },
              { value: 'implement', label: 'Implement' },
            ]}
            onChange={(value) => setPlan('defaultMode', value)}
          />
        </Field>
        <Field
          id="planRequireSecondaryConfirm"
          label="Confirm before executing"
          hint="Require a second click on Approve & Execute before implementation begins. Default off."
        >
          <Toggle
            checked={agent.plan.requireSecondaryConfirm}
            onChange={(v) => setPlan('requireSecondaryConfirm', v)}
          />
        </Field>
        <Field
          id="planShowReasoning"
          label="Show plan reasoning"
          hint="Render the full implementation-plan markdown in the Tasks panel. Default on."
        >
          <Toggle checked={agent.plan.showReasoning} onChange={(v) => setPlan('showReasoning', v)} />
        </Field>
        <Field
          id="planShowEstimates"
          label="Show plan metadata"
          hint="Show the affected-files / task-count / risk row above the plan. Default on."
        >
          <Toggle checked={agent.plan.showEstimates} onChange={(v) => setPlan('showEstimates', v)} />
        </Field>
        <Field
          id="planHighlightRisk"
          label="Highlight risk"
          hint="Color the risk estimate (low / medium / high). Default on."
        >
          <Toggle checked={agent.plan.highlightRisk} onChange={(v) => setPlan('highlightRisk', v)} />
        </Field>
        <Field
          id="planExportFormat"
          label="Plan export format"
          hint="Format used by the plan Download action."
        >
          <SegmentedControl
            value={agent.plan.defaultExportFormat}
            options={[
              { value: 'md', label: 'Markdown' },
              { value: 'txt', label: 'Text' },
              { value: 'pdf', label: 'PDF' },
            ]}
            onChange={(value) => setPlan('defaultExportFormat', value)}
          />
        </Field>
      </Section>

      <Section
        title="Connection & reliability"
        hint="How Limboo supervises the Claude Code capability. A failed request never marks the agent dead — these knobs govern heartbeat checks and automatic recovery."
      >
        <Field
          id="heartbeatInterval"
          label="Heartbeat interval"
          hint="How often Limboo verifies the agent is healthy (a lightweight auth/SDK check, never a model call). Default 30s. Off disables monitoring."
        >
          <Select
            value={agent.connection.heartbeatInterval}
            options={[
              { value: 0, label: 'Off' },
              { value: 15_000, label: 'Every 15s' },
              { value: 30_000, label: 'Every 30s' },
              { value: 60_000, label: 'Every 1m' },
              { value: 120_000, label: 'Every 2m' },
            ]}
            onChange={(v) => setConn('heartbeatInterval', v)}
          />
        </Field>
        <StackedField
          id="heartbeatFailureThreshold"
          label={`Heartbeat failures before reconnecting · ${agent.connection.heartbeatFailureThreshold}`}
          hint="Consecutive failed heartbeats tolerated before showing Reconnecting. Default 2 — absorbs brief OS scheduling hiccups without alarming you."
        >
          <input
            type="range"
            min={AGENT_CONNECTION_LIMITS.heartbeatFailureThreshold.min}
            max={AGENT_CONNECTION_LIMITS.heartbeatFailureThreshold.max}
            step={1}
            value={agent.connection.heartbeatFailureThreshold}
            onChange={(e) => setConn('heartbeatFailureThreshold', Number(e.target.value))}
            className="w-full accent-accent"
          />
        </StackedField>
        <StackedField
          id="maxRecoveryAttempts"
          label={`Max recovery attempts · ${agent.connection.maxRecoveryAttempts}`}
          hint="How many times Limboo transparently retries a run after a transient failure before surfacing an error. Default 3. 0 disables auto-recovery."
        >
          <input
            type="range"
            min={AGENT_CONNECTION_LIMITS.maxRecoveryAttempts.min}
            max={AGENT_CONNECTION_LIMITS.maxRecoveryAttempts.max}
            step={1}
            value={agent.connection.maxRecoveryAttempts}
            onChange={(e) => setConn('maxRecoveryAttempts', Number(e.target.value))}
            className="w-full accent-accent"
          />
        </StackedField>
        <Field
          id="reconnectDelay"
          label="Reconnect delay"
          hint="Base wait before the first recovery retry (grows with exponential backoff). Default 1s. Lower recovers faster but retries more aggressively."
        >
          <Select
            value={agent.connection.reconnectDelay}
            options={[
              { value: 500, label: '0.5s' },
              { value: 1_000, label: '1s' },
              { value: 2_000, label: '2s' },
              { value: 5_000, label: '5s' },
            ]}
            onChange={(v) => setConn('reconnectDelay', v)}
          />
        </Field>
        <Field
          id="idleTimeout"
          label="Idle refresh"
          hint="After this idle window Limboo refreshes its health baseline. Default 5m. Off keeps background work to a minimum."
        >
          <Select
            value={agent.connection.idleTimeout}
            options={[
              { value: 0, label: 'Off' },
              { value: 60_000, label: '1m' },
              { value: 300_000, label: '5m' },
              { value: 600_000, label: '10m' },
              { value: 1_800_000, label: '30m' },
            ]}
            onChange={(v) => setConn('idleTimeout', v)}
          />
        </Field>
        <Field
          id="autoRestart"
          label="Auto-restart after crashes"
          hint="Re-probe and return to Ready automatically after a recoverable capability error. Default on. Risk: none — it never re-runs your prompt without asking."
        >
          <Toggle checked={agent.connection.autoRestart} onChange={(v) => setConn('autoRestart', v)} />
        </Field>
        <Field
          id="sessionPersistence"
          label="Persist sessions & diagnostics"
          hint="Keep conversation continuity and the diagnostics console across app restarts. Default on. Off reduces on-disk footprint."
        >
          <Toggle checked={agent.connection.sessionPersistence} onChange={(v) => setConn('sessionPersistence', v)} />
        </Field>
        <Field
          id="connectivityNotifications"
          label="Connectivity notifications"
          hint="Desktop notifications when the agent reconnects or hits a usage limit. Default on."
        >
          <Toggle
            checked={agent.connection.connectivityNotifications}
            onChange={(v) => setConn('connectivityNotifications', v)}
          />
        </Field>
      </Section>

      <Section title="Diagnostics" hint="How much detail the Agent Console and main log capture.">
        <Field
          id="logVerbosity"
          label="Log verbosity"
          hint="Verbose includes low-level debug lines (handshakes, stream start/stop). Default Normal. Quiet keeps only warnings and errors."
        >
          <SegmentedControl
            value={agent.logVerbosity}
            options={[
              { value: 'quiet', label: 'Quiet' },
              { value: 'normal', label: 'Normal' },
              { value: 'verbose', label: 'Verbose' },
            ]}
            onChange={(value) => set('logVerbosity', value)}
          />
        </Field>
      </Section>
    </div>
  );
}
