/**
 * SentenceSegmenter — turns a streaming markdown token stream (agent
 * `message-delta` events) into clean, speakable sentences for progressive TTS.
 *
 * Markdown is stripped (code blocks dropped entirely, inline syntax unwrapped)
 * and text is emitted sentence-by-sentence as boundaries become certain, so
 * speech can begin while the rest of the response is still streaming.
 */

const MIN_SENTENCE_CHARS = 12;

/** Strip markdown down to speakable plain text. */
export function stripMarkdown(text: string): string {
  return (
    text
      // Fenced code blocks read terribly aloud — drop them wholesale.
      .replace(/```[\s\S]*?```/g, ' ')
      // Inline code: keep the content, drop the backticks.
      .replace(/`([^`]*)`/g, '$1')
      // Images entirely; links keep their label.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Headings / blockquotes / list markers at line starts.
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
      // Emphasis markers.
      .replace(/(\*\*|__|\*|_|~~)/g, '')
      // Tables: pipes become pauses.
      .replace(/\|/g, ', ')
      // Horizontal rules.
      .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Incremental segmenter for ONE streaming message. Feed raw markdown deltas
 * with {@link push}; call {@link flush} when the message completes.
 */
export class SentenceSegmenter {
  /** Raw (markdown) tail not yet emitted. */
  private buffer = '';
  /** True while inside an unclosed ``` fence (never emit from inside). */
  private inFence = false;

  /** Feed a delta; returns any sentences that became complete. */
  push(delta: string): string[] {
    this.buffer += delta;
    return this.drain(false);
  }

  /** Message finished — emit whatever remains. */
  flush(): string[] {
    const out = this.drain(true);
    this.buffer = '';
    this.inFence = false;
    return out;
  }

  private drain(final: boolean): string[] {
    const sentences: string[] = [];

    // Track fence state across the whole buffer so a sentence boundary inside
    // a code block never triggers speech.
    for (;;) {
      const fenceCount = (this.buffer.match(/```/g) ?? []).length;
      this.inFence = fenceCount % 2 === 1;
      if (this.inFence && !final) return sentences;

      const boundary = this.findBoundary();
      if (boundary === -1) break;
      const raw = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary);
      const clean = stripMarkdown(raw);
      if (clean.length >= MIN_SENTENCE_CHARS) sentences.push(clean);
    }

    if (final) {
      const clean = stripMarkdown(this.buffer);
      this.buffer = '';
      // The trailing fragment can be short ("Done.") — still worth speaking.
      if (clean.length > 1) sentences.push(clean);
    }
    return sentences;
  }

  /**
   * Index just past the earliest *certain* sentence boundary, or -1. A
   * boundary is a sentence terminator followed by whitespace (so "3.14" or a
   * trailing "…" still being streamed never splits), or a blank line.
   */
  private findBoundary(): number {
    const text = this.buffer;
    const para = text.indexOf('\n\n');
    let best = para === -1 ? -1 : para + 2;

    const punct = /[.!?…]["')\]]*\s/g;
    let m: RegExpExecArray | null;
    while ((m = punct.exec(text)) !== null) {
      const end = m.index + m[0].length;
      // Skip decimal points / version numbers: digit on both sides.
      const before = text[m.index - 1] ?? '';
      const after = text[end] ?? '';
      if (/\d/.test(before) && /\d/.test(after)) continue;
      if (end < MIN_SENTENCE_CHARS) continue;
      if (best === -1 || end < best) best = end;
      break;
    }
    return best;
  }
}
