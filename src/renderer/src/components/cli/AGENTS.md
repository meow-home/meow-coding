# AGENTS.md — src/renderer/src/components/cli

CLI agent session UI (Antigravity / OpenCode).

## Key files

- `CliSessionPane.tsx` — one CLI agent session: header (agent label, runtime chip, model, status, Stop,
  rename/delete), transcript loaded from `getCliTranscript` and appended from `onCliRun`, markdown
  assistant text, collapsible tool cards, notices, result card, and a composer that calls `sendCliTask`.
  The composer is disabled unless the session is `idle` and the agent is `ready`.
- `transcript-helper.ts` — pure helpers: tool-input summaries, timestamps, status labels.

## Conventions

- The pane never receives secrets; agent/account metadata only.
- CLI sessions are separate from Meow sessions: do not route their transcript through `ChatPanel` or
  the Meow agent store.
- Keep hidden Meow panes mounted; this component replaces the pane only while a CLI session is active.
