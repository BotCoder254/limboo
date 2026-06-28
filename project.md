# project.md

# AI Coding Workspace

## Local-First Coding Agent Orchestration Platform

---

# Version

```
Version : 1.0
Status  : Architecture Design
Platform: Desktop
Framework: Electron
Frontend: React + Vite
Language: TypeScript
```

---

# Table of Contents

1. Vision
2. What We Are Building
3. Design Philosophy
4. Core Principles
5. Why Electron
6. Why No Backend
7. Local-First Architecture
8. High-Level Architecture
9. Complete Application Layout
10. User Interface Philosophy
11. Left Sidebar
12. Center Workspace
13. Right Sidebar
14. Top Navigation
15. Composer
16. Application Lifecycle
17. System Components
18. Electron Architecture
19. Renderer Process
20. Main Process
21. IPC Layer
22. Electron APIs
23. Node APIs
24. Coding Agent Integration
25. Session System
26. Workspace System
27. Repository Manager
28. Git Engine
29. Terminal Engine
30. Permission System
31. Project Indexing
32. Local Database
33. Memory System
34. File Watcher
35. Search Engine
36. Event Flow
37. Startup Flow
38. Shutdown Flow
39. Security
40. Future Expansion

---

# 1. Vision

The goal of this project is **not to build another AI coding model**.

Instead, this application becomes the **operating system for AI software development**.

The connected coding agent already understands programming, software engineering, debugging, planning, architecture, testing, Git operations, and reasoning.

Our application exists to provide the environment where that coding agent can perform at its highest level.

Instead of competing with AI models, this desktop application orchestrates everything surrounding the coding agent.

The application manages:

* Projects
* Sessions
* File watching
* Repository indexing
* Git operations
* Terminal execution
* Memory
* Permissions
* Context
* User Interface
* Search
* Workspace state
* Background processes

while allowing the connected coding agent to focus exclusively on writing software.

This separation creates a much cleaner architecture.

---

# 2. What We Are Building

Imagine combining the best ideas from:

* Codex Desktop
* VS Code
* Cursor
* Windsurf
* GitHub Desktop
* Warp Terminal

while removing unnecessary complexity.

The application revolves around one simple concept:

> Every development task happens inside a Session.

A Session is much more than a conversation.

A session contains

* repository
* branch
* chat history
* coding agent
* terminal history
* checkpoints
* permissions
* context
* memory
* tasks
* generated files
* execution history

Every session becomes a complete development workspace.

Instead of opening many windows, everything lives inside one intelligent workspace.

---

# 3. Design Philosophy

The application follows several design philosophies.

## Local First

Nothing should require a server.

Everything should work locally.

The project belongs to the developer.

The data belongs to the developer.

The history belongs to the developer.

The memory belongs to the developer.

The application simply coordinates everything.

---

## Conversation First

Traditional IDEs revolve around files.

This application revolves around conversations.

Instead of asking:

```
Which file should I edit?
```

The user asks

```
Implement authentication.
```

The coding agent figures out the files.

The application visualizes the process.

---

## Minimal UI

The interface intentionally avoids dozens of toolbars.

Instead:

* Left = Sessions
* Center = Work
* Right = Activity

Everything else disappears.

---

# 4. Core Principles

The application must always be

* Fast
* Local
* Private
* Modular
* Secure
* Responsive
* Observable
* Predictable
* Recoverable

Every architecture decision should support these principles.

---

# 5. Why Electron?

Electron is chosen because this application behaves much more like an IDE than a normal desktop application.

It requires:

* filesystem access
* terminal access
* Git execution
* background processes
* notifications
* multiple windows
* tray support
* custom titlebars
* native dialogs
* process management
* child processes
* shell execution
* operating system integration

Electron has mature APIs for all of these.

This makes it the strongest choice for an IDE-class application.

---

# 6. Why No Backend?

This project intentionally avoids having a backend.

Everything important runs locally.

```
User

↓

Electron

↓

Filesystem
Git
SQLite
Terminal
Coding Agent
Indexer

↓

AI Provider (only when the coding agent needs one)
```

The application itself never requires cloud infrastructure.

Advantages

* zero server cost

* complete privacy

* offline support

* faster execution

* no synchronization problems

* ownership of data

The only network traffic comes from the connected coding agent.

---

# 7. Local First Architecture

```
                     User

                       │

                       ▼

            Electron Desktop Application

      ┌─────────────────────────────────────┐

      │                                     │

      │ React UI                            │

      │                                     │

      └──────────────┬──────────────────────┘

                     │ IPC

                     ▼

      ┌─────────────────────────────────────┐

      │ Electron Main Process               │

      └─────────────────────────────────────┘

      │

      ├──────── Repository Manager

      ├──────── Git Manager

      ├──────── Session Manager

      ├──────── Workspace Manager

      ├──────── Permission Manager

      ├──────── Terminal Manager

      ├──────── Search Engine

      ├──────── File Watcher

      ├──────── Indexer

      ├──────── Local Database

      └──────── Coding Agent

```

Everything stays inside the desktop application.

---

# 8. High-Level Architecture

```
┌──────────────────────────────────────────────┐

               React Renderer

└──────────────────────────────────────────────┘

                 │

                 │ IPC

                 ▼

┌──────────────────────────────────────────────┐

             Electron Main Process

└──────────────────────────────────────────────┘

│

├── Workspace Manager

├── Session Manager

├── Git Manager

├── Indexing Engine

├── Search Engine

├── Memory Engine

├── Permission Manager

├── Plugin Manager

├── Terminal Manager

├── File Watcher

├── Agent Manager

└── Local Database

```

Each manager owns exactly one responsibility.

