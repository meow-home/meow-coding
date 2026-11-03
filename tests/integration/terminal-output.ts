const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g

// True when the shell printed `line` on a line of its own. The echo of the typed
// command never matches, and control sequences such as bash's bracketed-paste
// toggle (`\x1b[?2004l\r`, emitted on Linux right before command output) are
// stripped first so they cannot hide the line break.
export function hasOutputLine(output: string, line: string): boolean {
  return output
    .replace(ANSI, '')
    .split(/\r\n|\n|\r/)
    .some(l => l.trim() === line)
}
