# Changelog — Meow Coding v0.37.4 → v0.38.0

## 🚀 New Features

### Per-Session JSONL Session Storage
- **One file per session**: Sessions are no longer stored as a single growing `sessions.json` array. Each session now lives in its own append-only JSONL file under `projects/<encoded-projectPath>/<sessionId>.jsonl`, one JSON object per line.
- **Much faster writes**: Appending a message or tool result now appends a single line instead of rewriting the whole session file, so long sessions no longer get slower with every turn.
- **Lightweight listing**: A new `sessions-index.json` holds just the session summaries (id, agent, project, title, message count, timestamps, usage), so the sidebar does not have to parse every transcript. The index is rebuilt automatically by scanning the project directories if it is missing or corrupt.
- **Automatic migration**: On first launch an existing `sessions.json` is converted into per-session JSONL files automatically. The migration is one-time and idempotent, and the original file is kept as `sessions.json.migrated-bak` rather than deleted.
- **Fault isolation**: A damaged transcript can no longer take the whole session history down with it, and session files are written atomically.

## 📱 Mobile Remote Control — Coming Soon
- Relay server and pairing workflow under active development. Stay tuned — mobile companion release coming soon! 🚧

## 🐛 Bug Fixes
- **Agent**: Fixed a race between the `monitor` tool and the chat feed where a resolved monitor result could be appended twice or land after the feed had already advanced.
- **Sessions**: The one-time legacy migration now runs after the v0.37 single-session reset instead of during store construction, so the reset is not silently undone and stale sessions do not come back on a fresh install profile.
- **Delegation**: Delegated turns targeting a session that does not exist yet now go through the normal session creation path, so the target session is indexed correctly.

## 🧹 Internal & Docs
- Merged `session-jsonl-storage` into `master`, resolving conflicts against the session-delegation runtime: `SessionStore.ensure()` now writes through the file store, and the delegation tests construct `SessionStore` over `SessionFileStore`.
- Added `SessionFileStore` (filesystem reads/writes + index), `session-records.ts` (pure JSONL serialize/parse), `session-migrate.ts` (one-time migration), `atomic-write.ts` (shared atomic file write helper extracted from `json-store`) and `project-encode.ts` (project path encoding).
- Updated `docs/reference/02-architecture.md`, `docs/reference/06-data-and-storage.md` (userData inventory + new on-disk layout section) and the module `AGENTS.md` files.
- Bumped application version to `v0.38.0`.
