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
import { registerWindowHandlers } from './windowHandlers';
import { registerSettingsHandlers } from './settingsHandlers';
import { registerSystemHandlers } from './systemHandlers';
import { registerWorkspaceHandlers } from './workspaceHandlers';
import { registerSessionHandlers } from './sessionHandlers';
import { registerAgentHandlers } from './agentHandlers';
import { registerFsHandlers } from './fsHandlers';
import { registerTerminalHandlers } from './terminalHandlers';
import { registerGitHandlers } from './gitHandlers';

export interface IpcDeps {
  settings: SettingsManager;
  notifications: NotificationManager;
  workspace: WorkspaceManager;
  session: SessionManager;
  agent: AgentManager;
  fs: FileSystemManager;
  terminal: TerminalManager;
  git: GitManager;
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
}
