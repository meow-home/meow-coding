import { describe, expect, it } from 'vitest'
import { shellLanguage, toTerminalInput } from '../../src/renderer/src/components/chat/commandBlocks'

describe('shellLanguage', () => {
  it('accepts the common shell fence tags', () => {
    for (const lang of ['bash', 'sh', 'zsh', 'powershell', 'pwsh', 'ps1', 'cmd', 'bat']) {
      expect(shellLanguage(lang)).toBe(lang)
    }
  })

  it('ignores case and fence options', () => {
    expect(shellLanguage('Bash')).toBe('bash')
    expect(shellLanguage('powershell title=setup')).toBe('powershell')
  })

  it('rejects fences that mix a prompt with output', () => {
    expect(shellLanguage('console')).toBeNull()
    expect(shellLanguage('terminal')).toBeNull()
    expect(shellLanguage('text')).toBeNull()
    expect(shellLanguage('json')).toBeNull()
  })

  it('rejects a missing fence language', () => {
    expect(shellLanguage('')).toBeNull()
    expect(shellLanguage(undefined)).toBeNull()
    expect(shellLanguage(null)).toBeNull()
  })
})

describe('toTerminalInput', () => {
  it('ends a single command with a carriage return', () => {
    expect(toTerminalInput('npm test')).toBe('npm test\r')
  })

  it('drops the trailing newline a fenced block carries', () => {
    expect(toTerminalInput('npm test\n')).toBe('npm test\r')
    expect(toTerminalInput('npm test\r\n\r\n')).toBe('npm test\r')
  })

  it('keeps a multi-line block together so the shell parses it before running', () => {
    expect(toTerminalInput('git checkout main\ngit pull\n')).toBe('git checkout main\ngit pull\r')
  })

  it('normalizes CRLF input from a Windows-flavoured fence', () => {
    expect(toTerminalInput('echo a\r\necho b\r\n')).toBe('echo a\necho b\r')
  })
})
