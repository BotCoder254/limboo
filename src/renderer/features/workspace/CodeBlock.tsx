/**
 * A fenced code block in the conversation: Shiki-highlighted, with a language
 * badge, a persistent copy button, gutter line numbers (added in CSS from
 * Shiki's per-line spans), and horizontal scroll that never disrupts the
 * surrounding message. While a message is still streaming we render plain text
 * (highlighting kicks in once the block settles) to avoid re-highlighting on
 * every token.
 */
import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/renderer/lib/cn';
import { highlightCode } from '@/renderer/lib/highlight';

export function CodeBlock({
  code,
  lang,
  streaming = false,
}: {
  code: string;
  lang?: string;
  streaming?: boolean;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    if (streaming) {
      setHtml(null);
      return;
    }
    void highlightCode(code, lang).then((result) => {
      if (alive) setHtml(result);
    });
    return () => {
      alive = false;
    };
  }, [code, lang, streaming]);

  const copy = () => {
    void window.limboo?.system?.clipboardWrite(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-line bg-[#0a0a0a]">
      <div className="flex items-center justify-between border-b border-line/70 bg-surface px-3 py-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
          {lang || 'text'}
        </span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-elevated hover:text-fg"
        >
          {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {html ? (
        <div className="limboo-code overflow-x-auto text-[12.5px]" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className={cn('limboo-code overflow-x-auto px-3 py-2.5 text-[12.5px]')}>
          <code className="font-mono text-fg">{code}</code>
        </pre>
      )}
    </div>
  );
}
