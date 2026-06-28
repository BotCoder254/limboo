/**
 * Groundable repository statistics — everything that can be computed now without
 * the (later-phase) indexing/search engines. A bounded filesystem walk keeps the
 * main process responsive; ignored dirs are skipped.
 *
 * Security (CLAUDE.md §6): the walk stays inside the workspace root (it only ever
 * descends into entries of the root) and git runs via argv `execFileSync`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { WorkspaceConfig, WorkspaceStats } from '@shared/types';
import { isInsideRoot } from './validate';

/** Hard ceiling so an enormous tree can never stall the main process. */
const MAX_FILES = 50_000;

const EXT_LANGUAGE: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.py': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.java': 'Java',
  '.rb': 'Ruby',
  '.css': 'CSS',
  '.html': 'HTML',
};

function commitCount(root: string): number | undefined {
  try {
    const out = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: root,
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const n = Number(out.toString().trim());
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

function dependencyCount(root: string): number {
  try {
    const pkgPath = path.join(root, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      return Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length;
    }
  } catch {
    /* ignore malformed manifest */
  }
  return 0;
}

export function computeStats(root: string, config: WorkspaceConfig): WorkspaceStats {
  const ignored = new Set(config.ignoredDirs);
  const languageBreakdown: Record<string, number> = {};
  let fileCount = 0;
  let sizeBytes = 0;

  const walk = (dir: string) => {
    if (fileCount >= MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (fileCount >= MAX_FILES) return;
      const full = path.join(dir, e.name);
      if (!isInsideRoot(root, full)) continue; // traversal guard
      if (e.isSymbolicLink()) continue; // never follow symlinks out of the tree
      if (e.isDirectory()) {
        if (ignored.has(e.name) || e.name.startsWith('.')) continue;
        walk(full);
      } else if (e.isFile()) {
        fileCount += 1;
        try {
          sizeBytes += fs.statSync(full).size;
        } catch {
          /* ignore */
        }
        const lang = EXT_LANGUAGE[path.extname(e.name).toLowerCase()];
        if (lang) languageBreakdown[lang] = (languageBreakdown[lang] ?? 0) + 1;
      }
    }
  };
  walk(root);

  return {
    fileCount,
    sizeBytes,
    languageBreakdown,
    dependencyCount: dependencyCount(root),
    commitCount: commitCount(root),
  };
}
