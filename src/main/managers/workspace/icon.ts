/**
 * Deterministic, background-less project icon. Derives 1–2 initials from the
 * project name and a stable hue so the same project always looks the same. The
 * renderer draws this on-palette (accent ring/text), never as a filled
 * background — per the dark-only theme rule.
 */
import type { WorkspaceIcon } from '@shared/types';

export function deriveIcon(name: string): WorkspaceIcon {
  const cleaned = name.replace(/[^a-zA-Z0-9]+/g, ' ').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);

  let initials: string;
  if (words.length >= 2) {
    initials = (words[0][0] + words[1][0]).toUpperCase();
  } else if (words.length === 1) {
    initials = words[0].slice(0, 2).toUpperCase();
  } else {
    initials = '··';
  }

  // Stable hue from a simple string hash.
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;

  return { initials, hue };
}
