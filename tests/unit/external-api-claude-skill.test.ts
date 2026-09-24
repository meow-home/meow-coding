import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { installClaudeSkill } from '../../src/main/external-api/claude-skill'

describe('installClaudeSkill', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'meow-skill-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('writes SKILL.md with the CLI path substituted using forward slashes', () => {
    const out = installClaudeSkill({
      templatePath: path.resolve('resources/external-api/claude-skill.md'),
      cliPath: 'C:\\Users\\me\\AppData\\Roaming\\Meow Coding\\bin\\meow-delegate.mjs',
      skillsDir: dir
    })
    expect(out).toBe(path.join(dir, 'meow-delegate', 'SKILL.md'))
    const text = readFileSync(out, 'utf8')
    expect(text).toMatch(/^---\r?\nname: meow-delegate\r?\n/)
    expect(text).toContain('node "C:/Users/me/AppData/Roaming/Meow Coding/bin/meow-delegate.mjs"')
    expect(text).not.toContain('{{CLI_PATH}}')
  })
})
