---
name: meow-delegate
description: Use when a written implementation plan exists and the user wants Meow (the local Meow Coding app) to execute its tasks — delegates one task at a time, waits in the background, then verifies Meow's work before moving on.
---

# Delegate plan tasks to Meow

Meow is a local coding agent app. This skill hands one plan task at a time to a Meow session,
lets Claude Code wake you when Meow finishes, and makes you verify the result yourself.

CLI: `node "{{CLI_PATH}}"`

**Always run `start`, `send` and `wait` with the Bash tool and `run_in_background: true`. Never run
them in the foreground:** a task can take far longer than the foreground Bash timeout, and a killed
command stops the wait (Meow keeps working, but you lose the wake-up). Background commands have no
timeout; you are re-invoked when they exit, so end your turn after starting one.

## Per task

1. Write the task to a temp file in your scratchpad: the full task text from the plan, the plan
   path, the files it touches, and the exact verification commands the plan lists.
2. Run in the background:
   ```bash
   node "{{CLI_PATH}}" start --cwd "<repo root>" --plan "<plan path relative to repo>" --title "<plan title>" --task-file "<temp file>"
   ```
   The first output line is `task: <id>   session: <id>   status: <status>` — note both ids.
   The first task of a plan creates a Meow session named `[claude] <title>`; later tasks and
   feedback go to the same session.
3. Do not edit any file in that task's scope while it runs. You may read files or plan ahead.
4. You are re-invoked when the command exits. Read its output block:
   `task`, `session`, `status`, `touched_files`, `final answer`.
   - Exit 0: the task finished — verify it (step 5).
   - Exit 5 (`status: completed (max steps reached)`): Meow hit its per-turn step limit before
     finishing. Verify what is done so far, then send a continuation to the same session (step 6)
     with "Continue the task where you left off" plus anything still missing. This does not count
     as a feedback round.
   - Exit 1: the task failed or was interrupted (e.g. Meow restarted). Read the error; retry once
     with `send`, otherwise ask the user.
   - Exit 2: the task was cancelled. Ask the user how to proceed.
   - Exit 3: Meow is not open or external delegation is disabled. Tell the user to open Meow and
     enable Settings → External delegation, then stop.
   - Exit 4: fix your command (bad path or argument) and retry once.
   - A status such as `completed (stuck)` means Meow stopped a loop; treat it like a failed
     verification and give concrete feedback.
5. Verify independently — never trust the final answer alone:
   - `git diff` on the touched files and compare against the task's requirements.
   - Run the plan's verification commands (tests, typecheck) yourself.
6. If verification fails, write concrete feedback (what is wrong, file:line, failing output) to a
   temp file and run in the background:
   ```bash
   node "{{CLI_PATH}}" send --session "<session id>" --message-file "<feedback file>"
   ```
   At most 3 feedback rounds per task; after that, stop and ask the user.
7. When the task verifies, move to the next task. When all tasks are done, summarize what Meow
   changed and what you verified.

## If a wait was interrupted

If a `start`/`send` command was killed or timed out before printing its result block, the task is
still running in Meow. Do **not** run `start` again (that would queue the same work twice). Take the
task id from the command's first output line and resume waiting in the background:

```bash
node "{{CLI_PATH}}" wait <taskId>
```

`wait` prints the same result block and uses the same exit codes as `start`.

## Other commands

- `node "{{CLI_PATH}}" status <taskId>` — current status, without waiting.
- `node "{{CLI_PATH}}" cancel <taskId>` — stop a task.

Meow may pause for permission approval; the user approves it in the Meow app. Keep waiting — the
background command does not exit until the task ends.
