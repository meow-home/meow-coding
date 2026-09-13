import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { listDir, listProjectDir, shouldIgnore, sortEntries } from '../../src/main/dir-lister'
import type { DirEntry } from '../../src/shared/types'

describe('shouldIgnore', () => {
  it('ignores dotfiles and common build/dependency dirs', () => {
    expect(shouldIgnore('.git')).toBe(true)
    expect(shouldIgnore('.env')).toBe(true)
    expect(shouldIgnore('node_modules')).toBe(true)
    expect(shouldIgnore('dist')).toBe(true)
    expect(shouldIgnore('out')).toBe(true)
    expect(shouldIgnore('src')).toBe(false)
    expect(shouldIgnore('README.md')).toBe(false)
  })
})

describe('sortEntries', () => {
  it('sorts directories first, then files, case-insensitively', () => {
    const entries: DirEntry[] = [
      { name: 'zeta.ts', path: '/x/zeta.ts', isDirectory: false },
      { name: 'Alpha', path: '/x/Alpha', isDirectory: true },
      { name: 'beta', path: '/x/beta', isDirectory: false },
      { name: 'src', path: '/x/src', isDirectory: true }
    ]
    expect(sortEntries(entries).map(e => e.name)).toEqual(['Alpha', 'src', 'beta', 'zeta.ts'])
  })

  it('does not mutate the input array', () => {
    const entries: DirEntry[] = [
      { name: 'b', path: '/x/b', isDirectory: false },
      { name: 'a', path: '/x/a', isDirectory: false }
    ]
    sortEntries(entries)
    expect(entries.map(e => e.name)).toEqual(['b', 'a'])
  })
})

describe('listDir', () => {
  it('lists files and dirs, skipping ignored entries', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-dir-'))
    mkdirSync(path.join(dir, 'src'))
    mkdirSync(path.join(dir, 'node_modules'))
    writeFileSync(path.join(dir, 'README.md'), 'hi')
    writeFileSync(path.join(dir, '.gitignore'), 'x')
    const entries = await listDir(dir)
    expect(entries.map(e => e.name).sort()).toEqual(['README.md', 'src'])
    const src = entries.find(e => e.name === 'src')
    expect(src?.isDirectory).toBe(true)
    expect(src?.path).toBe(path.join(dir, 'src'))
  })

  it('returns [] for an empty dir', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-empty-'))
    expect(await listDir(dir)).toEqual([])
  })
})

describe('listDir ignore option', () => {
  it('skips dotfiles and ignored dirs by default', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'meow-dir-ignore-'))
    mkdirSync(path.join(root, 'node_modules'))
    writeFileSync(path.join(root, '.gitignore'), 'x')
    writeFileSync(path.join(root, 'index.ts'), 'x')

    expect((await listDir(root)).map(e => e.name)).toEqual(['index.ts'])
  })

  it('lists dotfiles and node_modules when ignore is false', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'meow-dir-all-'))
    mkdirSync(path.join(root, 'node_modules'))
    writeFileSync(path.join(root, '.gitignore'), 'x')
    writeFileSync(path.join(root, 'index.ts'), 'x')

    expect((await listDir(root, { ignore: false })).map(e => e.name))
      .toEqual(['node_modules', '.gitignore', 'index.ts'])
  })
})

describe('listProjectDir', () => {
  it('rejects a path outside the project', async () => {
    await expect(listProjectDir('/proj', path.join('/other', 'x'))).rejects.toThrow('Not a project path')
  })

  it('accepts the project root itself and ignores nothing', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'meow-dir-proj-'))
    mkdirSync(path.join(root, 'node_modules'))
    writeFileSync(path.join(root, '.env'), 'x')

    expect((await listProjectDir(root, root)).map(e => e.name)).toEqual(['node_modules', '.env'])
  })
})
