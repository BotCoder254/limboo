/**
 * Settings left rail: a search box on top that filters the navigation *and*
 * matches individual settings deeply (by label + keywords), followed by the
 * icon nav list. Selecting a deep-search result jumps to its category and
 * highlights the exact field.
 */
import { Search, CornerDownRight, X } from 'lucide-react';
import { cn } from '@/renderer/lib/cn';
import { SETTINGS_CATALOG, searchCategories, searchFields } from './catalog';

interface SettingsNavProps {
  query: string;
  setQuery: (q: string) => void;
  activeId: string;
  onSelectCategory: (id: string) => void;
  onSelectField: (categoryId: string, fieldId: string) => void;
}

export function SettingsNav({
  query,
  setQuery,
  activeId,
  onSelectCategory,
  onSelectField,
}: SettingsNavProps) {
  const categories = searchCategories(query);
  const fieldHits = searchFields(query);
  const labelFor = (id: string) => SETTINGS_CATALOG.find((c) => c.id === id)?.label ?? id;

  return (
    <div className="flex w-52 shrink-0 flex-col border-r border-line bg-surface">
      <div className="p-2">
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings…"
            spellCheck={false}
            autoFocus
            className="w-full rounded-md border border-line bg-surface-2 py-1.5 pl-8 pr-7 text-[12px] text-fg placeholder:text-faint focus:border-line-strong focus:outline-none"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-faint transition-colors hover:text-fg"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {/* Deep-search field matches */}
        {query && fieldHits.length > 0 && (
          <div className="mb-2">
            <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-faint">
              Matching settings
            </p>
            <ul className="flex flex-col">
              {fieldHits.map((hit) => (
                <li key={`${hit.categoryId}.${hit.fieldId}`}>
                  <button
                    type="button"
                    onClick={() => hit.fieldId && onSelectField(hit.categoryId, hit.fieldId)}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                  >
                    <CornerDownRight size={12} className="shrink-0 text-faint" />
                    <span className="truncate">{hit.label}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-faint">
                      {labelFor(hit.categoryId)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Category nav */}
        {query && (
          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-faint">
            Sections
          </p>
        )}
        {categories.length === 0 ? (
          <p className="px-2 py-3 text-[12px] text-faint">No settings found.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {categories.map((category) => {
              const active = category.id === activeId;
              const Icon = category.icon;
              return (
                <li key={category.id}>
                  <button
                    type="button"
                    onClick={() => onSelectCategory(category.id)}
                    className={cn(
                      'relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors',
                      active
                        ? 'bg-surface-2 text-fg'
                        : 'text-muted hover:bg-surface-2 hover:text-fg',
                    )}
                  >
                    {active && (
                      <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent" />
                    )}
                    <Icon size={15} className={active ? 'text-accent' : 'text-faint'} />
                    <span className="truncate">{category.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </div>
  );
}
