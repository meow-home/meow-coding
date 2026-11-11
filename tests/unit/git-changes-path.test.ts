import { describe, expect, it } from 'vitest'
import { splitChangePath } from '../../src/renderer/src/components/git/GitChangesView'

describe('splitChangePath', () => {
  it('splits a nested file into name and directory', () => {
    expect(splitChangePath('packages/ui/src/index.ts')).toEqual({
      name: 'index.ts',
      dir: 'packages/ui/src/'
    })
  })

  it('keeps a root-level file free of a directory', () => {
    expect(splitChangePath('index.ts')).toEqual({ name: 'index.ts', dir: '' })
  })

  it('keeps the slash on a directory entry instead of showing the whole path as a name', () => {
    // Porcelain can still collapse an untracked directory into "dir/".
    expect(splitChangePath('packages/ui/src/primitives/focus/')).toEqual({
      name: 'focus',
      dir: 'packages/ui/src/primitives/'
    })
    expect(splitChangePath('newdir/')).toEqual({ name: 'newdir', dir: '' })
  })

  it('handles backslash separators', () => {
    expect(splitChangePath('src\\main\\index.ts')).toEqual({
      name: 'index.ts',
      dir: 'src\\main\\'
    })
  })
})
