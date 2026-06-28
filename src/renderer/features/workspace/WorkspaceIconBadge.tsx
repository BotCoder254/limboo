/**
 * Renders a workspace's deterministic project glyph: initials inside a rounded
 * square, tinted by the workspace's stable hue. Per the dark-only theme rule the
 * fill stays transparent — only the border and text carry the hue.
 */
import type { WorkspaceIcon } from '@shared/types';
import { cn } from '@/renderer/lib/cn';

export function WorkspaceIconBadge({
  icon,
  size = 32,
  className,
}: {
  icon: WorkspaceIcon;
  size?: number;
  className?: string;
}) {
  const color = `hsl(${icon.hue} 70% 70%)`;
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md border font-semibold',
        className,
      )}
      style={{
        width: size,
        height: size,
        borderColor: color,
        color,
        fontSize: Math.round(size * 0.4),
      }}
      aria-hidden
    >
      {icon.initials}
    </span>
  );
}
