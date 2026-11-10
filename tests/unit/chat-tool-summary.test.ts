import { describe, expect, it } from 'vitest'
import type { ToolCallData } from '../../src/shared/types'
import { describeRunning, diffStats, stripCdPrefix, summarizeCalls } from '../../src/renderer/src/components/chat/toolSummary'

let seq = 0
function call(tool: string, input: Record<string, unknown>, extra: Partial<ToolCallData> = {}): ToolCallData {
  return { id: `tc-${++seq}`, tool, input, permission: 'allowed', ...extra }
}

describe('summarizeCalls', () => {
  it('groups calls by kind in first-seen order', () => {
    expect(summarizeCalls([
      call('read', { file_path: 'src/a.ts' }),
      call('bash', { command: 'ls' }),
      call('read', { file_path: 'src\\b.ts' }),
      call('edit', { file_path: 'src/a.ts', old_string: 'x', new_string: 'y' }),
      call('bash', { command: 'pwd' })
    ])).toBe('Read 2 files, ran 2 commands, edited a.ts')
  })

  it('names a single file and counts repeated reads of it once', () => {
    expect(summarizeCalls([call('read', { file_path: 'a/x.ts' }), call('read', { file_path: 'a/x.ts' })])).toBe('Read x.ts')
  })

  it('reads edited files out of apply-patch headers', () => {
    const patch = '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-a\n+b\n*** Add File: src/b.ts\n+c\n*** End Patch'
    expect(summarizeCalls([call('apply-patch', { patch })])).toBe('Edited 2 files')
  })

  it('covers searches, the browser and unknown tools', () => {
    expect(summarizeCalls([call('grep', { pattern: 'x' }), call('glob', { pattern: '*' })])).toBe('Ran 2 searches')
    expect(summarizeCalls([call('browser_open_tab', {}), call('browser_click', {})])).toBe('Used the browser (2 steps)')
    expect(summarizeCalls([call('browser_handoff', { reason: 'Sign in' })])).toBe('Handed the browser to you')
    expect(summarizeCalls([call('delegate_cli', {})])).toBe('Ran a sub-agent')
    expect(summarizeCalls([call('mcp_foo', {})])).toBe('Used mcp_foo')
  })
})

describe('describeRunning', () => {
  it('names the active step', () => {
    expect(describeRunning(call('read', { file_path: 'C:\\repo\\ChatPanel.tsx' }))).toBe('Reading ChatPanel.tsx')
    expect(describeRunning(call('bash', { command: 'npm test\nnpm run e2e' }))).toBe('Running npm test')
    expect(describeRunning(call('grep', { pattern: 'tool-cluster' }))).toBe('Searching for tool-cluster')
    expect(describeRunning(call('bash', { command: 'cd /c/repo && npm test' }))).toBe('Running npm test')
    expect(describeRunning(call('browser_handoff', { reason: 'Sign in' }))).toBe('Waiting for you')
    expect(describeRunning(call('delegate_cli', {}))).toBe('Running a sub-agent')
  })
})

describe('stripCdPrefix', () => {
  it('drops a leading cd into the project, quoted or not, and nothing else', () => {
    expect(stripCdPrefix('cd /c/Users/me/repo && grep -rn x src')).toBe('grep -rn x src')
    expect(stripCdPrefix('cd "C:\\My Repo" && npm test')).toBe('npm test')
    expect(stripCdPrefix('npm test && cd dist')).toBe('npm test && cd dist')
  })
})

describe('diffStats', () => {
  it('counts only changed lines of an edit, whole content of a write, and +/- lines of a patch', () => {
    const edit = call('edit', { file_path: 'a', old_string: 'keep\nold\nkeep2', new_string: 'keep\nnew1\nnew2\nkeep2' })
    const write = call('write', { file_path: 'b', content: 'a\nb\nc' })
    const patch = call('apply-patch', { patch: '*** Update File: c\n--- c\n+++ c\n-x\n+y\n+z' })
    expect(diffStats([edit, write, patch])).toEqual({ added: 7, removed: 2 })
  })

  it('ignores denied and failed calls', () => {
    expect(diffStats([
      call('write', { content: 'a' }, { permission: 'denied' }),
      call('write', { content: 'a' }, { error: 'boom' })
    ])).toEqual({ added: 0, removed: 0 })
  })
})
