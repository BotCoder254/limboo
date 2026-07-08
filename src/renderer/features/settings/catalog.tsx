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
  Brain,
  GitBranch,
  Keyboard,
  Info,
  ListTodo,
  Mic,
  Paperclip,
  TerminalSquare,
  ArrowUpCircle,
  type LucideIcon,
} from 'lucide-react';
import { GeneralPanel } from './panels/GeneralPanel';
import { AppearancePanel } from './panels/AppearancePanel';
import { WorkspacePanel } from './panels/WorkspacePanel';
import { BehaviorPanel } from './panels/BehaviorPanel';
import { AgentPanel } from './panels/AgentPanel';
import { PlanTasksPanel } from './panels/PlanTasksPanel';
import { TerminalPanel } from './panels/TerminalPanel';
import { GitPanel } from './panels/GitPanel';
import { MemoryPanel } from './panels/MemoryPanel';
import { AttachmentsPanel } from './panels/AttachmentsPanel';
import { VoicePanel } from './panels/VoicePanel';
import { ShortcutsPanel } from './panels/ShortcutsPanel';
import { UpdatesPanel } from './panels/UpdatesPanel';
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
      { id: 'wsPlanDefaultMode', label: 'Start sessions in', keywords: ['plan', 'permission mode', 'default', 'accept edits'] },
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
    keywords: ['claude', 'claude code', 'cursor', 'ai', 'model', 'provider', 'orchestrate', 'permissions', 'web search', 'connection', 'reliability', 'heartbeat', 'reconnect', 'recovery', 'diagnostics'],
    fields: [
      { id: 'model', label: 'Model', keywords: ['sonnet', 'opus', 'haiku', 'claude', 'anthropic', 'provider'] },
      { id: 'cursorProvider', label: 'Cursor', keywords: ['cursor', 'sign in', 'login', 'logout', 'provider', 'dashboard'] },
      { id: 'cursorPreferredAuth', label: 'Preferred authentication', keywords: ['cursor', 'auth', 'api key', 'cli', 'login', 'auto', 'credential'] },
      { id: 'cursorManualLogin', label: 'Manual browser login', keywords: ['browser', 'url', 'headless', 'cursor'] },
      { id: 'cursorApiKey', label: 'Cursor API key', keywords: ['api key', 'cursor', 'token', 'credential', 'encrypted'] },
      { id: 'cursorUpdateCli', label: 'Cursor CLI version', keywords: ['cursor', 'update', 'version', 'cli', 'upgrade'] },
      { id: 'cursorSandbox', label: 'Cursor sandbox', keywords: ['cursor', 'sandbox', 'isolation', 'security'] },
      { id: 'cursorHooks', label: 'Cursor permission hooks', keywords: ['cursor', 'hooks', 'permission', 'prompts', 'approval', 'bridge'] },
      { id: 'cursorExecutablePath', label: 'Cursor executable path', keywords: ['cursor', 'executable', 'path', 'binary', 'cursor-agent', 'install location'] },
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
      { id: 'troubleshootCursor', label: 'Cursor CLI detection', keywords: ['troubleshoot', 'cursor', 'not installed', 'detect', 'probe', 'refresh', 'path', 'localappdata', 'diagnostics'] },
      { id: 'troubleshootBridge', label: 'Cursor run bridge', keywords: ['troubleshoot', 'cursor', 'hooks', 'mcp', 'bridge', 'pipe', 'memory', 'search', 'diagnostics'] },
      { id: 'troubleshootClaude', label: 'Claude Code status', keywords: ['troubleshoot', 'claude', 'not connected', 'detect', 'diagnostics'] },
      { id: 'troubleshootTips', label: 'Common fixes', keywords: ['troubleshoot', 'fix', 'help', 'install cli', 'not found', 'sign in required', 'restart'] },
    ],
    Panel: AgentPanel,
  },
  {
    id: 'plan',
    label: 'Plan & Tasks',
    icon: ListTodo,
    keywords: ['plan', 'plan mode', 'tasks', 'todo', 'checklist', 'approve', 'execute', 'permission mode', 'accept edits', 'history', 'revisions', 'outline', 'phases'],
    fields: [
      { id: 'planDefaultMode', label: 'Default permission mode', keywords: ['plan', 'ask', 'accept edits', 'permission', 'start'] },
      { id: 'planRequireSecondaryConfirm', label: 'Confirm before executing', keywords: ['approve', 'confirm', 'safety'] },
      { id: 'planSaveToMemory', label: 'Save completed plans to Memory', keywords: ['memory', 'retain', 'knowledge'] },
      { id: 'planShowReasoning', label: 'Show plan reasoning', keywords: ['markdown', 'reasoning', 'plan body'] },
      { id: 'planShowEstimates', label: 'Show plan metadata', keywords: ['risk', 'files', 'task count'] },
      { id: 'planHighlightRisk', label: 'Highlight risk', keywords: ['risk', 'color'] },
      { id: 'planStreamIncrementally', label: 'Stream tasks as they appear', keywords: ['stream', 'incremental', 'live'] },
      { id: 'planAutoExpandTasks', label: 'Auto-expand new tasks', keywords: ['expand', 'tasks'] },
      { id: 'planAutoCollapseCompleted', label: 'Collapse completed tasks', keywords: ['collapse', 'done'] },
      { id: 'planExportFormat', label: 'Plan export format', keywords: ['export', 'markdown', 'download'] },
      { id: 'planShowTaskDurations', label: 'Show task durations', keywords: ['duration', 'time', 'execution'] },
      { id: 'planShowCheckpoints', label: 'Show checkpoints on tasks', keywords: ['git', 'checkpoint', 'recovery'] },
      { id: 'planAllowReorder', label: 'Allow manual reordering', keywords: ['reorder', 'drag', 'tasks'] },
      { id: 'planNotifyPhase', label: 'Notify on phase completion', keywords: ['notify', 'notification', 'phase'] },
      { id: 'planArchiveCompleted', label: 'Archive on completion', keywords: ['archive', 'done'] },
      { id: 'planRetainHistory', label: 'Keep plan revisions', keywords: ['history', 'revisions', 'compare', 'restore'] },
      { id: 'planHistoryLimit', label: 'Revisions kept per session', keywords: ['history', 'limit', 'prune'] },
    ],
    Panel: PlanTasksPanel,
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
    id: 'voice',
    label: 'Voice',
    icon: Mic,
    keywords: ['voice', 'speech', 'microphone', 'mic', 'speak', 'talk', 'dictation', 'tts', 'stt', 'audio', 'kokoro', 'parakeet', 'whisper', 'vad', 'offline', 'models', 'text to speech', 'speech recognition'],
    fields: [
      { id: 'voiceEnabled', label: 'Enable voice', keywords: ['on', 'off', 'toggle', 'master'] },
      { id: 'voiceModels', label: 'Speech models', keywords: ['download', 'install', 'kokoro', 'parakeet', 'model', 'offline'] },
      { id: 'voiceInputDevice', label: 'Microphone', keywords: ['device', 'input', 'mic'] },
      { id: 'voiceActivation', label: 'Activation', keywords: ['push to talk', 'toggle', 'automatic', 'vad', 'hands free'] },
      { id: 'voiceSensitivity', label: 'Input sensitivity', keywords: ['threshold', 'noise', 'detection'] },
      { id: 'voiceSilence', label: 'End of speech after', keywords: ['silence', 'pause', 'endpoint'] },
      { id: 'voiceLanguage', label: 'Language', keywords: ['english', 'locale'] },
      { id: 'voicePunctuation', label: 'Automatic punctuation', keywords: ['punctuation', 'commas'] },
      { id: 'voiceMicTest', label: 'Microphone test', keywords: ['test', 'levels', 'diagnostics'] },
      { id: 'voiceOutputEnabled', label: 'Speak responses', keywords: ['tts', 'playback', 'speak'] },
      { id: 'voiceOutputDevice', label: 'Speaker', keywords: ['device', 'output', 'headphones'] },
      { id: 'voiceSpeaker', label: 'Voice', keywords: ['speaker', 'voice selection', 'kokoro'] },
      { id: 'voiceSpeed', label: 'Speech speed', keywords: ['rate', 'faster', 'slower'] },
      { id: 'voiceVolume', label: 'Volume', keywords: ['loudness', 'gain'] },
      { id: 'voiceStreaming', label: 'Speak while generating', keywords: ['streaming', 'progressive', 'sentences'] },
      { id: 'voiceSpeakWhen', label: 'Speak replies to', keywords: ['voice initiated', 'always', 'gating'] },
      { id: 'voiceSpeakerTest', label: 'Speaker test', keywords: ['test', 'sample', 'diagnostics'] },
      { id: 'voiceGateFinal', label: 'Speak final answers', keywords: ['playback', 'gating', 'answers'] },
      { id: 'voiceGateTools', label: 'Speak while tools run', keywords: ['playback', 'gating', 'tools'] },
      { id: 'voiceGatePlanning', label: 'Speak planning updates', keywords: ['playback', 'gating', 'plan'] },
      { id: 'voiceGateCompletion', label: 'Speak task completion', keywords: ['playback', 'gating', 'done'] },
      { id: 'voiceGateNotifications', label: 'Speak notifications', keywords: ['playback', 'gating', 'notify'] },
      { id: 'voiceInterruption', label: 'When you interrupt', keywords: ['barge in', 'stop', 'pause'] },
      { id: 'voiceShortcutToggle', label: 'Toggle voice input shortcut', keywords: ['keyboard', 'hotkey', 'shortcut'] },
      { id: 'voiceAutoDownload', label: 'Download models automatically', keywords: ['auto', 'download', 'network'] },
      { id: 'voiceAutoUpdate', label: 'Update models automatically', keywords: ['auto', 'update', 'revision'] },
      { id: 'voiceOfflineOnly', label: 'Offline only', keywords: ['network', 'privacy', 'no internet'] },
      { id: 'voiceStorage', label: 'Model storage', keywords: ['folder', 'disk', 'location', 'reveal'] },
      { id: 'voiceCache', label: 'Remove all voice models', keywords: ['cache', 'disk space', 'delete', 'cleanup'] },
    ],
    Panel: VoicePanel,
  },
  {
    id: 'git',
    label: 'Git',
    icon: GitBranch,
    keywords: ['git', 'commit', 'branch', 'checkpoint', 'version control', 'diff', 'stage', 'author', 'identity', 'push', 'pull', 'remote', 'upstream', 'sync', 'worktree', 'worktrees', 'gittree', 'services', 'proxy', 'hooks'],
    fields: [
      { id: 'gitUserName', label: 'Author name', keywords: ['user.name', 'identity', 'commit'] },
      { id: 'gitUserEmail', label: 'Author email', keywords: ['user.email', 'identity', 'commit'] },
      { id: 'gitCommitTemplate', label: 'Commit message template', keywords: ['message', 'prefix'] },
      { id: 'gitSuggestCommit', label: 'Suggest message from conversation', keywords: ['ai', 'message'] },
      { id: 'gitAutoSetUpstream', label: 'Publish new branches on first push', keywords: ['push', 'upstream', 'track', 'remote', 'publish'] },
      { id: 'gitConfirmForcePush', label: 'Confirm before force push', keywords: ['push', 'force', 'lease', 'safety'] },
      { id: 'gitPullStrategy', label: 'Pull strategy', keywords: ['pull', 'rebase', 'fast-forward', 'merge', 'sync'] },
      { id: 'gitAutoCheckpoint', label: 'Auto-checkpoint before agent edits', keywords: ['snapshot', 'recovery', 'safety'] },
      { id: 'gitMaxCheckpoints', label: 'Max checkpoints per session', keywords: ['prune', 'snapshot'] },
      { id: 'gitWtEnabled', label: 'Enable worktree sessions', keywords: ['worktree', 'isolation', 'parallel', 'sessions'] },
      { id: 'gitWtRoot', label: 'Worktree root', keywords: ['worktree', 'folder', 'location', 'ssd', 'path'] },
      { id: 'gitWtBranchPrefix', label: 'Worktree branch prefix', keywords: ['worktree', 'branch', 'naming', 'slug'] },
      { id: 'gitWtAutoSetup', label: 'Run setup hooks after create', keywords: ['worktree', 'setup', 'hooks', 'install', 'bootstrap'] },
      { id: 'gitWtConfirmHooks', label: 'Confirm hooks before running', keywords: ['worktree', 'hooks', 'safety', 'confirm'] },
      { id: 'gitWtTeardownOnArchive', label: 'Teardown on archive', keywords: ['worktree', 'teardown', 'archive', 'cleanup'] },
      { id: 'gitSvcPortRange', label: 'Service port range', keywords: ['services', 'port', 'dev server'] },
      { id: 'gitSvcProxyEnabled', label: 'Reverse proxy (*.localhost)', keywords: ['proxy', 'localhost', 'services', 'urls'] },
      { id: 'gitSvcProxyPort', label: 'Proxy port', keywords: ['proxy', 'port', 'localhost'] },
      { id: 'gitConfirmBranchSwitch', label: 'Confirm branch switch with changes', keywords: ['checkout', 'dirty', 'safety'] },
      { id: 'gitCommandApproval', label: 'Require approval for git operations', keywords: ['safety', 'confirm', 'destructive'] },
    ],
    Panel: GitPanel,
  },
  {
    id: 'attachments',
    label: 'Attachments',
    icon: Paperclip,
    keywords: ['file', 'files', 'upload', 'attach', 'attachment', 'image', 'screenshot', 'paste', 'drag', 'drop', 'vision', 'pdf', 'document', 'archive', 'staging'],
    fields: [
      { id: 'attEnabled', label: 'Enable attachments', keywords: ['on', 'off', 'toggle', 'master'] },
      { id: 'attMaxFileSize', label: 'Max file size', keywords: ['size', 'mb', 'limit', 'cap'] },
      { id: 'attMaxPerMessage', label: 'Files per message', keywords: ['count', 'limit', 'multiple'] },
      { id: 'attMaxPerSession', label: 'Files per session', keywords: ['count', 'limit', 'total'] },
      { id: 'attCatImages', label: 'Images', keywords: ['png', 'jpg', 'screenshot', 'category'] },
      { id: 'attCatDocuments', label: 'Documents & data', keywords: ['pdf', 'markdown', 'json', 'logs', 'category'] },
      { id: 'attCatCode', label: 'Source code', keywords: ['code', 'category'] },
      { id: 'attCatArchives', label: 'Archives', keywords: ['zip', 'tar', 'category', 'extract'] },
      { id: 'attRiskPolicy', label: 'Executables & scripts', keywords: ['risk', 'block', 'warn', 'security', 'exe', 'script'] },
      { id: 'attVision', label: 'Send images to the model', keywords: ['vision', 'multimodal', 'see', 'image'] },
      { id: 'attDownscale', label: 'Downscale above', keywords: ['resize', 'image', 'size', 'vision'] },
      { id: 'attAutoIndex', label: 'Index into Search', keywords: ['search', 'index', 'find'] },
    ],
    Panel: AttachmentsPanel,
  },
  {
    id: 'memory',
    label: 'Memory & Search',
    icon: Brain,
    keywords: ['memory', 'knowledge', 'context', 'recall', 'retention', 'notes', 'decisions', 'conventions', 'inject', 'capture', 'search', 'index', 'indexing', 'files', 'symbols', 'find', 'global search', 'retrieval', 'resume', 'revalidation', 'repository delta', 'continue'],
    fields: [
      { id: 'resumeEnabled', label: 'Repository revalidation on resume', keywords: ['resume', 'revalidate', 'continue', 'delta', 'repository'] },
      { id: 'resumeInjectDelta', label: 'Inject repository delta into prompts', keywords: ['resume', 'delta', 'prompt', 'agent', 'context'] },
      { id: 'resumeMaxCommits', label: 'Max commits in delta', keywords: ['resume', 'commits', 'delta', 'limit'] },
      { id: 'resumeStaleDays', label: 'Skip revalidation newer than', keywords: ['resume', 'stale', 'days', 'threshold'] },
      { id: 'memoryEnabled', label: 'Enable memory', keywords: ['on', 'off', 'toggle'] },
      { id: 'memoryInject', label: 'Inject into agent prompts', keywords: ['context', 'prompt', 'agent'] },
      { id: 'memoryMaxInjected', label: 'Max memories per prompt', keywords: ['budget', 'limit', 'count'] },
      { id: 'memoryAutoCapture', label: 'Capture mode', keywords: ['propose', 'auto', 'confirm', 'commit'] },
      { id: 'memoryAutoAccept', label: 'Auto-keep above confidence', keywords: ['confidence', 'threshold'] },
      { id: 'memoryExpiryEnabled', label: 'Flag stale memories', keywords: ['expire', 'decay', 'cleanup'] },
      { id: 'memoryStaleDays', label: 'Stale after', keywords: ['days', 'expire', 'old'] },
      { id: 'searchEnabled', label: 'Enable search indexing', keywords: ['search', 'index', 'on', 'off'] },
      { id: 'searchIndexContents', label: 'Index file contents', keywords: ['content', 'symbols', 'full-text'] },
      { id: 'searchMaxFileSize', label: 'Max indexed file size', keywords: ['size', 'kb', 'limit'] },
      { id: 'searchIncludeIgnored', label: 'Index ignored files', keywords: ['gitignore', 'node_modules', 'ignored'] },
      { id: 'searchMaxResults', label: 'Results per source', keywords: ['results', 'limit', 'group'] },
      { id: 'searchSources', label: 'Search sources', keywords: ['sources', 'files', 'symbols', 'docs', 'memory', 'commits', 'branches', 'sessions', 'filter', 'include', 'exclude'] },
      { id: 'searchFuzzy', label: 'Fuzzy matching', keywords: ['fuzzy', 'typo', 'substring', 'strict', 'prefix'] },
      { id: 'searchHistoryLimit', label: 'Recent searches kept', keywords: ['history', 'recent', 'limit', 'ring'] },
      { id: 'searchLiveDelay', label: 'Live-search delay', keywords: ['live', 'debounce', 'instant', 'real-time', 'delay', 'as you type'] },
      { id: 'searchOpenOnClick', label: 'Open on click', keywords: ['title bar', 'click', 'shortcut', 'open', 'search bar'] },
      { id: 'searchInject', label: 'Inject context into agent prompts', keywords: ['context', 'prompt', 'agent', 'retrieval'] },
      { id: 'searchMaxInjected', label: 'Max context items per prompt', keywords: ['budget', 'limit', 'count'] },
    ],
    Panel: MemoryPanel,
  },
  {
    id: 'updates',
    label: 'Updates',
    icon: ArrowUpCircle,
    keywords: ['update', 'auto-update', 'upgrade', 'version', 'release', 'download', 'install', 'patch'],
    fields: [
      { id: 'updateStatus', label: 'Update status', keywords: ['version', 'available', 'ready'] },
      { id: 'updateCheck', label: 'Check for updates', keywords: ['check', 'now', 'refresh'] },
      { id: 'updateAutoCheck', label: 'Check automatically', keywords: ['auto', 'background', 'startup'] },
      { id: 'updateAutoDownload', label: 'Download automatically', keywords: ['auto', 'download', 'background'] },
    ],
    Panel: UpdatesPanel,
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
