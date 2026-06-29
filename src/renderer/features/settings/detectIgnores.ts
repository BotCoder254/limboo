/**
 * Map a workspace's detected stack (package managers / frameworks / languages)
 * to recommended ignore directories. Pure + advisory: the Workspace panel offers
 * these as a one-click suggestion the user can apply or ignore — never silently
 * applied, never clobbering existing entries.
 */
import type { WorkspaceMetadata } from '@shared/types';

const BY_PACKAGE_MANAGER: Record<string, string[]> = {
  npm: ['node_modules', 'dist', 'build', 'coverage'],
  pnpm: ['node_modules', 'dist', 'build', 'coverage', '.turbo'],
  yarn: ['node_modules', 'dist', 'build', 'coverage'],
  bun: ['node_modules', 'dist', 'build'],
  cargo: ['target'],
  go: ['bin', 'vendor'],
  maven: ['target'],
  gradle: ['build', '.gradle'],
  pip: ['__pycache__', '.venv', 'venv', '.mypy_cache', '.pytest_cache', 'dist', 'build'],
};

const BY_FRAMEWORK: Record<string, string[]> = {
  'Next.js': ['.next'],
  Vite: ['dist'],
  Nuxt: ['.nuxt', '.output'],
  Angular: ['dist', '.angular'],
  Svelte: ['.svelte-kit'],
};

/** Recommended ignore dirs for a workspace, deduped and sorted. */
export function suggestedIgnores(metadata: WorkspaceMetadata): string[] {
  const set = new Set<string>();
  for (const pm of metadata.packageManagers) {
    for (const dir of BY_PACKAGE_MANAGER[pm] ?? []) set.add(dir);
  }
  for (const fw of metadata.frameworks) {
    for (const dir of BY_FRAMEWORK[fw] ?? []) set.add(dir);
  }
  return [...set].sort();
}

/** A short, human label describing the detected stack (for the "Detected" row). */
export function detectedStack(metadata: WorkspaceMetadata): string[] {
  return [
    ...metadata.languages.slice(0, 3),
    ...metadata.frameworks,
    ...(metadata.hasDocker ? ['Docker'] : []),
  ];
}
