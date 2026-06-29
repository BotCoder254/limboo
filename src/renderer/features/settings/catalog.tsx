/**
 * Settings catalog — the single source of truth for the Settings UI. Each
 * category declares its icon, search keywords, the searchable fields it contains
 * (with stable ids that the panels mark via `Field id=…` for jump-to-highlight),
 * and the panel component that renders it. The nav, routing, and deep search all
 * derive from this array, so adding a setting means editing one place.
 */
import {
  Settings2,
  Contrast,
  FolderGit2,
  Bell,
  Bot,
  GitBranch,
  Keyboard,
  Info,
  TerminalSquare,
  type LucideIcon,
} from 'lucide-react';
import { GeneralPanel } from './panels/GeneralPanel';
import { AppearancePanel } from './panels/AppearancePanel';
import { WorkspacePanel } from './panels/WorkspacePanel';
import { BehaviorPanel } from './panels/BehaviorPanel';
import { AgentPanel } from './panels/AgentPanel';
import { TerminalPanel } from './panels/TerminalPanel';
import { GitPanel } from './panels/GitPanel';
import { ShortcutsPanel } from './panels/ShortcutsPanel';
import { AboutPanel } from './panels/AboutPanel';

export interface SettingsField {
  /** Stable id, matched to a `Field id=…` in the panel for scroll + highlight. */
  id: string;
  label: string;
  keywords?: string[];
}

export interface SettingsCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  keywords?: string[];
  fields: SettingsField[];
  Panel: React.ComponentType;
}

