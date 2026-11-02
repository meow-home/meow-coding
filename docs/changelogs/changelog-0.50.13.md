# Changelog — Meow Coding v0.50.12 → v0.50.13

## 🚀 New Features

### Question prompt redesign
- The question card has a header × (and Esc) that skips the question and ends the turn, matching the footer Skip.
- Questions render a single action row: Submit + Skip for multi-select, Skip for single-select; the duplicate Skip is gone.
- Free-text answers are input-only — no Send button; Enter submits, Esc closes the optional field or skips a text-only question.
- The model can label the confirm, skip and free-text buttons (`submitLabel`, `skipLabel`, `customLabel`), sanitized and capped at 24 characters.
- Multi-select choices use a filled-square checkbox with a soft selected tint and clear hover/focus states; the old left accent bar is removed.

### Todo list as the last feed row
- The session todo list now renders as the final feed row above the pending prompt, so it scrolls with the transcript instead of sitting above the composer.

## 🐛 Bug Fixes
- Chat: multi-select questions with `custom: false` no longer render two Skip buttons.

## 🧹 Internal & Docs
- Tests cover the header skip, input-only text answers, the one-row footer and the AI labels; reference docs and the question-popup mockup are updated.
