# Changelog - v0.36.11

## 🤖 LLM Models & Persistence

- **Last Used Model Persistence**: Automatically persist the last used model (`lastUsedModel`) to `meow.json` whenever `setModel` is called, ensuring new draft sessions automatically default to your previously chosen LLM model across app restarts.

## 🚀 Startup & Workspace UX

- **Auto-Open First Workspace & New Session**: Automatically select and open the first workspace in your project list on application launch with a fresh `New session` (`DRAFT_SESSION_ID`), eliminating the blank chat pane on startup when projects exist.

## 🧹 Maintenance

- Bumped application version to `v0.36.11`.
