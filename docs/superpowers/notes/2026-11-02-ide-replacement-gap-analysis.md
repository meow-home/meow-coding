# IDE Replacement — Market Scan & Gap Analysis (2026-11-02)

Question: what does Meow Coding (v0.50.9) still need so a developer can work in it all day without
opening VS Code / JetBrains — the way Claude Code (desktop) already allows?

Sources studied:

- **OpenCode V2** — `anomalyco/opencode` @ `67139d6` (2026-11-02), latest release **v2.2.5 (2026-10-30)**.
  Desktop (Electron) + TUI + Web share one server. Read `CHANGELOG.md`, `packages/app`, `packages/desktop`.
- **DeepSeek Harness (`dsh`)** — `deepseek-ai/deepseek-harness` @ `ce7073d` (2026-10-30), MIT, public since
  2026-08-13, developer preview. Cordis "everything is a plugin" kernel; Web UI + Electron desktop + SDK + ACP.
  Read `docs/architecture.md`, `packages/README.md`, `apps/desktop/README.md`, `packages/client/*`,
  `packages/experimental/*`.
- **dsh-superagent-prototype** — `deepseek-ai/dsh-superagent-prototype` (2026-10-31): a proactive agent that
  listens to GitHub/Feishu, opens a work item per request, and answers with a PR.
- **Claude Code desktop** — the reference product the user already uses as an IDE replacement.

## 1. Market direction (what the leaders converged on)

All three serious harnesses now treat the **agent session as the primary surface** and the editor as a
side panel. The common "IDE-replacement" kit around the chat is:

| Surface | Claude Code desktop | OpenCode V2 | DeepSeek Harness | Meow today |
|---|---|---|---|---|
| Integrated terminal, persistent per session | ✅ terminal pane | ✅ session PTYs survive restart (v2.2.4), shell mode in composer | ✅ `ui-sidebar-terminal`, `packages/terminal` | ❌ removed (PTY runtime parked) |
| Per-turn changed files + diff review | ✅ diff pane | ✅ "Changed files by turn" (v2.0.30), `/diff` | ✅ `ui-deliverables` review tab | ⚠️ git viewer window only, not per turn |
| Comment on a diff / quote code into chat | ✅ | ✅ unified quotes & annotations (v2.2.2) | ✅ `ui-reference` | ❌ |
| Git worktree isolation per session | ✅ | ✅ `worktree_create/list/remove` tools + picker (v2.0.27, v2.2.5) | ✅ `tool-worktree` | ❌ |
| Commit / push / PR / CI | ✅ PR + CI auto-fix | partial (agent-driven) | ✅ `forge-github`, superagent PR flow | ❌ (viewer: checkout/stash/discard only) |
| Embedded browser preview of the dev server | ✅ browser pane + `launch.json` | ✅ browser annotations | ✅ `ui-sidebar-browser` (loopback) | ⚠️ real-Chrome bridge only |
| Document preview (PDF/Office/HTML) | ✅ | ✅ image/SVG zoom | ✅ `ui-sidebar-documentpreview` | ⚠️ code + images + md |
| Publishable HTML artifacts | ✅ | ✅ experimental `artifact_*` tools (v2.2.4) | ✅ deliverables | ⚠️ `.md` list only |
| Goal / autonomous loop | ✅ `/loop` | ✅ `/goal` with reviewer (v2.2.1) | ✅ `packages/goal` | ❌ |
| Scheduled tasks | ✅ | ✅ schedules (v2.2.4) | ✅ `packages/schedule` | ❌ |
| Auto-approval classifier | ✅ auto mode | ✅ per-project auto-accept | ✅ `auto-review` | ❌ (allow/ask/deny rules only) |
| Remote (SSH / phone / cloud) | ✅ remote + cloud sessions | ✅ device pairing (v2.0.29) | ✅ `packages/ssh` moves fs+shell+LSP together | ❌ |
| Plugin system / marketplace | ✅ plugins | ✅ plugins + GUI plugins | ✅ core design + market | ⚠️ skills/commands/MCP/user tools |
| Protocol for other front-ends (SDK / ACP) | ✅ Agent SDK | ✅ server + SDK | ✅ SDK + ACP | ⚠️ external delegation API |
| Command palette + shortcuts | ✅ | ✅ | ✅ `ui-shortcuts` | ❌ |
| Sandbox for shell | ✅ | — | ✅ bwrap/Landlock/Seatbelt | ❌ |

Meow is already strong on the **agent core** (loop, steering, compaction, subagents, undo/redo, cost, MCP,
LSP-for-agent, skills, Chrome bridge, Codex OAuth, OfficeCLI, parallel sessions). The gap is almost
entirely the **workbench around the chat**.

## 2. Gaps, prioritized

### P0 — without these, users still alt-tab to an IDE

