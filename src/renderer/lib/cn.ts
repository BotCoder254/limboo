/**
 * Tiny className combiner — joins truthy class strings. Dependency-free; we keep
 * the renderer lean rather than pulling in clsx/tailwind-merge for Phase 1.
 */
export type ClassValue = string | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}
