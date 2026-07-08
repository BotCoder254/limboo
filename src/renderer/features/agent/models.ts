/**
 * Selectable agent models = the static catalog (AGENT_MODELS) merged with the
 * Cursor models discovered from the user's account (`cursor-agent models`,
 * validated + persisted in main, registered into the shared provider-routing
 * registry on hydrate/auth intake). Both model pickers consume this hook so
 * they always agree.
 */
import { useMemo } from 'react';
import { AGENT_MODELS, type AgentProvider } from '@shared/constants';
import { useAgentStore } from '@/renderer/stores/useAgentStore';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';

export interface AgentModelOption {
  value: string;
  label: string;
  provider: AgentProvider;
}

/**
 * Static + discovered models, deduped (static entries win — they carry curated
 * labels). Discovered ids use the raw id as the label; the source is the live
 * auth state when present, falling back to the persisted settings list so the
 * pickers are correct at boot before the first probe.
 */
export function useAgentModels(): AgentModelOption[] {
  const discoveredLive = useAgentStore((s) => s.cursorAuth?.models);
  const discoveredPersisted = useSettingsStore((s) => s.settings.agent.cursor.discoveredModels);

  return useMemo(() => {
    const out: AgentModelOption[] = AGENT_MODELS.map((m) => ({
      value: m.value,
      label: m.label,
      provider: m.provider,
    }));
    const known = new Set(out.map((m) => m.value));
    for (const id of discoveredLive ?? discoveredPersisted ?? []) {
      if (known.has(id)) continue;
      known.add(id);
      out.push({ value: id, label: id, provider: 'cursor' });
    }
    return out;
  }, [discoveredLive, discoveredPersisted]);
}