1. **Integrated terminal (session-owned, persistent).** Revive the parked runtime: `pty-manager.ts`,
   the `Pty*` channels and `@xterm/xterm` are still shipped. Model it on OpenCode v2.2.4: a terminal belongs to
   a session, survives app restart with scrollback, can be renamed, and the agent's background shells
   (Processes overlay) appear as read-only tabs in the same dock. Add a composer **shell mode** (`!cmd`
   runs in the session terminal, output optionally attached to the next turn).
2. **Per-turn review.** After each turn: a "changed files" card (paths, +/- lines) in the transcript that
   opens a docked diff tab; per-hunk *keep / revert* backed by the existing `agent/snapshot.ts`; select lines
   in a diff or file → "Quote to chat" with an optional comment (OpenCode quotes, dsh `ui-reference`).
3. **Worktree per session.** Meow's selling point is parallel sessions on one project — today they edit the
   same checkout and collide. Add "Run session in: current checkout | new worktree" at session creation,
   `worktree_*` agent tools, cleanup on session delete, and branch name in `PaneHeader`.
4. **Git write path.** Stage/unstage hunks, commit (with AI-drafted message), push, create PR via `gh`, PR
   status + CI checks in the pane header, and a "fix CI" action that feeds the failing log to the session.
   Extends `git-service.ts` / `git-viewer.ts`; new `Channels.Git*` entries.
5. **Editor that is an editor.** `FileContentView.tsx` already uses editable CodeMirror with save, but:
   only 6 languages, no LSP. Needed: wire `src/main/agent/lsp/` to the editor (diagnostics squiggles, hover,
   go-to-definition, find references, rename), language support via `@codemirror/language-data`,
   **Quick Open (Ctrl+P)**, **project-wide search & replace** (the Files filter `?` search is read-only), and
   a **Problems** list built from LSP diagnostics that can be sent to the agent in one click.
6. **Embedded preview browser.** A docked `WebContentsView` tab for `localhost` dev servers, started from a
   per-project `launch.json`-style config, with console/network capture and "annotate element → quote to
   chat". Keep the real-Chrome bridge for authenticated sites.

### P1 — parity with the current market

7. **Command palette + keybinding editor** (every action reachable by keyboard; required by heavy IDE users).
8. **Goal mode** (`/goal <objective>`): keep looping until a reviewer subagent (`reviewer` role exists)
   confirms the objective; pause/resume/clear from the composer strip.
9. **Auto-review permissions**: a cheap-model classifier that approves/denies `ask` tool calls with a reason,
   per-project toggle — removes most permission prompts without `allow: *`.
10. **Schedules / automations**: cron-like follow-ups per session (the app already lives in the tray).
11. **Artifacts v2**: let the agent publish HTML/static artifacts and preview them in the dock; extend the
    Files panel preview to PDF/Office (OfficeCLI already exists) and SVG zoom.
12. **Test runner surface**: detect the project's test command, run in the session terminal, show
    pass/fail list, "send failures to agent".

### P2 — differentiation / later

13. **Remote workspaces over SSH**: follow dsh's seam design — one provider swap moves fs, shell, PTY and LSP
    together. In Meow that means abstracting `fs`/`bash`/`lsp` behind a workspace transport.
14. **Front-end protocol (ACP / SDK)** so VS Code, JetBrains and Zed can drive Meow sessions; the
    `external-api` delegation server is the seed.
15. **Plugin system**: package skills + commands + MCP + tools + UI panels as an installable unit with a
    marketplace (OpenCode GUI plugins, dsh plugin market).
16. **Proactive agent** (superagent pattern): watch GitHub issues/PR comments, open a session + worktree per
    request, answer with a PR.
17. **Shell sandbox** (Seatbelt/bwrap/AppContainer), **debugger (DAP)**, session search/fork, trajectory
    (timing) view, voice input.

## 3. Suggested sequencing

| Phase | Ships | Why first |
|---|---|---|
| A | Terminal dock + shell mode; worktree per session | Unblocks parallel sessions safely; reuses parked PTY code |
| B | Per-turn review + quote-to-chat; git stage/commit/push/PR | Closes the "review & ship" loop that forces an IDE today |
| C | LSP in editor, Quick Open, search & replace, Problems, command palette | Makes manual edits comfortable |
| D | Preview browser, artifacts v2, test runner | Run/verify loop inside the app |
| E | Goal mode, auto-review, schedules | Autonomy features the market now treats as standard |
| F | SSH remote, ACP/SDK, plugins, proactive agent | Platform bets |

Each phase should go through the usual brainstorm → spec → plan flow in `docs/superpowers/`.

## 4. What not to copy

- dsh's Cordis plugin kernel is a ground-up architecture; retrofitting "everything is a plugin" onto Meow's
  main process is not worth it. Borrow the *seam* idea only where a provider swap pays off (remote fs/shell/LSP).
- A full debugger UI is the most expensive IDE feature and the least used in agent-first workflows; defer it.
