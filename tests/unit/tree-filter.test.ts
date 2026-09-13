import { describe, expect, it } from 'vitest'
import { filterTree } from '../../src/renderer/src/components/files/tree-filter'
import type { DirEntry } from '../../src/shared/types'

const dir = (name: string, p: string): DirEntry => ({ name, path: p, isDirectory: true })
const file = (name: string, p: string): DirEntry => ({ name, path: p, isDirectory: false })

const entries = [dir('src', '/p/src'), file('README.md', '/p/README.md')]
const loaded = { '/p/src': [file('index.ts', '/p/src/index.ts'), file('app.tsx', '/p/src/app.tsx')] }

describe('filterTree', () => {
  it('returns nothing for an empty query', () => {
    expect(filterTree(entries, loaded, '   ')).toEqual([])
  })

  it('keeps matches case-insensitively', () => {
    const result = filterTree(entries, loaded, 'readme')
    expect(result.map(n => n.entry.name)).toEqual(['README.md'])
  })

  it('keeps the ancestor chain of a nested match', () => {
    const result = filterTree(entries, loaded, 'index')
    expect(result.map(n => n.entry.name)).toEqual(['src'])
    expect(result[0].children.map(n => n.entry.name)).toEqual(['index.ts'])
  })

  it('never reads directories that were not loaded', () => {
    expect(filterTree(entries, {}, 'index')).toEqual([])
  })
})
