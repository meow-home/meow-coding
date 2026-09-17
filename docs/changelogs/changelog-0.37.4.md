# Changelog — Meow Coding v0.37.3 → v0.37.4

## 🚀 New Features

### KaTeX Mathematical Expression Rendering
- **Math Syntax Rendering**: Added native support for LaTeX / KaTeX mathematical expressions (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`) across all `MarkdownText` surfaces (chat feed, subagent overlay, file preview, and dialogs).
- **MathML Sanitization**: Configured `DOMPurify` with MathML tag and attribute whitelists to ensure safe HTML sanitization without stripping math elements.

### Session-to-Session Delegation
- **Session Delegation Tool (`delegate_session`)**: Enabled persistent sessions to delegate focused tasks to peer sessions within the same project.
- **Durable Session Delegation Store & Service**: Added persistent session delegation tracking, lifecycle management, and automatic result delivery.

## 📱 Mobile Remote Control — Coming Soon
- Relay server and pairing workflow under active development. Stay tuned — mobile companion release coming soon! 🚧

## 🧹 Internal & Docs
- Added design spec and implementation plan for KaTeX math rendering (`docs/superpowers/specs/2026-09-17-math-rendering-katex-design.md`, `docs/superpowers/plans/2026-09-17-math-rendering-katex.md`).
- Added design spec and implementation plan for session delegation (`docs/superpowers/specs/2026-09-17-session-delegation-design.md`, `docs/superpowers/plans/2026-09-17-session-delegation.md`).
- Updated component and module documentation (`src/renderer/src/components/chat/AGENTS.md`, `src/main/AGENTS.md`).
- Bumped application version to `v0.37.4`.
