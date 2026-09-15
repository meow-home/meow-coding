// tests/unit/project-encode.test.ts
import { describe, expect, it } from 'vitest'
import { encodeProjectPath } from '../../src/main/project-encode'

describe('encodeProjectPath', () => {
  it('encodes a Windows path the Claude CLI way', () => {
    expect(encodeProjectPath('E:\\Git\\GitHub\\meow-coding')).toBe('E--Git-GitHub-meow-coding')
  })
  it('encodes a POSIX path', () => {
    expect(encodeProjectPath('/home/me/proj')).toBe('-home-me-proj')
  })
  it('leaves an already-dashed name unchanged', () => {
    expect(encodeProjectPath('meow-coding')).toBe('meow-coding')
  })
})
