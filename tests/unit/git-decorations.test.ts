import { describe, expect, it } from 'vitest'
import type { GitFileChange, GitStatusDetail } from '../../src/shared/types'
import {
  buildGitDecorations, decorationFor, directoryDecoration, projectRelativePath
} from '../../src/renderer/src/components/files/git-decorations'

function detail(files: Array<Pick<GitFileChange, 'path' | 'status'>>): GitStatusDetail {
  return {
    branch: 'main',
    headOid: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: files.map(file => ({ ...file, staged: false, unstaged: true }))
  }
}

describe('buildGitDecorations', () => {
  it('maps every status kind to its letter', () => {
    const dec = buildGitDecorations(detail([
      { path: 'a.ts', status: 'added' },
      { path: 'b.ts', status: 'modified' },
      { path: 'c.ts', status: 'deleted' },
      { path: 'd.ts', status: 'renamed' },
      { path: 'e.ts', status: 'typechange' },
      { path: 'f.ts', status: 'untracked' }
    ]))
    expect(dec.files['a.ts'].letter).toBe('A')
    expect(dec.files['b.ts'].letter).toBe('M')
    expect(dec.files['c.ts'].letter).toBe('D')
    expect(dec.files['d.ts'].letter).toBe('R')
    expect(dec.files['e.ts'].letter).toBe('T')
    expect(dec.files['f.ts'].letter).toBe('U')
  })

  it('colours additions green, changes yellow and deletions red', () => {
    const dec = buildGitDecorations(detail([
      { path: 'added.ts', status: 'added' },
      { path: 'untracked.ts', status: 'untracked' },
      { path: 'modified.ts', status: 'modified' },
      { path: 'renamed.ts', status: 'renamed' },
      { path: 'typechange.ts', status: 'typechange' },
      { path: 'deleted.ts', status: 'deleted' }
    ]))
    expect(dec.files['added.ts'].kind).toBe('added')
    expect(dec.files['untracked.ts'].kind).toBe('added')
    expect(dec.files['modified.ts'].kind).toBe('modified')
    expect(dec.files['renamed.ts'].kind).toBe('modified')
    expect(dec.files['typechange.ts'].kind).toBe('modified')
    expect(dec.files['deleted.ts'].kind).toBe('deleted')
  })

  it('collects the ancestor directories of every change', () => {
    const dec = buildGitDecorations(detail([{ path: 'src/lib/a.ts', status: 'modified' }]))
    expect([...dec.dirs].sort()).toEqual(['src', 'src/lib'])
    expect(dec.dirs.has('a.ts')).toBe(false)
  })

  it('marks an untracked directory and everything below it', () => {
    const dec = buildGitDecorations(detail([{ path: 'newdir/', status: 'untracked' }]))
    expect(dec.files.newdir).toMatchObject({ letter: 'U', kind: 'added', directory: true })
    expect(dec.dirs.has('newdir')).toBe(false)

    expect(decorationFor(dec, 'newdir')).toMatchObject({ letter: 'U', kind: 'added' })
    expect(decorationFor(dec, 'newdir/deep/file.ts')).toMatchObject({ letter: 'U', kind: 'added' })
    expect(directoryDecoration(dec, 'newdir')).toMatchObject({ letter: 'U', kind: 'added' })
    expect(decorationFor(dec, 'other/file.ts')).toBeNull()
  })

  it('strips the quotes porcelain puts around a path', () => {
    const dec = buildGitDecorations(detail([
      { path: '"my file.ts"', status: 'modified' },
      { path: '"a\\"b.ts"', status: 'modified' }
    ]))
    expect(dec.files['my file.ts']).toMatchObject({ letter: 'M' })
    expect(dec.files['a"b.ts']).toMatchObject({ letter: 'M' })
  })

  it('uses the new path of a rename', () => {
    const dec = buildGitDecorations(detail([{ path: 'old.ts -> new.ts', status: 'renamed' }]))
    expect(dec.files['new.ts']).toMatchObject({ letter: 'R', kind: 'modified' })
    expect(dec.files['old.ts']).toBeUndefined()
  })

  it('returns empty results for a null detail', () => {
    const dec = buildGitDecorations(null)
    expect(dec.files).toEqual({})
    expect(dec.dirs.size).toBe(0)
    expect(decorationFor(dec, 'src/a.ts')).toBeNull()
    expect(directoryDecoration(dec, 'src')).toBeNull()
  })

  it('decorates a directory that only holds changes with a dot', () => {
    const dec = buildGitDecorations(detail([{ path: 'src/a.ts', status: 'modified' }]))
    expect(directoryDecoration(dec, 'src')).toMatchObject({ kind: 'modified' })
    expect(directoryDecoration(dec, 'other')).toBeNull()
  })

  it('never decorates .git or paths outside the repository', () => {
    const dec = buildGitDecorations(detail([{ path: 'src/a.ts', status: 'modified' }]))
    expect(decorationFor(dec, '.git')).toBeNull()
    expect(decorationFor(dec, '.git/config')).toBeNull()
    expect(directoryDecoration(dec, '.git')).toBeNull()
  })
})

describe('projectRelativePath', () => {
  it('strips the project root and normalizes separators', () => {
    expect(projectRelativePath('/proj', '/proj/src/a.ts')).toBe('src/a.ts')
    expect(projectRelativePath('C:\\proj', 'C:\\proj\\src\\a.ts')).toBe('src/a.ts')
    expect(projectRelativePath('/proj/', '/proj/src/a.ts')).toBe('src/a.ts')
  })

  it('keeps a path that is outside the project unchanged', () => {
    expect(projectRelativePath('/proj', '/elsewhere/a.ts')).toBe('/elsewhere/a.ts')
  })
})
