/**
 * Registers every IPC handler in one place. Called once after the app is ready.
 */
import type { SettingsManager } from '../managers/SettingsManager';
import type { NotificationManager } from '../managers/NotificationManager';
import type { WorkspaceManager } from '../managers/WorkspaceManager';
import type { AgentManager } from '../managers/AgentManager';
import { registerWindowHandlers } from './windowHandlers';
import { registerSettingsHandlers } from './settingsHandlers';
import { registerSystemHandlers } from './systemHandlers';
import { registerWorkspaceHandlers } from './workspaceHandlers';
import { registerAgentHandlers } from './agentHandlers';

export interface IpcDeps {
  settings: SettingsManager;
  notifications: NotificationManager;
  workspace: WorkspaceManager;
  agent: AgentManager;
}

export function registerAllIpc(deps: IpcDeps): void {
  registerWindowHandlers();
  registerSettingsHandlers(deps.settings);
  registerSystemHandlers(deps.notifications);
  registerWorkspaceHandlers(deps.workspace);
  registerAgentHandlers(deps.agent);
}
