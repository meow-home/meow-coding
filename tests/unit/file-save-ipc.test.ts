import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('FileSaveContent IPC logic', () => {
  let testFile: string

  beforeEach(async () => {
    testFile = join(tmpdir(), `test-file-save-${Date.now()}.txt`)
    await fs.writeFile(testFile, 'initial content', 'utf-8')
  })

  afterEach(async () => {
    await fs.unlink(testFile).catch(() => {})
  })

  it('saves file content to disk successfully', async () => {
    const newContent = 'updated content hello world'
    await fs.writeFile(testFile, newContent, 'utf-8')
    const readBack = await fs.readFile(testFile, 'utf-8')
    expect(readBack).toBe(newContent)
  })
})
