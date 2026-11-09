import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SNAPSHOT_UNTRUSTED_NOTICE, writeSnapshotFile } from '../../../src/main/browser/snapshot-output'
import type { BrowserCommandResult, SnapshotNode } from '../../../src/shared/browser-types'

interface SnapshotData {
  path: string
  size: number
  nodeCount: number
  preview: string
}

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meow-snapshot-'))
})

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/** `snapshotToText` renders one line per node, so this tree is `children + 1` lines. */
function flatTree(children: number): SnapshotNode[] {
  return [{
    role: 'rootwebarea',
    children: Array.from({ length: children }, (_, i) => ({ role: 'button', name: `b${i + 1}` }))
  }]
}

function okData(result: BrowserCommandResult): SnapshotData {
  if (!result.ok) throw new Error(result.error)
  return result.data as SnapshotData
}

describe('writeSnapshotFile', () => {
  it('starts the file and the preview with the untrusted-content notice', () => {
    const data = okData(writeSnapshotFile(dir, flatTree(2)))
    const fileLines = readFileSync(data.path, 'utf-8').split('\n')
    expect(fileLines[0]).toBe(SNAPSHOT_UNTRUSTED_NOTICE)
    expect(fileLines.slice(1)).toEqual(['rootwebarea', '  button "b1"', '  button "b2"'])
    expect(data.preview.split('\n')[0]).toBe(SNAPSHOT_UNTRUSTED_NOTICE)
    expect(data.preview).toContain('button "b1"')
  })

  it('counts tree nodes only, not the notice line', () => {
    expect(okData(writeSnapshotFile(dir, flatTree(2))).nodeCount).toBe(3)
    expect(okData(writeSnapshotFile(dir, [])).nodeCount).toBe(0)
  })

  it('reports the byte size of the written file, notice included', () => {
    const data = okData(writeSnapshotFile(dir, flatTree(2)))
    const written = readFileSync(data.path, 'utf-8')
    expect(data.size).toBe(Buffer.byteLength(written, 'utf-8'))
    expect(data.size).toBeGreaterThan(Buffer.byteLength(SNAPSHOT_UNTRUSTED_NOTICE, 'utf-8'))
  })

  it('shows 80 page lines in the preview without a cut message', () => {
    const data = okData(writeSnapshotFile(dir, flatTree(79)))
    const lines = data.preview.split('\n')
    expect(lines[0]).toBe(SNAPSHOT_UNTRUSTED_NOTICE)
    expect(lines).toHaveLength(81)
    expect(lines[1]).toBe('rootwebarea')
    expect(lines[80]).toBe('  button "b79"')
    expect(data.preview).not.toContain('preview cut')
  })

  it('cuts after 80 page lines and keeps the notice outside the limit', () => {
    const data = okData(writeSnapshotFile(dir, flatTree(80)))
    const lines = data.preview.split('\n')
    expect(lines[0]).toBe(SNAPSHOT_UNTRUSTED_NOTICE)
    expect(lines).toHaveLength(82)
    expect(lines[1]).toBe('rootwebarea')
    expect(lines[80]).toBe('  button "b79"')
    expect(lines[81]).toContain('preview cut')
    expect(data.preview).not.toContain('b80')
    // The file is never cut.
    const fileLines = readFileSync(data.path, 'utf-8').split('\n')
    expect(fileLines).toHaveLength(82)
    expect(fileLines[81]).toBe('  button "b80"')
  })

  it('writes only the notice for an empty tree', () => {
    const data = okData(writeSnapshotFile(dir, []))
    expect(readFileSync(data.path, 'utf-8')).toBe(SNAPSHOT_UNTRUSTED_NOTICE)
    expect(data.preview).toBe(SNAPSHOT_UNTRUSTED_NOTICE)
  })
})
