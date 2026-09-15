# Changelog — Meow Coding v0.36.12 → v0.36.13

## 🚀 New Features

### Processes Overlay & Background Shell UI
- **Processes Overlay**: Added a right-docked, resizable panel accessible via pane `⋮` → Processes to view active background shells and monitors per session.
- **Live Output Streaming**: Stream background process stdout/stderr live without consuming the agent's read offset, complete with process status, exit code, and a Kill button for running shells.

### Monitor Tool & Async Shell Watching
- **Async Process Monitoring**: Added `monitor` tool to watch background processes for regex match, process exit, or timeout.
- **Auto-Notify & Wake**: Auto-notifies and wakes the agent when a monitored background shell condition resolves.

### Background Bash Tools
- **Background Execution**: Added `bash run_in_background`, `bash_output`, and `kill_shell` tools for non-blocking long-running task execution.
- **Exit Handling**: Automatic transcript notification and agent wake when background bash commands complete.

### Session Management & UI Improvements
- **Newest-First Session Sorting**: Project sessions are now listed in newest-first order in the workspace store.
- **Question Prompt Formatting**: Render Markdown formatted text in agent question prompts with scroll containment for long prompts.

## 📱 Mobile Remote Control — Coming Soon
- Mobile relay control and pairing features are under active development.
- Stay tuned — mobile companion release coming soon! 🚧

## 🧹 Internal & Docs
- Added design specs and implementation plans for Background Bash, Monitor tool, Session sorting, and Processes UI.
- Updated module `AGENTS.md` files and system reference documentation.
- Bumped application version to `v0.36.13`.
