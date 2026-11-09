import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { BrowserCommandResult, SnapshotNode } from '../../shared/browser-types'
import { countSnapshotNodes, snapshotToText } from './snapshot-format'

export function writeSnapshotFile(dir: string, tree: SnapshotNode[]): BrowserCommandResult {
  try {
    mkdirSync(dir, { recursive: true })
    const text = snapshotToText(tree)
    const file = path.join(dir, `browser-snapshot-${Date.now()}.txt`)
    writeFileSync(file, text, 'utf-8')
    const lines = text.split('\n')
    const preview = lines.slice(0, 80).join('\n') + (lines.length > 80 ? '\n...(preview cut — read the file for the full snapshot)' : '')
    return {
      ok: true,
      data: {
        path: file,
        size: Buffer.byteLength(text, 'utf-8'),
        nodeCount: countSnapshotNodes(tree),
        preview
      }
    }
  } catch (err) {
    return { ok: false, error: `snapshot save failed: ${String(err)}` }
  }
}
