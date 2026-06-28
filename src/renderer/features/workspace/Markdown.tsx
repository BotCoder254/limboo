/**
 * Renders assistant message text as sanitized GitHub-flavored Markdown:
 * headings, lists, tables, inline code, and fenced code blocks (delegated to
 * {@link CodeBlock}). Links never navigate the renderer — they open in the OS
 * browser through the preload bridge. All HTML is sanitized via `rehype-sanitize`
 * (no raw HTML injection); the only trusted HTML is Shiki's output inside
 * CodeBlock, which we generate ourselves.
 */
import { memo } from 'react';
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

export const Markdown = memo(function Markdown({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  return (
    <div className="limboo-md text-[13.5px] leading-relaxed text-fg">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={buildComponents(streaming)}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
