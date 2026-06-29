/**
 * Integrated-terminal settings. Appearance + behavior knobs for the workspace
 * terminal panel. The per-workspace shell override and the agent command-approval
 * policy live on the Workspace settings (WorkspaceConfig) — this panel covers the
 * global terminal experience: shell default, font, cursor, scrollback, and the
 * agent-command mirror toggle.
 */
import { TERMINAL_LIMITS, clamp } from '@shared/constants';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { Field, Section, Select, SegmentedControl, StackedField, TextInput, Toggle } from '../controls';

export function TerminalPanel() {
  const term = useSettingsStore((s) => s.settings.agent.terminal);
  const update = useSettingsStore((s) => s.update);

  const set = <K extends keyof typeof term>(key: K, value: (typeof term)[K]) =>
    void update({ agent: { terminal: { [key]: value } } });

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Shell"
        hint="The default shell for new terminals. A workspace can override this in its own settings; leave blank to use the OS default."
      >
        <StackedField
          id="terminalShell"
          label="Default shell"
          hint="Absolute path, e.g. /bin/zsh or /usr/bin/fish. Blank = system default."
        >
          <TextInput
            value={term.shell}
            placeholder="System default"
            onChange={(v) => set('shell', v)}
          />
        </StackedField>
      </Section>

      <Section title="Appearance">
        <StackedField
          id="terminalFontFamily"
          label="Font family"
          hint="Blank uses the app's monospace font."
        >
          <TextInput
            value={term.fontFamily}
            placeholder="Monospace (default)"
            onChange={(v) => set('fontFamily', v)}
          />
        </StackedField>

        <Field id="terminalFontSize" label="Font size" hint="Terminal text size in pixels.">
          <Select<number>
            value={clamp(term.fontSize, TERMINAL_LIMITS.fontSize.min, TERMINAL_LIMITS.fontSize.max)}
            options={[10, 11, 12, 13, 14, 16, 18, 20].map((n) => ({ value: n, label: `${n}px` }))}
            onChange={(v) => set('fontSize', v)}
          />
        </Field>

        <Field id="terminalCursorStyle" label="Cursor style">
          <SegmentedControl<typeof term.cursorStyle>
            value={term.cursorStyle}
            options={[
              { value: 'block', label: 'Block' },
              { value: 'bar', label: 'Bar' },
              { value: 'underline', label: 'Underline' },
            ]}
            onChange={(v) => set('cursorStyle', v)}
          />
        </Field>

        <Field id="terminalCursorBlink" label="Blink cursor">
          <Toggle checked={term.cursorBlink} onChange={(v) => set('cursorBlink', v)} />
        </Field>

        <Field
          id="terminalScrollback"
          label="Scrollback"
          hint="How many lines of output each terminal keeps."
        >
          <Select<number>
            value={term.scrollback}
            options={[1000, 2500, 5000, 10000, 25000].map((n) => ({
              value: n,
              label: `${n.toLocaleString()} lines`,
            }))}
            onChange={(v) => set('scrollback', v)}
          />
        </Field>
      </Section>

      <Section title="Behavior">
        <Field
          id="terminalCopyOnSelect"
          label="Copy on select"
          hint="Copy the selection to the clipboard automatically."
        >
          <Toggle checked={term.copyOnSelect} onChange={(v) => set('copyOnSelect', v)} />
        </Field>

        <Field
          id="terminalConfirmKill"
          label="Confirm before closing"
          hint="Ask before closing a terminal that still has a running process."
        >
          <Toggle checked={term.confirmKill} onChange={(v) => set('confirmKill', v)} />
        </Field>
      </Section>

      <Section
        title="Coding agent"
        hint="The Agent SDK does not stream live command output, so mirrored commands appear as records (command, then output and exit code) in the terminal."
      >
        <Field
          id="terminalMirrorAgent"
          label="Mirror agent commands"
          hint="Show shell commands the agent runs inside the integrated terminal."
        >
          <Toggle
            checked={term.mirrorAgentCommands}
            onChange={(v) => set('mirrorAgentCommands', v)}
          />
        </Field>
      </Section>
    </div>
  );
}
