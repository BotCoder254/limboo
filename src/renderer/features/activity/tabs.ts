import {
  Activity,
  Brain,
  FileDiff,
  Folder,
  GitBranch,
  ListTodo,
  SquareTerminal,
  TerminalSquare,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { ActivityTab } from '@shared/types';

export interface TabMeta {
  id: ActivityTab;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}

/** The right-rail tabs, in display order. */
export const ACTIVITY_TABS: TabMeta[] = [
  { id: 'files', label: 'Files', icon: Folder },
  { id: 'changes', label: 'Changes', icon: FileDiff },
  { id: 'git', label: 'Git', icon: GitBranch },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'console', label: 'Console', icon: TerminalSquare },
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal },
];
