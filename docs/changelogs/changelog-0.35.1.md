# Changelog — Meow Coding v0.35.0 → v0.35.1

## 🐛 Bug Fixes
- Chat: the question tool no longer crashes the renderer (`options.map is not a function`) when the model returns malformed `options` (e.g. a string instead of an array).
- Chat: question popups now render their choice buttons when the model returns `options` as an array of plain strings (e.g. `["Yes", "No"]`) instead of `{ label }` objects — previously only the free-text input showed.

## 🧹 Internal & Docs
- Added unit tests covering malformed and plain-string `options` shapes for the question tool.
- Bumped version to 0.35.1.
