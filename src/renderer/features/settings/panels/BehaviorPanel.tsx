/** Behaviour settings — desktop notifications and tray persistence. */
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { Section, Field, Toggle } from '../controls';

export function BehaviorPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);

  return (
    <Section title="Behavior">
      <Field
        id="notifications"
        label="Desktop notifications"
        hint="Show OS notifications for background events."
      >
        <Toggle
          checked={settings.behavior.notifications}
          onChange={(notifications) => void update({ behavior: { notifications } })}
        />
      </Field>
      <Field
        id="tray"
        label="Keep running in tray"
        hint="Closing the window minimizes Limboo to the system tray instead of quitting."
      >
        <Toggle
          checked={settings.behavior.minimizeToTray}
          onChange={(minimizeToTray) => void update({ behavior: { minimizeToTray } })}
        />
      </Field>
    </Section>
  );
}
