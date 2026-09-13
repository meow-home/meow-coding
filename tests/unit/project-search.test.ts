import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { searchProject, SEARCH_MAX_RESULTS } from '../../src/main/project-search'

function makeProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'meow-search-'))
  mkdirSync(path.join(root, 'src'))
  writeFileSync(path.join(root, 'src', 'a.ts'), 'const foo = 1\nconst bar = 2\n')
  writeFileSync(path.join(root, 'README.md'), 'foo appears here too\n')
  mkdirSync(path.join(root, 'node_modules', 'dep'), { recursive: true })
  writeFileSync(path.join(root, 'node_modules', 'dep', 'index.js'), 'foo in a dependency\n')
  return root
}

describe('searchProject', () => {
  it('returns relative path, 1-based line and trimmed text', async () => {
    const hits = await searchProject(makeProject(), 'foo')
    expect(hits).toContainEqual({ path: 'src/a.ts', line: 1, text: 'const foo = 1' })
  })

  it('skips node_modules', async () => {
    const hits = await searchProject(makeProject(), 'foo')
    expect(hits.map(h => h.path)).not.toContain('node_modules/dep/index.js')
  })

  it('restricts candidates with include globs', async () => {
    const hits = await searchProject(makeProject(), 'foo', { include: ['**/*.md'] })
    expect(hits.map(h => h.path)).toEqual(['README.md'])
  })

  it('caps the number of hits', async () => {
    const hits = await searchProject(makeProject(), 'foo', { maxResults: 1 })
    expect(hits).toHaveLength(1)
  })

  it('rejects an invalid pattern', async () => {
    await expect(searchProject(makeProject(), 'foo(')).rejects.toThrow()
  })

  it('exposes the agent-facing result cap', () => {
    expect(SEARCH_MAX_RESULTS).toBe(200)
  })
})
