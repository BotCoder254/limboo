/**
 * Renders assistant message text as sanitized GitHub-flavored Markdown:
 * headings, lists, tables, inline code, and fenced code blocks (delegated to
 * {@link CodeBlock}). Links never navigate the renderer — they open in the OS
 * browser through the preload bridge. All HTML is sanitized via `rehype-sanitize`
 * (no raw HTML injection); the only trusted HTML is Shiki's output inside
 * CodeBlock, which we generate ourselves.
 *
 * Streaming performance: re-parsing the *entire* accumulated message on every
 * token is O(n²) over a reply and is the dominant cause of streaming jank. While
 * a message is still streaming we split it into fence-aware top-level blocks and
 * render each through a `React.memo`'d block component — earlier blocks are
 * byte-identical between renders so React skips them, and only the final, growing
 * block re-parses (O(size of current block) per delta). Once the message settles
 * we render the whole text in one pass so the final output is always exact
 * (loose lists, multi-block list items, etc. are never affected).
 */
import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import type { Components } from 'react-markdown';
import { CodeBlock } from './CodeBlock';

function openExternal(href?: string) {
  if (!href) return;
  void window.limboo?.system?.openExternal(href);
}

function buildComponents(streaming: boolean): Components {
  return {
    a({ href, children }) {
      return (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            openExternal(href);
          }}
          className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
        >
          {children}
        </a>
      );
    },
    // Fenced blocks render through CodeBlock; `pre` just unwraps so we don't
    // double-wrap. Inline code keeps a subtle pill.
    pre({ children }) {
      return <>{children}</>;
    },
    code({ className, children }) {
      const text = String(children ?? '').replace(/\n$/, '');
      const match = /language-([\w-]+)/.exec(className || '');
      const isBlock = !!match || text.includes('\n');
      if (!isBlock) {
        return (
          <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-accent-fg">
            {children}
          </code>
        );
      }
      return <CodeBlock code={text} lang={match?.[1]} streaming={streaming} />;
    },
  };
}

// The `components` object is identity-stable (one per streaming flag) so
// react-markdown's internal memoization isn't defeated by a fresh object each
// render. Building it inline on every render was a needless allocation.
const COMPONENTS_STATIC = buildComponents(false);
const COMPONENTS_STREAMING = buildComponents(true);

/**
 * Split markdown into top-level blocks on blank lines, treating fenced code
 * regions (``` or ~~~) as atomic so a blank line *inside* a fence never splits
 * it. Used only while streaming, purely for render memoization.
 */
function splitBlocks(text: string): string[] {
  const lines = text.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null; // the opening fence marker while inside a block

  const flush = () => {
    if (current.length) {
      blocks.push(current.join('\n'));
      current = [];
    }
  };

  for (const line of lines) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      current.push(line);
      // Close only on a matching (or longer) fence of the same kind.
      if (fenceMatch && line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (fenceMatch) {
      // Entering a fenced block — keep it attached to whatever preceded it on the
      // same paragraph is unusual, so start it cleanly as its own block.
      flush();
      fence = fenceMatch[1];
      current.push(line);
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

/** One memoized markdown block. Re-renders only when its own text changes. */
const MarkdownBlock = memo(function MarkdownBlock({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSanitize]}
      components={COMPONENTS_STREAMING}
    >
      {text}
    </ReactMarkdown>
  );
});

export const Markdown = memo(function Markdown({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  // While streaming, render block-by-block so only the last (growing) block
  // re-parses per delta. Once settled, render the whole document in one pass so
  // the final output is always exact.
  const blocks = useMemo(() => (streaming ? splitBlocks(text) : null), [streaming, text]);

  return (
    <div className="limboo-md text-[13.5px] leading-relaxed text-fg">
      {blocks ? (
        blocks.map((block, i) => <MarkdownBlock key={i} text={block} />)
      ) : (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={COMPONENTS_STATIC}
        >
          {text}
        </ReactMarkdown>
      )}
    </div>
  );
});
