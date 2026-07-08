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
import type { WorktreeManager } from '../managers/worktree/WorktreeManager';
import type { ServiceManager } from '../managers/services/ServiceManager';
import type { MemoryManager } from '../managers/memory/MemoryManager';
import type { AttachmentManager } from '../managers/attachments/AttachmentManager';
import type { SearchManager } from '../managers/search/SearchManager';
import type { ResumeManager } from '../managers/resume/ResumeManager';
import type { AutoUpdateManager } from '../managers/AutoUpdateManager';
import type { VoiceManager } from '../managers/voice/VoiceManager';
import type { VoiceModelManager } from '../managers/voice/VoiceModelManager';
import type { CursorAuthManager } from '../managers/cursor/CursorAuthManager';
import { registerWindowHandlers } from './windowHandlers';
import { registerSettingsHandlers } from './settingsHandlers';
import { registerSystemHandlers } from './systemHandlers';
import { registerWorkspaceHandlers } from './workspaceHandlers';
import { registerSessionHandlers } from './sessionHandlers';
import { registerAgentHandlers } from './agentHandlers';
import { registerFsHandlers } from './fsHandlers';
import { registerTerminalHandlers } from './terminalHandlers';
import { registerGitHandlers } from './gitHandlers';
import { registerWorktreeHandlers } from './worktreeHandlers';
import { registerServiceHandlers } from './serviceHandlers';
import { registerMemoryHandlers } from './memoryHandlers';
import { registerAttachmentHandlers } from './attachmentHandlers';
import { registerSearchHandlers } from './searchHandlers';
import { registerResumeHandlers } from './resumeHandlers';
import { registerUpdateHandlers } from './updateHandlers';
import { registerVoiceHandlers } from './voiceHandlers';
import { registerCursorHandlers } from './cursorHandlers';

export interface IpcDeps {
  settings: SettingsManager;
  notifications: NotificationManager;
  workspace: WorkspaceManager;
  session: SessionManager;
  agent: AgentManager;
  fs: FileSystemManager;
  terminal: TerminalManager;
  git: GitManager;
  worktree: WorktreeManager;
  services: ServiceManager;
  memory: MemoryManager;
  attachments: AttachmentManager;
  search: SearchManager;
  resume: ResumeManager;
  updates: AutoUpdateManager;
  voice: VoiceManager;
  voiceModels: VoiceModelManager;
  cursorAuth: CursorAuthManager;
}

export function registerAllIpc(deps: IpcDeps): void {
  registerWindowHandlers();
  registerSettingsHandlers(deps.settings);
  registerSystemHandlers(deps.notifications);
  registerWorkspaceHandlers(deps.workspace);
  registerSessionHandlers(deps.session, deps.worktree, deps.services, deps.terminal, deps.attachments);
  registerAgentHandlers(deps.agent);
  registerFsHandlers(deps.fs);
  registerTerminalHandlers(deps.terminal);
  registerGitHandlers(deps.git, deps.agent);
  registerWorktreeHandlers(deps.worktree);
  registerServiceHandlers(deps.services);
  registerMemoryHandlers(deps.memory);
  registerAttachmentHandlers(deps.attachments);
  registerSearchHandlers(deps.search);
  registerResumeHandlers(deps.resume, deps.session);
  registerUpdateHandlers(deps.updates);
  registerVoiceHandlers(deps.voice, deps.voiceModels, deps.settings);
  registerCursorHandlers(deps.cursorAuth);
}
