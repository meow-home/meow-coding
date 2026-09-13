import { describe, expect, it } from 'vitest'
import { baseName, joinProjectPath } from '../../src/renderer/src/components/files/file-path'

describe('baseName', () => {
  it('returns the last segment of a posix path', () => {
    expect(baseName('/p/src/index.ts')).toBe('index.ts')
  })

  it('returns the last segment of a windows path', () => {
    expect(baseName('C:\\p\\src\\index.ts')).toBe('index.ts')
  })
})

describe('joinProjectPath', () => {
  it('joins with a slash on posix roots', () => {
    expect(joinProjectPath('/p', 'src/a.ts')).toBe('/p/src/a.ts')
  })

  it('joins with a backslash on windows roots and drops a trailing separator', () => {
    expect(joinProjectPath('C:\\p\\', 'src/a.ts')).toBe('C:\\p\\src\\a.ts')
  })
})
