/**
 * Keyboard shortcuts reference — rendered directly from the command registry
 * (`lib/commands.ts`) so it can never drift from what the app actually binds.
 * Read-only; grouped by the command's section.
 */
import { COMMANDS, type Command } from '@/renderer/lib/commands';
import { Section } from '../controls';

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Render a command's `keys` (e.g. ['Mod','O']) as display key tokens. */
function displayKeys(keys: string[]): string[] {
  return keys.map((k) => {
    if (k === 'Mod') return IS_MAC ? '⌘' : 'Ctrl';
    if (k === 'Shift') return IS_MAC ? '⇧' : 'Shift';
    if (k === 'Alt') return IS_MAC ? '⌥' : 'Alt';
    if (k === ',') return ',';
    return k.toUpperCase();
  });
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="min-w-[1.5rem] rounded-md border border-line-strong bg-surface-2 px-1.5 py-0.5 text-center font-mono text-[11px] text-fg">
      {children}
    </kbd>
  );
}

export function ShortcutsPanel() {
  const sections = Array.from(new Set(COMMANDS.map((c) => c.section)));
  const bound = (section: string): Command[] =>
    COMMANDS.filter((c) => c.section === section && c.keys && c.keys.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">
          Keyboard shortcuts
        </h3>
        <p className="text-[11px] leading-relaxed text-faint">
          Press <Kbd>{IS_MAC ? '⌘' : 'Ctrl'}</Kbd> <Kbd>K</Kbd> any time to open the command
          palette and run any of these.
        </p>
      </div>

      {sections
        .filter((section) => bound(section).length > 0)
        .map((section) => (
          <Section key={section} title={section}>
            {bound(section).map((cmd) => (
              <div
                key={cmd.id}
                className="flex items-center justify-between gap-4 rounded-md px-2 py-1.5"
              >
                <span className="text-[13px] text-fg">{cmd.title}</span>
                <span className="flex items-center gap-1">
                  {displayKeys(cmd.keys ?? []).map((k, i) => (
                    <Kbd key={i}>{k}</Kbd>
                  ))}
                </span>
              </div>
            ))}
          </Section>
        ))}
    </div>
  );
}
