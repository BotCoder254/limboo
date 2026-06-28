/**
 * Read-only file explorer for the Files drawer. Renders the synchronized
 * directory tree the File System Layer builds in the main process. Rows follow
 * the same flat, message-style language as the other drawer panels (small type,
 * `hover:bg-surface-2`, truncation). Directories expand/collapse locally; files
 * are leaves (opening/preview is wired in a later phase).
 */
import { useState } from 'react';
import { ChevronRight, File, Folder, FolderOpen, Link2 } from 'lucide-react';
import type { FileNode } from '@shared/types';
import { cn } from '@/renderer/lib/cn';

const INDENT = 12;

export function FileTree({ nodes }: { nodes: FileNode[] }) {
  return (
    <ul className="flex flex-col">
      {nodes.map((node) => (
        <TreeRow key={node.path} node={node} depth={0} />
      ))}
    </ul>
  );
}

function TreeRow({ node, depth }: { node: FileNode; depth: number }) {
  const [open, setOpen] = useState(false);
  const pad = 6 + depth * INDENT;

  if (node.type === 'file') {
    return (
      <li>
        <div
          className="flex items-center gap-1.5 rounded-md py-1 pr-2 text-[12px] text-fg hover:bg-surface-2"
          style={{ paddingLeft: pad + 14 }}
          title={node.path}
        >
          {node.isSymlink ? (
            <Link2 size={13} className="shrink-0 text-faint" />
          ) : (
            <File size={13} className="shrink-0 text-faint" />
          )}
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        </div>
      </li>
    );
  }

  const children = node.children ?? [];
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 rounded-md py-1 pr-2 text-[12px] text-fg hover:bg-surface-2"
        style={{ paddingLeft: pad }}
        title={node.path}
      >
        <ChevronRight
          size={12}
          className={cn('shrink-0 text-faint transition-transform', open && 'rotate-90')}
        />
        {open ? (
          <FolderOpen size={13} className="shrink-0 text-muted" />
        ) : (
          <Folder size={13} className="shrink-0 text-muted" />
        )}
        <span className="min-w-0 flex-1 truncate text-left">{node.name}</span>
      </button>
      {open &&
        (children.length > 0 ? (
          <ul className="flex flex-col">
            {children.map((child) => (
              <TreeRow key={child.path} node={child} depth={depth + 1} />
            ))}
          </ul>
        ) : (
          <p
            className="py-1 text-[11px] italic text-faint"
            style={{ paddingLeft: pad + 26 }}
          >
            {node.truncated ? 'Not indexed (depth limit)' : 'Empty'}
          </p>
        ))}
    </li>
  );
}
