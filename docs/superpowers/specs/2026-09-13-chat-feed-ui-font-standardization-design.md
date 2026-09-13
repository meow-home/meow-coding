# Chat Feed & Tool Call UI Font Standardization Design

## Goals
Standardize fonts across the Chat Feed, Tool Calls, Subagent cards, and related UI elements to use `--font-ui` for UI text, labels, status badges, and metadata, reserving `--font-mono` exclusively for code, scripts, logs, execution outputs, and diffs.

## Font Usage Strategy

### UI Font (`var(--font-ui)`)
1. **Tool Call Card Header & Summary**:
   - `.tool-call-name`: Tool name label (e.g., `bash`, `read`, `write`, `edit`).
   - `.tool-call-summary`: Summary line (e.g., target file path, command summary).
   - `.tool-call-running`, `.tool-call-status`: Execution status badges (`running…`, `✓`, `✗`).
2. **Chat Feed Dividers & Meta Status**:
   - `.chat-compacted`: Compaction indicator line (e.g., `"15 MESSAGES COMPACTED"`).
   - `.chat-retry`: Retry attempt indicator (e.g., `"(attempt 1/3)"`).
3. **Todos Panel**:
   - `.chat-todos-count`: Todo progress count badge (e.g., `"2/5"`), set with `tabular-nums`.
   - `.chat-todo-mark`: Todo status checkbox mark (e.g., `[ ]`, `[x]`, `[-]`).
4. **Subagent Cards**:
   - `.subagent-state`: Subagent status badge (e.g., `"running"`, `"completed"`, `"error"`).
   - `.subagent-name`: Subagent role/title badge.
5. **Prompts & Question Options**:
   - `.chat-option-mark`: Option index mark (e.g., `1.`, `2.`, `[x]`).
   - `.chat-prompt-head-label`: Question prompt status header label.
6. **Context Footer Popover**:
   - `.session-tokens`: Token count & percentage badge, set with `tabular-nums`.

### Mono Font (`var(--font-mono)`)
1. **Code & Inline Code**:
   - Markdown code blocks (`.chat-md pre code`) and inline code (`.chat-md code`).
   - Inline code elements in prompts or hints (`code`).
2. **Tool Call Contents**:
   - `.tool-call-input`: Tool input JSON payload or patch code.
   - `.tool-call-output`: Tool command output stdout/stderr.
   - `.tool-call-error`: Tool error response output.
3. **Diffs & Logs**:
   - `.diff-view`, `.tool-call-diff`: File modification diff views.
   - `.subagent-live-result`: Raw subagent output stream.
   - `.chat-error-boundary-detail`: Error stack trace details.
   - `.log-viewer`, `.log-content`, `.log-line`: Terminal and system logs.

## Changes to `src/renderer/src/styles.css`
Update the font-family properties of the following CSS classes from `var(--font-mono)` to `var(--font-ui)` (adding `font-variant-numeric: tabular-nums` where numbers are displayed):
- `.tool-call-summary`
- `.tool-call-name`
- `.chat-compacted`
- `.chat-retry`
- `.chat-todos-count`
- `.chat-todo-mark`
- `.subagent-state`
- `.chat-option-mark`
- `.session-tokens` (popover metric badge)
- `.agent-tag`
- `.pane-background-status`
- `.background-status`

## Self-Review
- Checked for contradictions: Mono font is preserved for all actual code, script, output, and diff content.
- Visual hierarchy: Clean UI font for readability of instructions and headers, distinct Mono font for technical outputs.
