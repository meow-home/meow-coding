# Changelog — Meow Coding v0.35.1 → v0.35.2

## 🐛 Bug Fixes
- Providers: opencode / opencode-go requests now send an `x-opencode-session` header (a per-agent `ses_` session id), so the Zen/Go gateway no longer rejects them with "Request is missing x-opencode-session".
- Providers: "Sync models" and "set default" re-read the persisted settings from main before saving, so a stale draft can no longer clobber other providers' API keys / key refs.

## 🧹 Internal & Docs
- Added regression tests covering opencode session-header detection and provider key-ref preservation across edits and save round-trips.
- Bumped version to 0.35.2.
