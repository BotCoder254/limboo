/**
 * Environmental detection for a workspace root. Builds the initial profile —
 * languages, package managers, frameworks, git, Docker — WITHOUT reading source
 * code (that belongs to the Repository Indexer in a later phase).
 *
 * Security (CLAUDE.md §6): git runs via `execFileSync` with an argv array and a
 * fixed `cwd` — never `shell: true`, so nothing in the path is interpreted by a
 * shell. Filesystem reads stay at the workspace root.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { PackageManager, WorkspaceMetadata } from '@shared/types';
import { logger } from '../../logger';

/** Lockfile / manifest → package manager. */
const PACKAGE_MANAGER_MARKERS: Array<[string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
  ['Cargo.toml', 'cargo'],
  ['go.mod', 'go'],
  ['pom.xml', 'maven'],
  ['build.gradle', 'gradle'],
  ['build.gradle.kts', 'gradle'],
  ['requirements.txt', 'pip'],
  ['Pipfile', 'pip'],
  ['pyproject.toml', 'pip'],
];

/** Notable config files → framework / tooling label. */
const FRAMEWORK_MARKERS: Array<[string, string]> = [
  ['vite.config.ts', 'Vite'],
  ['vite.config.js', 'Vite'],
  ['next.config.js', 'Next.js'],
  ['next.config.ts', 'Next.js'],
  ['nuxt.config.ts', 'Nuxt'],
  ['svelte.config.js', 'Svelte'],
  ['angular.json', 'Angular'],
  ['tailwind.config.js', 'Tailwind'],
  ['tsconfig.json', 'TypeScript'],
  ['.eslintrc.json', 'ESLint'],
  ['Dockerfile', 'Docker'],
  ['docker-compose.yml', 'Docker'],
];

/** File extension → language. */
const EXT_LANGUAGE: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.py': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.c': 'C',
  '.h': 'C',
  '.cpp': 'C++',
  '.cs': 'C#',
  '.swift': 'Swift',
  '.css': 'CSS',
  '.html': 'HTML',
};

function exists(root: string, name: string): boolean {
  try {
    return fs.existsSync(path.join(root, name));
  } catch {
    return false;
  }
}

/** Active git branch, or undefined if not a repo / git unavailable. */
function gitBranch(root: string): string | undefined {
  try {
    const out = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: root,
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const branch = out.toString().trim();
    return branch || undefined;
  } catch {
    return undefined;
  }
}

/** Sample top-level + one level of files to guess prevalent languages. */
function detectLanguages(root: string): string[] {
  const counts: Record<string, number> = {};
  const tally = (dir: string, depth: number) => {
    if (depth > 1) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['src', 'app', 'lib', 'packages'].includes(e.name)) tally(full, depth + 1);
      } else {
        const lang = EXT_LANGUAGE[path.extname(e.name).toLowerCase()];
        if (lang) counts[lang] = (counts[lang] ?? 0) + 1;
      }
    }
  };
  tally(root, 0);
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);
}

export function detectWorkspace(root: string): WorkspaceMetadata {
  const packageManagers = PACKAGE_MANAGER_MARKERS.filter(([file]) => exists(root, file)).map(
    ([, pm]) => pm,
  );

  const frameworks = FRAMEWORK_MARKERS.filter(([file]) => exists(root, file)).map(([, fw]) => fw);
  const uniqueFrameworks = [...new Set(frameworks)];

  const hasGit = exists(root, '.git');
  const branch = hasGit ? gitBranch(root) : undefined;
  const hasDocker = exists(root, 'Dockerfile') || exists(root, 'docker-compose.yml');

  try {
    return {
      languages: detectLanguages(root),
      packageManagers: packageManagers.length ? [...new Set(packageManagers)] : ['unknown'],
      frameworks: uniqueFrameworks,
      hasGit,
      branch,
      hasDocker,
    };
  } catch (err) {
    logger.warn('Workspace detection partial failure', err);
    return {
      languages: [],
      packageManagers: ['unknown'],
      frameworks: uniqueFrameworks,
      hasGit,
      branch,
      hasDocker,
    };
  }
}
