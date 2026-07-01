/**
 * A tiny typewriter effect for placeholder text. Cycles a list of phrases,
 * typing each one out character-by-character, holding, deleting, and advancing
 * to the next in a loop. Returns the current partial string, so callers can drop
 * it straight into a placeholder/label.
 *
 * Respects the app's reduced-motion preference (the settings store mirrors it to
 * `document.documentElement.dataset.reducedMotion`): when reduced, it returns the
 * first phrase statically and never animates. Purely presentational; no state
 * escapes the hook and the timer is always cleaned up.
 */
import { useEffect, useState } from 'react';

interface Options {
  /** ms per character while typing. */
  typeMs?: number;
  /** ms per character while deleting. */
  deleteMs?: number;
  /** ms to hold a fully-typed phrase before deleting. */
  holdMs?: number;
  /** Pause the animation (e.g. once the user starts typing their own query). */
  paused?: boolean;
}

function prefersReducedMotion(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.reducedMotion === 'true';
}

export function useTypewriter(phrases: string[], options: Options = {}): string {
  const { typeMs = 55, deleteMs = 28, holdMs = 1400, paused = false } = options;
  const first = phrases[0] ?? '';
  const [text, setText] = useState(first);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (paused || prefersReducedMotion() || phrases.length === 0) return;

    const phrase = phrases[phraseIndex % phrases.length];

    // Fully typed → hold, then start deleting.
    if (!deleting && text === phrase) {
      const t = setTimeout(() => setDeleting(true), holdMs);
      return () => clearTimeout(t);
    }
    // Fully deleted → advance to the next phrase and type again.
    if (deleting && text === '') {
      setDeleting(false);
      setPhraseIndex((i) => (i + 1) % phrases.length);
      return;
    }

    const next = deleting ? phrase.slice(0, text.length - 1) : phrase.slice(0, text.length + 1);
    const t = setTimeout(() => setText(next), deleting ? deleteMs : typeMs);
    return () => clearTimeout(t);
  }, [text, deleting, phraseIndex, phrases, paused, typeMs, deleteMs, holdMs]);

  // When paused (or reduced motion), show a stable, fully-typed phrase.
  if (paused || prefersReducedMotion()) return first;
  return text;
}
