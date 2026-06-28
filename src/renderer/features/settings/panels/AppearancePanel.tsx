/** Appearance settings — density, font scale, reduced motion. Dark-only by rule. */
import type { UiDensity } from '@shared/types';
import { FONT_SCALE_LIMITS } from '@shared/constants';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { Section, Field, StackedField, Toggle, SegmentedControl } from '../controls';

export function AppearancePanel() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);

  return (
    <Section
      title="Appearance"
      hint="Limboo is pure-black, dark only — there is intentionally no light theme or color toggle."
    >
      <Field id="density" label="Density" hint="Spacing of rows and controls across the app.">
        <SegmentedControl<UiDensity>
          value={settings.appearance.density}
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ]}
          onChange={(density) => void update({ appearance: { density } })}
        />
      </Field>

      <StackedField
        id="fontScale"
        label={`Font scale — ${Math.round(settings.appearance.fontScale * 100)}%`}
        hint="Scales all interface text."
      >
        <input
          type="range"
          min={FONT_SCALE_LIMITS.min}
          max={FONT_SCALE_LIMITS.max}
          step={0.05}
          value={settings.appearance.fontScale}
          onChange={(e) => void update({ appearance: { fontScale: Number(e.target.value) } })}
          className="w-full max-w-xs accent-accent"
        />
      </StackedField>

      <Field
        id="reducedMotion"
        label="Reduce motion"
        hint="Minimize animations and transitions."
      >
        <Toggle
          checked={settings.appearance.reducedMotion}
          onChange={(reducedMotion) => void update({ appearance: { reducedMotion } })}
        />
      </Field>
    </Section>
  );
}
