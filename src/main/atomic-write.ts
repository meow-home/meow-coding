import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// On Windows, renameSync over an existing file throws EPERM/EACCES/EBUSY while
// the destination is transiently locked (antivirus, Search Indexer, OneDrive).
// Retry with backoff before falling back to an in-place overwrite.
const RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80]
const sleepBuf = new Int32Array(new SharedArrayBuffer(4))

function renameOverwrite(tmp: string, filePath: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, filePath)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      const transient = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
      if (!transient || attempt >= RENAME_RETRY_DELAYS_MS.length) throw err
      Atomics.wait(sleepBuf, 0, 0, RENAME_RETRY_DELAYS_MS[attempt])
    }
  }
}

/** Writes data by swapping in a temp file, so a crash mid-write cannot leave a
 * half-written file. Creates parent dirs. */
export function writeFileAtomic(filePath: string, data: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, data)
  try {
    renameOverwrite(tmp, filePath)
  } catch {
    try { rmSync(tmp, { force: true }) } catch { /* best effort */ }
    writeFileSync(filePath, data)
  }
}
