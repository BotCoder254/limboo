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
import { createContext, useContext, useEffect, useRef } from 'react';
import { cn } from '@/renderer/lib/cn';

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

export function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
        checked ? 'bg-accent' : 'bg-surface-2',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-fg transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
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
