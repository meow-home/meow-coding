import type { ToolCallData } from '@shared/types'

type Category =
  | 'read' | 'edit' | 'write' | 'command' | 'search' | 'websearch' | 'fetch'
  | 'browser' | 'subagent' | 'todo' | 'git' | 'other'

function categorize(tool: string): Category {
  if (tool.startsWith('browser_')) return 'browser'
  switch (tool) {
    case 'read': return 'read'
    case 'edit': case 'apply-patch': return 'edit'
    case 'write': return 'write'
    case 'bash': case 'bash_output': case 'kill_shell': case 'monitor':
    case 'terminal': case 'cmd': case 'sh': return 'command'
    case 'glob': case 'grep': case 'lsp': case 'ls': case 'dir': return 'search'
    case 'websearch': return 'websearch'
    case 'webfetch': return 'fetch'
    case 'task': case 'delegate_session': return 'subagent'
    case 'todowrite': return 'todo'
    case 'git': return 'git'
    default: return 'other'
  }
}

function str(input: Record<string, unknown> | undefined, keys: string[]): string {
  for (const k of keys) {
    const v = input?.[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : path
}

function patchPaths(patch: string): string[] {
  const out: string[] = []
  for (const m of patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)) out.push(m[1].trim())
  return out
}

function filePaths(call: ToolCallData): string[] {
  if (call.tool === 'apply-patch') {
    const patch = str(call.input, ['patch'])
    return patch ? patchPaths(patch) : []
  }
  const p = str(call.input, ['file_path', 'path'])
  return p ? [p] : []
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`
}

function files(verb: string, paths: string[], fallbackCount: number): string {
  const unique = [...new Set(paths)]
  if (unique.length === 1) return `${verb} ${baseName(unique[0])}`
  const n = unique.length || fallbackCount
  return `${verb} ${n} ${n === 1 ? 'file' : 'files'}`
}

/** One-line, Claude-style summary of a finished run: "Read 2 files, edited a.ts, ran a command". */
export function summarizeCalls(calls: ToolCallData[]): string {
  const order: Category[] = []
  const groups = new Map<Category, ToolCallData[]>()
  for (const c of calls) {
    const cat = categorize(c.tool)
    if (!groups.has(cat)) { groups.set(cat, []); order.push(cat) }
    groups.get(cat)!.push(c)
  }
  const parts = order.map(cat => {
    const list = groups.get(cat)!
    const n = list.length
    switch (cat) {
      case 'read': return files('read', list.flatMap(filePaths), n)
      case 'edit': return files('edited', list.flatMap(filePaths), n)
      case 'write': return files('wrote', list.flatMap(filePaths), n)
      case 'command': return `ran ${plural(n, 'a command', 'commands')}`
      case 'search': return n === 1 ? 'searched the code' : `ran ${n} searches`
      case 'websearch': return `searched the web${n > 1 ? ` ×${n}` : ''}`
      case 'fetch': return `fetched ${plural(n, 'a page', 'pages')}`
      case 'browser': return `used the browser${n > 1 ? ` (${n} steps)` : ''}`
      case 'subagent': return `ran ${plural(n, 'a sub-agent', 'sub-agents')}`
      case 'todo': return 'updated todos'
      case 'git': return `ran ${plural(n, 'a git command', 'git commands')}`
      default: {
        const names = [...new Set(list.map(c => c.tool))]
        return names.length === 1 ? `used ${names[0]}${n > 1 ? ` ×${n}` : ''}` : `used ${names.length} other tools`
      }
    }
  })
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Present-progressive label for the step that is running right now, e.g. "Reading ChatPanel.tsx". */
export function describeRunning(call: ToolCallData): string {
  const path = filePaths(call)[0]
  const name = path ? ` ${baseName(path)}` : ''
  switch (categorize(call.tool)) {
    case 'read': return `Reading${name}`
    case 'edit': return `Editing${name}`
    case 'write': return `Writing${name}`
    case 'command': {
      const cmd = str(call.input, ['command', 'cmd'])
      return cmd ? `Running ${cmd.split('\n')[0]}` : 'Running a command'
    }
    case 'search': {
      const pattern = str(call.input, ['pattern', 'query'])
      return pattern ? `Searching for ${pattern}` : 'Searching the code'
    }
    case 'websearch': return 'Searching the web'
    case 'fetch': return 'Fetching a page'
    case 'browser': return 'Using the browser'
    case 'subagent': return 'Running a sub-agent'
    case 'todo': return 'Updating todos'
    case 'git': return 'Running git'
    default: return `Running ${call.tool}`
  }
}

function lineCount(text: string): number {
  return text === '' ? 0 : text.split('\n').length
}

// Lines shared at the start/end of old and new are context, not changes, so a
// one-line edit inside a large old_string still reads as -1/+1.
function editStats(oldText: string, newText: string): { added: number; removed: number } {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  return { added: b.length - start - end, removed: a.length - start - end }
}

/** Lines added/removed across the run's file-changing calls (denied calls changed nothing). */
export function diffStats(calls: ToolCallData[]): { added: number; removed: number } {
  let added = 0, removed = 0
  for (const c of calls) {
    if (c.permission === 'denied' || c.error !== undefined) continue
    const input = c.input ?? {}
    if (c.tool === 'edit' && typeof input.old_string === 'string' && typeof input.new_string === 'string') {
      const s = editStats(input.old_string, input.new_string)
      added += s.added
      removed += s.removed
    } else if (c.tool === 'write' && typeof input.content === 'string') {
      added += lineCount(input.content)
    } else if (c.tool === 'apply-patch' && typeof input.patch === 'string') {
      for (const line of input.patch.split('\n')) {
        if (line.startsWith('+++') || line.startsWith('---')) continue
        if (line.startsWith('+')) added++
        else if (line.startsWith('-')) removed++
      }
    }
  }
  return { added, removed }
}
