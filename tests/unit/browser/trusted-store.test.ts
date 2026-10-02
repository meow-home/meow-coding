import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createJsonStore } from '../../../src/main/json-store'
import { TrustedExtensionStore } from '../../../src/main/browser/trusted-store'
import type { TrustedExtension } from '../../../src/shared/browser-types'

const dirs: string[] = []

function tmpFile(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'meow-trusted-'))
  dirs.push(d)
  return path.join(d, 'browser-trusted.json')
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('TrustedExtensionStore', () => {
  it('starts empty when the file does not exist', () => {
    const s = new TrustedExtensionStore(createJsonStore<TrustedExtension>(tmpFile()))
    expect(s.list()).toEqual([])
    expect(s.has('abc')).toBe(false)
  })

  it('approves an id and persists it across instances', () => {
    const file = tmpFile()
    const s = new TrustedExtensionStore(createJsonStore<TrustedExtension>(file))
    s.approve('abc', '0.3.4')
    expect(s.has('abc')).toBe(true)
    expect(s.list()[0]).toMatchObject({ id: 'abc', version: '0.3.4' })

    const reloaded = new TrustedExtensionStore(createJsonStore<TrustedExtension>(file))
    expect(reloaded.has('abc')).toBe(true)
  })

  it('re-approving the same id updates it instead of duplicating', () => {
    const s = new TrustedExtensionStore(createJsonStore<TrustedExtension>(tmpFile()))
    s.approve('abc', '0.3.4')
    s.approve('abc', '0.3.5')
    expect(s.list()).toHaveLength(1)
    expect(s.list()[0].version).toBe('0.3.5')
  })

  it('revokes an id and persists the removal', () => {
    const file = tmpFile()
    const s = new TrustedExtensionStore(createJsonStore<TrustedExtension>(file))
    s.approve('abc')
    s.revoke('abc')
    expect(s.has('abc')).toBe(false)

    const reloaded = new TrustedExtensionStore(createJsonStore<TrustedExtension>(file))
    expect(reloaded.list()).toEqual([])
  })

  it('works in memory when no store is injected', () => {
    const s = new TrustedExtensionStore()
    s.approve('abc')
    expect(s.has('abc')).toBe(true)
    s.revoke('abc')
    expect(s.has('abc')).toBe(false)
  })
})
