/**
 * Shared, presentational controls for the Settings panels. Extracted so every
 * category panel renders identical primitives (Section / Field / Toggle /
 * SegmentedControl / TextInput / Meta) on the same dark-only token palette.
 *
 * `Field` participates in the deep-search "jump & highlight" behaviour: when the
 * search results select a specific setting, its `id` is published through
 * {@link SettingsHighlightContext} and the matching `Field` scrolls into view and
 * flashes an accent ring.
 */
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Check, RotateCcw, Wand2 } from 'lucide-react';
import { cn } from '@/renderer/lib/cn';

/** Hard cap on raw-JSON editor input — guards against pathological paste. */
const JSON_EDITOR_MAX = 200_000;

/** The id of the field the search wants to reveal, or `null`. */
export const SettingsHighlightContext = createContext<string | null>(null);

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">{title}</h3>
        {hint && <p className="text-[11px] leading-relaxed text-faint">{hint}</p>}
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  );
}

export function Field({
  id,
  label,
  hint,
  children,
}: {
  /** Stable id used by deep-search to scroll-to + highlight this row. */
  id?: string;
  label: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  const highlightId = useContext(SettingsHighlightContext);
  const ref = useRef<HTMLDivElement>(null);
  const active = !!id && highlightId === id;

  useEffect(() => {
    if (active && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [active]);

  return (
    <div
      ref={ref}
      data-field-id={id}
      className={cn(
        'flex items-center justify-between gap-4 rounded-md px-2 py-2 transition-colors',
        active ? 'bg-surface-2 ring-1 ring-accent' : 'ring-1 ring-transparent',
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13px] text-fg">{label}</span>
        {hint && <span className="text-[11px] leading-relaxed text-faint">{hint}</span>}
      </div>
      {children != null && <div className="shrink-0">{children}</div>}
    </div>
  );
}

/** Full-width field (label on top, control below) for inputs/textareas. */
export function StackedField({
  id,
  label,
  hint,
  children,
}: {
  id?: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const highlightId = useContext(SettingsHighlightContext);
  const ref = useRef<HTMLDivElement>(null);
  const active = !!id && highlightId === id;

  useEffect(() => {
    if (active && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [active]);

  return (
    <div
      ref={ref}
      data-field-id={id}
      className={cn(
        'flex flex-col gap-1.5 rounded-md px-2 py-2 transition-colors',
        active ? 'bg-surface-2 ring-1 ring-accent' : 'ring-1 ring-transparent',
      )}
    >
      <span className="text-[13px] text-fg">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-relaxed text-faint">{hint}</span>}
    </div>
  );
}

export function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-2 py-1">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="font-mono text-[12px] text-faint">{value}</dd>
    </div>
  );
}

/**
 * Accessible switch. Sized in **fixed px** (not rem) on purpose: the document
 * root font-size is `calc(16px * var(--limboo-font-scale))`, so rem-based track/
 * thumb sizing drifts out of alignment (and visually "overflows") at non-default
 * font scales or in compact density. Fixed px keeps the thumb travel exact at any
 * scale. WAI-ARIA `switch` role + `aria-checked` + keyboard activation (native to
 * `<button>`) + a visible focus ring.
 */
export function Toggle({
  checked,
  onChange,
  disabled,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[20px] w-[36px] shrink-0 cursor-pointer rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-base',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-surface-2',
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] h-[16px] w-[16px] rounded-full bg-fg transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-line bg-surface-2 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-md px-2.5 py-1 text-[12px] transition-colors',
            value === option.value ? 'bg-elevated text-fg' : 'text-muted hover:text-fg',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Compact native select styled on the dark palette — for numeric presets. */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <select
      value={String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        const match = options.find((o) => String(o.value) === raw);
        if (match) onChange(match.value);
      }}
      className="w-44 rounded-md border border-line bg-surface-2 px-2 py-1 text-[12px] text-fg focus:border-line-strong focus:outline-none"
    >
      {options.map((option) => (
        <option key={String(option.value)} value={String(option.value)}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function TextInput({
  value,
  placeholder,
  onChange,
  onBlur,
}: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      className="w-48 rounded-md border border-line bg-surface-2 px-2 py-1 text-[12px] text-fg placeholder:text-faint focus:border-line-strong focus:outline-none"
    />
  );
}

/**
 * Raw-JSON editor for advanced settings. Renders the supplied object as formatted
 * JSON in a monospace textarea, validates on every keystroke (inline error), and
 * commits the parsed object via `onSave`. Saving always routes through the
 * existing validated `settings:set` path (deep-merge + clamp + migrate +
 * prototype-pollution rejection), so the editor itself stays purely presentational
 * and never `eval`s anything.
 */
export function JsonEditor<T>({
  value,
  onSave,
  rows = 12,
}: {
  value: T;
  onSave: (parsed: T) => void | Promise<void>;
  rows?: number;
}) {
  const formatted = useRef('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);

  // Re-seed the draft when the upstream value changes (hydrate / external edit),
  // but only while the user hasn't diverged from the last formatted snapshot.
  useEffect(() => {
    const next = JSON.stringify(value, null, 2);
    if (draft === '' || draft === formatted.current) {
      setDraft(next);
      setError(null);
    }
    formatted.current = next;
  }, [value]);

  const dirty = draft !== formatted.current;

  const parse = (text: string): T | null => {
    if (text.length > JSON_EDITOR_MAX) {
      setError(`Too large (max ${JSON_EDITOR_MAX.toLocaleString()} chars).`);
      return null;
    }
    try {
      const parsed = JSON.parse(text) as T;
      setError(null);
      return parsed;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON');
      return null;
    }
  };

  const onChange = (text: string) => {
    setDraft(text);
    parse(text);
  };

  const format = () => {
    const parsed = parse(draft);
    if (parsed != null) setDraft(JSON.stringify(parsed, null, 2));
  };

  const revert = () => {
    setDraft(formatted.current);
    setError(null);
  };

  const save = async () => {
    const parsed = parse(draft);
    if (parsed == null) return;
    setSaving(true);
    try {
      await onSave(parsed);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        rows={rows}
        className={cn(
          'w-full resize-y rounded-md border bg-surface-2 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-fg focus:outline-none',
          error ? 'border-danger focus:border-danger' : 'border-line focus:border-line-strong',
        )}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={format}
          className="flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px] text-muted transition-colors hover:text-fg"
        >
          <Wand2 size={12} /> Format
        </button>
        <button
          type="button"
          onClick={revert}
          disabled={!dirty}
          className="flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px] text-muted transition-colors hover:text-fg disabled:opacity-40"
        >
          <RotateCcw size={12} /> Revert
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!!error || !dirty || saving}
          className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-base transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Check size={12} /> {saving ? 'Saving…' : 'Save'}
        </button>
        {error ? (
          <span className="truncate text-[11px] text-danger" title={error}>
            {error}
          </span>
        ) : (
          savedAt > 0 &&
          !dirty && <span className="text-[11px] text-success">Saved</span>
        )}
      </div>
    </div>
  );
}
