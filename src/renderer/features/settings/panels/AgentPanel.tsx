/**
 * Coding-agent settings. Limboo orchestrates the local, already-authenticated
 * Claude Code (via the Claude Agent SDK) — it never stores Anthropic credentials.
 * This panel shows the live connection status and the knobs that shape how the
 * agent is driven (model, thinking, permission policy, web search, turn budget).
 */
import { Bot } from 'lucide-react';
import { AGENT_MODELS, AGENT_LIMITS } from '@shared/constants';
import type { AgentRuntimeStatus } from '@shared/types';
import { cn } from '@/renderer/lib/cn';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { useAgentStore } from '@/renderer/stores/useAgentStore';
import { Field, SegmentedControl, Section, StackedField, Toggle } from '../controls';

function statusMeta(status: AgentRuntimeStatus, installed: boolean): { dot: string; label: string } {
  if (!installed || status === 'not-installed') return { dot: 'bg-warning', label: 'Not connected' };
  if (status === 'error') return { dot: 'bg-danger', label: 'Error' };
  if (status === 'streaming' || status === 'connecting') return { dot: 'bg-accent', label: 'Working' };
  if (status === 'awaiting-permission') return { dot: 'bg-warning', label: 'Awaiting approval' };
  return { dot: 'bg-success', label: 'Ready' };
}

export function AgentPanel() {
  const agent = useSettingsStore((s) => s.settings.agent);
  const update = useSettingsStore((s) => s.update);
  const status = useAgentStore((s) => s.status);
  const install = useAgentStore((s) => s.install);

  const meta = statusMeta(status, install.installed);
  const set = <K extends keyof typeof agent>(key: K, value: (typeof agent)[K]) =>
    void update({ agent: { [key]: value } });

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
        <Field id="model" label="Model">
          <SegmentedControl
            value={agent.model}
            options={AGENT_MODELS.map((m) => ({ value: m.value, label: m.label }))}
            onChange={(value) => set('model', value)}
          />
        </Field>
        <Field id="thinking" label="Extended thinking" hint="How much the agent reasons before acting.">
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
        <Field id="permissionMode" label="Approval policy">
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
          hint="Let the agent read, search, and look things up without prompting."
        >
          <Toggle checked={agent.autoApproveReads} onChange={(v) => set('autoApproveReads', v)} />
        </Field>
        <Field id="webSearch" label="Web search" hint="Allow the built-in web search tool.">
          <Toggle checked={agent.webSearch} onChange={(v) => set('webSearch', v)} />
        </Field>
        <StackedField
          id="maxTurns"
          label={`Max turns per run · ${agent.maxTurns}`}
          hint="Upper bound on the agent's internal steps before it yields back to you."
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
    </div>
  );
}