This avoids tightly coupled code.

---

# 9. Application Layout

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐

 Top Navigation

└─────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────┬───────────────────────────────────────────────────────────────┬──────────────┐

│             │                                                               │              │

│             │                                                               │              │

│             │                                                               │              │

│             │                                                               │              │

│             │                                                               │              │

│             │                                                               │              │

│             │                                                               │              │

│ Sessions    │        Conversation + Agent Output                            │ Files        │

│             │                                                               │              │

│             │                                                               │ Changes      │

│             │                                                               │              │

│             │                                                               │ Tasks        │

│             │                                                               │              │

│             │                                                               │ Activity     │

│             │                                                               │              │

└─────────────┴───────────────────────────────────────────────────────────────┴──────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────────┐

 Composer

└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

The interface intentionally gives almost all space to the conversation.

---

# 10. Left Sidebar

The left sidebar contains nothing except Sessions.

No explorer.

No Git.

No debugging.

No extensions.

No search panel.

Only Sessions.

Each session contains

* repository
* title
* branch
* status
* last activity
* unread count
* pinned state
* checkpoint count

The left sidebar becomes the navigation system for all work.

---

# 11. Center Workspace

The center workspace is where the developer spends almost all of their time.

The coding agent streams

* messages

* plans

* implementation

* tool calls

* terminal output

* generated code

* markdown

* images

* diagrams

* execution logs

Everything appears chronologically.

The composer remains fixed at the bottom.

---

# 12. Right Sidebar

The right sidebar continuously visualizes everything happening inside the repository.

Sections include

Files

Changes

Tasks

Git Status

Running Commands

Terminal Output

Recent Activity

Checkpoints

Errors

Warnings

Nothing here edits the project.

Everything here explains what is happening.

---

# 13. Electron Architecture

Electron is divided into two completely different environments.

```
Renderer

↓

IPC

↓

Main Process

↓

Operating System
```

The renderer never touches the operating system directly.

Only the main process can.

This separation greatly improves security.

---

# 14. Renderer Process

The renderer is responsible only for user interface.

Responsibilities

* React
* Components
* State
* Animation
* Layout
* Markdown
* Chat
* Diff Viewer
* Composer
* Settings

No filesystem logic belongs here.

No Git logic belongs here.

No terminal logic belongs here.

---

# 15. Main Process

The Main Process owns the operating system.

Responsibilities

* filesystem

* Git

* windows

* indexing

* search

* permissions

* SQLite

* shell

* notifications

* coding agent

* background workers

The renderer asks.

The main process performs.

---

# 16. IPC Layer

IPC is the bridge.

```
React

↓

ipcRenderer

↓

contextBridge

↓

ipcMain

↓

Filesystem
```

Every request flows through IPC.

Nothing bypasses it.

---

# 17. Electron APIs

## BrowserWindow

Creates the application's native windows. It manages custom title bars, frameless windows, sizing, multiple windows, focus, transparency, and lifecycle events.

## ipcMain / ipcRenderer

The secure messaging layer between the UI and the privileged Electron main process. Every operation that needs filesystem or OS access is routed through IPC.

## contextBridge

Exposes a carefully controlled API from the main process to the renderer, preventing direct Node.js access from the web UI and improving security.

## dialog

Provides native operating system dialogs for opening folders, saving files, confirmations, and prompts.

## shell

Opens files, folders, URLs, and external applications using the operating system.

## Menu / MenuItem

Creates native application menus and contextual right-click menus that integrate with the desktop environment.

## globalShortcut

Registers system-wide keyboard shortcuts such as opening the Composer or switching sessions.

## clipboard

Reads from and writes to the system clipboard for copying code, diffs, and terminal output.

## Notification

Displays native desktop notifications for completed tasks, permission requests, or long-running operations.

## Tray

Adds a system tray icon so the application can continue running background tasks while minimized.

## nativeTheme

Synchronizes the application's appearance with the operating system's light or dark mode.

## nativeImage

Creates and manages application icons, avatars, and image assets used by Electron APIs.

## safeStorage

Encrypts sensitive local data such as API keys and tokens using the operating system's secure credential storage.

## powerMonitor

Detects sleep, resume, battery, and lock events so background tasks can pause or resume safely.

## powerSaveBlocker

Prevents the system from sleeping during long-running agent executions or indexing operations.

## session

Manages downloads, permissions, cookies (if needed), and request handling for renderer processes.

## webContents

Controls each renderer's contents, including navigation, developer tools, zoom, and communication.

## utilityProcess

Runs heavy background workloads in isolated processes, such as repository indexing or semantic analysis, keeping the main process responsive.

---

# 18. Node.js APIs

The Electron main process also relies on core Node.js modules:

* fs / fs.promises for filesystem operations.
* path for platform-independent path handling.
* os for operating system information.
* child_process to launch the connected coding agent, Git, and terminal commands.
* worker_threads for CPU-intensive parallel work.
* events for event-driven communication.
* stream for handling large data streams.
* crypto for hashing and secure identifiers.

---

# 19. Coding Agent

The application connects to one coding agent.

The coding agent is responsible for

* understanding code
* planning
* editing
* generating implementations
* using tools
* communicating with AI models

The application is responsible for everything around it.

This separation keeps the architecture modular and allows different coding agents to be supported through a common interface in the future.

---

# 20. Closing

This document defines the foundation of a local-first AI coding workspace. The desktop application is intentionally designed as an orchestration layer rather than another AI model. By separating user interface, operating-system integration, repository management, and workflow orchestration from the coding agent itself, the architecture remains modular, secure, maintainable, and adaptable to future coding agents and AI models without requiring major redesign.