export const SETTINGS_CATALOG: SettingsCategory[] = [
  {
    id: 'general',
    label: 'General',
    icon: Settings2,
    keywords: ['reset', 'defaults', 'restore', 'privacy', 'local'],
    fields: [{ id: 'reset', label: 'Restore defaults', keywords: ['reset', 'clear', 'factory'] }],
    Panel: GeneralPanel,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: Contrast,
    keywords: ['theme', 'dark', 'look', 'ui'],
    fields: [
      { id: 'density', label: 'Density', keywords: ['compact', 'comfortable', 'spacing'] },
      { id: 'fontScale', label: 'Font scale', keywords: ['text size', 'zoom', 'font'] },
      { id: 'reducedMotion', label: 'Reduce motion', keywords: ['animation', 'accessibility'] },
    ],
    Panel: AppearancePanel,
  },
  {
    id: 'workspace',
    label: 'Workspace',
    icon: FolderGit2,
    keywords: ['project', 'repo', 'folder', 'git'],
    fields: [
      { id: 'approveTerminal', label: 'Approve terminal commands', keywords: ['shell', 'safety'] },
      { id: 'preferredShell', label: 'Preferred shell', keywords: ['bash', 'zsh', 'terminal'] },
      { id: 'ignoredDirs', label: 'Ignored directories', keywords: ['exclude', 'node_modules', 'index'] },
      { id: 'rescan', label: 'Refresh & reindex', keywords: ['rescan', 'reindex', 'detect', 'index', 'files'] },
    ],
    Panel: WorkspacePanel,
  },
  {
    id: 'behavior',
    label: 'Behavior',
    icon: Bell,
    keywords: ['notifications', 'tray', 'background'],
    fields: [
      { id: 'notifications', label: 'Desktop notifications', keywords: ['alerts', 'notify'] },
      { id: 'tray', label: 'Keep running in tray', keywords: ['minimize', 'background', 'close'] },
    ],
    Panel: BehaviorPanel,
  },
  {
    id: 'agent',
    label: 'Agent',
    icon: Bot,
    keywords: ['claude', 'claude code', 'ai', 'model', 'orchestrate', 'permissions', 'web search', 'connection', 'reliability', 'heartbeat', 'reconnect', 'recovery', 'diagnostics'],
    fields: [
      { id: 'model', label: 'Model', keywords: ['sonnet', 'opus', 'haiku', 'claude', 'anthropic', 'provider'] },
      { id: 'thinking', label: 'Extended thinking', keywords: ['reasoning', 'adaptive'] },
      { id: 'permissionMode', label: 'Approval policy', keywords: ['permissions', 'approve', 'safety'] },
      { id: 'autoApproveReads', label: 'Auto-approve reads', keywords: ['read', 'permission'] },
      { id: 'webSearch', label: 'Web search', keywords: ['internet', 'search', 'browse'] },
      { id: 'maxTurns', label: 'Max turns per run', keywords: ['turns', 'steps', 'budget'] },
      { id: 'heartbeatInterval', label: 'Heartbeat interval', keywords: ['health', 'monitor', 'connection', 'reliability'] },
      { id: 'heartbeatFailureThreshold', label: 'Heartbeat failures before reconnecting', keywords: ['reconnect', 'reliability', 'health'] },
      { id: 'maxRecoveryAttempts', label: 'Max recovery attempts', keywords: ['recover', 'retry', 'reconnect', 'reliability'] },
      { id: 'reconnectDelay', label: 'Reconnect delay', keywords: ['retry', 'backoff', 'recover'] },
      { id: 'idleTimeout', label: 'Idle refresh', keywords: ['idle', 'timeout'] },
      { id: 'autoRestart', label: 'Auto-restart after crashes', keywords: ['restart', 'recover', 'crash'] },
      { id: 'sessionPersistence', label: 'Persist sessions & diagnostics', keywords: ['persist', 'history', 'database'] },
      { id: 'connectivityNotifications', label: 'Connectivity notifications', keywords: ['notify', 'reconnect', 'rate limit'] },
      { id: 'logVerbosity', label: 'Log verbosity', keywords: ['diagnostics', 'console', 'debug', 'log'] },
    ],
    Panel: AgentPanel,
  },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: TerminalSquare,
    keywords: ['terminal', 'shell', 'pty', 'console', 'command', 'bash', 'zsh', 'xterm'],
    fields: [
      { id: 'terminalShell', label: 'Default shell', keywords: ['bash', 'zsh', 'fish', 'shell'] },
      { id: 'terminalFontFamily', label: 'Font family', keywords: ['font', 'mono', 'typeface'] },
      { id: 'terminalFontSize', label: 'Font size', keywords: ['font', 'size', 'text'] },
      { id: 'terminalCursorStyle', label: 'Cursor style', keywords: ['cursor', 'block', 'bar'] },
      { id: 'terminalCursorBlink', label: 'Blink cursor', keywords: ['cursor', 'blink'] },
      { id: 'terminalScrollback', label: 'Scrollback', keywords: ['history', 'lines', 'buffer'] },
      { id: 'terminalCopyOnSelect', label: 'Copy on select', keywords: ['clipboard', 'copy'] },
      { id: 'terminalConfirmKill', label: 'Confirm before closing', keywords: ['close', 'kill', 'confirm'] },
      { id: 'terminalMirrorAgent', label: 'Mirror agent commands', keywords: ['agent', 'mirror', 'command'] },
    ],
    Panel: TerminalPanel,
  },
  {
    id: 'git',
    label: 'Git',
    icon: GitBranch,
    keywords: ['git', 'commit', 'branch', 'checkpoint', 'version control', 'diff', 'stage', 'author', 'identity'],
    fields: [
      { id: 'gitUserName', label: 'Author name', keywords: ['user.name', 'identity', 'commit'] },
      { id: 'gitUserEmail', label: 'Author email', keywords: ['user.email', 'identity', 'commit'] },
      { id: 'gitCommitTemplate', label: 'Commit message template', keywords: ['message', 'prefix'] },
      { id: 'gitSuggestCommit', label: 'Suggest message from conversation', keywords: ['ai', 'message'] },
      { id: 'gitAutoCheckpoint', label: 'Auto-checkpoint before agent edits', keywords: ['snapshot', 'recovery', 'safety'] },
      { id: 'gitMaxCheckpoints', label: 'Max checkpoints per session', keywords: ['prune', 'snapshot'] },
      { id: 'gitConfirmBranchSwitch', label: 'Confirm branch switch with changes', keywords: ['checkout', 'dirty', 'safety'] },
      { id: 'gitCommandApproval', label: 'Require approval for git operations', keywords: ['safety', 'confirm', 'destructive'] },
    ],
    Panel: GitPanel,
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    icon: Keyboard,
    keywords: ['keyboard', 'keys', 'hotkeys', 'bindings', 'command palette'],
    fields: [],
    Panel: ShortcutsPanel,
  },
  {
    id: 'about',
    label: 'About',
    icon: Info,
    keywords: ['version', 'electron', 'node', 'chromium', 'platform'],
    fields: [{ id: 'version', label: 'Version', keywords: ['build', 'release'] }],
    Panel: AboutPanel,
  },
];

export interface SearchHit {
  categoryId: string;
  fieldId?: string;
  label: string;
}

/** Match a category (and its fields) against a lowercased query. */
function matchesCategory(category: SettingsCategory, q: string): boolean {
  if (category.label.toLowerCase().includes(q)) return true;
  if (category.keywords?.some((k) => k.toLowerCase().includes(q))) return true;
  return category.fields.some((f) => fieldMatches(f, q));
}

function fieldMatches(field: SettingsField, q: string): boolean {
  if (field.label.toLowerCase().includes(q)) return true;
  return field.keywords?.some((k) => k.toLowerCase().includes(q)) ?? false;
}

/** Categories that match the query (for filtering the nav). */
export function searchCategories(query: string): SettingsCategory[] {
  const q = query.trim().toLowerCase();
  if (!q) return SETTINGS_CATALOG;
  return SETTINGS_CATALOG.filter((c) => matchesCategory(c, q));
}

/** Flat list of individual field matches (for the deep-search results list). */
export function searchFields(query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const category of SETTINGS_CATALOG) {
    for (const field of category.fields) {
      if (fieldMatches(field, q)) {
        hits.push({ categoryId: category.id, fieldId: field.id, label: field.label });
      }
    }
  }
  return hits;
}
