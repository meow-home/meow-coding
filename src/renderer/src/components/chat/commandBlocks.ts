// Shell fences the chat renders as runnable command boxes. `console` and
// `terminal` are left out on purpose: those fences normally mix a prompt with
// the output it produced, so replaying them as one command would be wrong.
const SHELL_LANGS = new Set([
  'bash',
  'sh',
  'shell',
  'zsh',
  'fish',
  'ksh',
  'dash',
  'powershell',
  'pwsh',
  'ps1',
  'cmd',
  'bat',
  'batch'
])

// Info string of a fence ("bash title=setup" → "bash") when it names a shell.
export function shellLanguage(info: string | null | undefined): string | null {
  if (!info) return null
  const lang = info.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  return SHELL_LANGS.has(lang) ? lang : null
}

// A PTY wants Enter as CR. A multi-line block goes in as one paste (LF between
// lines) so the shell parses compound commands (`for … done`, trailing `\`)
// before running them instead of executing a half-read line.
export function toTerminalInput(command: string): string {
  const text = command.replace(/\r\n?/g, '\n').trimEnd()
  return `${text}\r`
}
