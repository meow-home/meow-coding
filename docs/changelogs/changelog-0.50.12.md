# Changelog — Meow Coding v0.50.9 → v0.50.12

## 🚀 New Features

### One-line tool-call summaries
- A run of tool calls now collapses into a single line that says what it did ("Read 2 files, edited a.ts, ran a command"), with its +N/−M line counts and a failed count.
- While a step runs, the line names it with a spinner and done/total progress; opening it shows the steps as a plain list.
- Thinking between tool calls folds into the same line as quiet "thought" steps, so a think → tool → think loop no longer shows as alternating rows; the line reads "Thinking…" while the agent thinks.

## 🐛 Bug Fixes
- Chat: clustered steps render as plain list rows, and bash rows drop the leading `cd <dir> &&`.

## 🧹 Internal & Docs
- CI: notify Telegram when a release build succeeds or fails.
