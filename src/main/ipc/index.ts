/**
 * Registers every IPC handler in one place. Called once after the app is ready.
 */
import type { SettingsManager } from '../managers/SettingsManager';
import type { NotificationManager } from '../managers/NotificationManager';
import type { WorkspaceManager } from '../managers/WorkspaceManager';
import type { SessionManager } from '../managers/SessionManager';
import type { AgentManager } from '../managers/AgentManager';
import type { FileSystemManager } from '../managers/FileSystemManager';
import type { TerminalManager } from '../managers/TerminalManager';
import type { GitManager } from '../managers/GitManager';
import type { MemoryManager } from '../managers/memory/MemoryManager';
import type { SearchManager } from '../managers/search/SearchManager';
import type { AutoUpdateManager } from '../managers/AutoUpdateManager';
import { registerWindowHandlers } from './windowHandlers';
import { registerSettingsHandlers } from './settingsHandlers';
import { registerSystemHandlers } from './systemHandlers';
import { registerWorkspaceHandlers } from './workspaceHandlers';
import { registerSessionHandlers } from './sessionHandlers';
import { registerAgentHandlers } from './agentHandlers';
import { registerFsHandlers } from './fsHandlers';
import { registerTerminalHandlers } from './terminalHandlers';
import { registerGitHandlers } from './gitHandlers';
import { registerMemoryHandlers } from './memoryHandlers';
import { registerSearchHandlers } from './searchHandlers';
import { registerUpdateHandlers } from './updateHandlers';

export interface IpcDeps {
  settings: SettingsManager;
  notifications: NotificationManager;
  workspace: WorkspaceManager;
  session: SessionManager;
  agent: AgentManager;
  fs: FileSystemManager;
  terminal: TerminalManager;
  git: GitManager;
  memory: MemoryManager;
  search: SearchManager;
  updates: AutoUpdateManager;
}

export function registerAllIpc(deps: IpcDeps): void {
  registerWindowHandlers();
  registerSettingsHandlers(deps.settings);
  registerSystemHandlers(deps.notifications);
  registerWorkspaceHandlers(deps.workspace);
  registerSessionHandlers(deps.session);
  registerAgentHandlers(deps.agent);
  registerFsHandlers(deps.fs);
  registerTerminalHandlers(deps.terminal);
  registerGitHandlers(deps.git);
  registerMemoryHandlers(deps.memory);
  registerSearchHandlers(deps.search);
  registerUpdateHandlers(deps.updates);
}
