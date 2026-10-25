# Changelog — Meow Coding v0.50.7 → v0.50.9

## 🚀 New Features

### Auto-reset finished todo lists
- Once all tasks in a `todowrite` update are marked `completed` or `cancelled`, the session todo list automatically resets to empty (`[]`).
- The todo pill cleanly disappears from the chat header and the tool output notifies the model that all tasks are finished, leaving the next turn with a fresh slate.

## 🧹 Internal & Docs

### Streamlined skill catalog
- Removed bundled Superpowers skills and associated slash commands from the default bundle to keep the agent runtime lightweight and focused.
- Project-level and user-level custom skills remain supported via `.meow/agents/` and user storage.
- Updated reference documentation and test suites to reflect the bundled skill cleanup.
