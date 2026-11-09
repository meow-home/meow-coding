import { describe, expect, it } from 'vitest'
import { buildSendText, languageLabel } from '../../src/renderer/src/components/files/line-send-gutter'

describe('buildSendText', () => {
  it('sends a single line with :N and the language fence', () => {
    expect(buildSendText({ relPath: 'src/a.ts', lang: 'ts', startLine: 12, endLine: 12, code: 'const x = 1' }))
      .toBe('`src/a.ts:12`\n```ts\nconst x = 1\n```')
  })

  it('sends a range as :start-end', () => {
    expect(buildSendText({
      relPath: 'src/a.ts', lang: 'ts', startLine: 12, endLine: 14, code: 'a\nb\nc'
    })).toBe('`src/a.ts:12-14`\n```ts\na\nb\nc\n```')
  })

  it('uses a fence longer than any backtick run in the code', () => {
    const text = buildSendText({
      relPath: 'notes.md', lang: 'md', startLine: 3, endLine: 3, code: 'const s = "```"'
    })
    expect(text).toBe('`notes.md:3`\n````md\nconst s = "```"\n````')
  })

  it('renders a plain fence for an unknown language', () => {
    expect(buildSendText({ relPath: 'a.weird', lang: '', startLine: 1, endLine: 1, code: 'x' }))
      .toBe('`a.weird:1`\n```\nx\n```')
  })
})

describe('languageLabel', () => {
  it('maps known extensions to their fence language', () => {
    expect(languageLabel('src/app.ts')).toBe('ts')
    expect(languageLabel('App.tsx')).toBe('tsx')
    expect(languageLabel('main.py')).toBe('python')
    expect(languageLabel('README.md')).toBe('md')
    expect(languageLabel('data.json')).toBe('json')
    expect(languageLabel('run.sh')).toBe('bash')
    expect(languageLabel('Cargo.toml')).toBe('toml')
  })

  it('gives an unknown or missing extension a plain fence', () => {
    expect(languageLabel('a.weird')).toBe('')
    expect(languageLabel('LICENSE')).toBe('')
    expect(languageLabel('.gitignore')).toBe('')
  })
})
