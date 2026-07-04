/**
 * File explorer for the Files drawer. Renders the synchronized directory tree
 * the File System Layer builds in the main process, with per-language file
 * icons (see lib/fileIcons). Rows follow the same flat, message-style language
 * as the other drawer panels (small type, `hover:bg-surface-2`, truncation).
 * Directories expand/collapse locally; right-click opens the File Writer
 * context menu (new file/folder, rename, delete, copy path, reveal).
 */
import { useState } from 'react';
import { ChevronRight, Folder, FolderOpen } from 'lucide-react';
import type { FileNode } from '@shared/types';
import { cn } from '@/renderer/lib/cn';
import { getFileIcon } from '@/renderer/lib/fileIcons';
import { FileTreeMenu } from './FileTreeMenu';

const INDENT = 12;

interface MenuState {
  node: FileNode | null;
  point: { x: number; y: number };
}

export function FileTree({ workspaceId, nodes }: { workspaceId: string; nodes: FileNode[] }) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  const openMenu = (node: FileNode | null) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ node, point: { x: e.clientX, y: e.clientY } });
  };

  return (
    <div className="flex min-h-full flex-1 flex-col" onContextMenu={openMenu(null)}>
      <ul className="flex flex-col">
        {nodes.map((node) => (
          <TreeRow key={node.path} node={node} depth={0} onMenu={openMenu} />
        ))}
      </ul>
      {menu && (
        <FileTreeMenu
          workspaceId={workspaceId}
          node={menu.node}
          point={menu.point}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  onMenu,
}: {
  node: FileNode;
  depth: number;
  onMenu: (node: FileNode | null) => (e: React.MouseEvent) => void;
}) {
  const [open, setOpen] = useState(false);
  const pad = 6 + depth * INDENT;

  if (node.type === 'file') {
    const { icon: Icon, className } = getFileIcon(node.name, node.isSymlink);
    return (
      <li>
        <div
          className="flex items-center gap-1.5 rounded-md py-1 pr-2 text-[12px] text-fg hover:bg-surface-2"
          style={{ paddingLeft: pad + 14 }}
          title={node.path}
          onContextMenu={onMenu(node)}
        >
          <Icon size={13} className={cn('shrink-0', className)} />
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
        onContextMenu={onMenu(node)}
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
              <TreeRow key={child.path} node={child} depth={depth + 1} onMenu={onMenu} />
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
