# Changelog — v0.36.9

## 🎨 UI & Aesthetics

- **Ultra-Clean Frameless Chat Feed**: Redesigned the Chat Feed layout where assistant messages render frameless directly on the canvas, while user prompt bubbles use a solid fill accent background (`var(--accent)`) with white text and no borders.
- **Compact Micro-Bar Tool Cards**: Re-engineered `ToolCallCard.tsx` to render single-row micro bars (~28-32px high) with status hairline indicators, badge tags, file summaries, and collapsible diffs.
- **LLM Message Copy Action**: Added a hover action bar at the bottom-right of assistant responses featuring a single-click Copy button with visual `Check` feedback.
- **Todo List & Question Prompt Redesign**:
  - Added a hairline completion progress bar at the top of the Todo list card.
  - Upgraded Todo status indicators to crisp Lucide icons (`CheckCircle2`, `Clock`, `Circle`, `XCircle`).
  - Added uppercase `QUESTION` and `PERMISSION` badge tags to prompt cards.

## 🧹 Documentation & Specs

- Created design specs and implementation plans for Chat Feed Redesign, LLM Copy Feature, and Todo/Question Prompt Redesign under `docs/superpowers/specs/` and `docs/superpowers/plans/`.
- Updated component documentation in `src/renderer/src/components/chat/AGENTS.md` and system reference in `docs/reference/09-ui-guide.md`.
- Bumped application version to `0.36.9`.
