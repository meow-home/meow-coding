import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { writeFileAtomic } from '../../src/main/atomic-write'

describe('writeFileAtomic', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'meow-atomic-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('creates parent dirs and writes the data', () => {
    const file = path.join(dir, 'a', 'b', 'c.json')
    writeFileAtomic(file, '{"x":1}')
    expect(readFileSync(file, 'utf-8')).toBe('{"x":1}')
  })

  it('overwrites an existing file and leaves no temp file', () => {
    const file = path.join(dir, 'c.json')
    writeFileAtomic(file, 'first')
    writeFileAtomic(file, 'second')
    expect(readFileSync(file, 'utf-8')).toBe('second')
    expect(existsSync(file + '.tmp')).toBe(false)
  })
})
