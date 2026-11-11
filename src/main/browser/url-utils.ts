import path from 'node:path'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'

const LOOPBACK_HOST = /^localhost$|^127(\.\d{1,3}){3}$|^\[::1\]$/i

export function resolveBrowserUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return 'about:blank'

  // If already has a valid URL scheme
  try {
    const u = new URL(trimmed)
    const proto = u.protocol.toLowerCase()
    if (['http:', 'https:', 'file:', 'about:', 'data:', 'blob:'].includes(proto)) {
      return trimmed
    }
    return trimmed
  } catch {
    // Not a valid URL
  }

  // Check if it's an absolute path, relative path, or file name
  const isAbs = path.isAbsolute(trimmed)
  const hasPathChars = trimmed.includes('/') || trimmed.includes('\\') || trimmed.startsWith('./') || trimmed.startsWith('../')
  const hasExt = /\.[a-z0-9]{2,5}$/i.test(trimmed)

  if (isAbs || hasPathChars || hasExt) {
    const resolvedPath = path.resolve(trimmed)
    return pathToFileURL(resolvedPath).href
  }

  // Check if file exists relative to cwd or absolute
  try {
    const resolvedPath = path.resolve(trimmed)
    if (fs.existsSync(resolvedPath)) {
      return pathToFileURL(resolvedPath).href
    }
  } catch {
    // ignore
  }

  // Domain / host / port check (e.g. localhost:3000, example.com)
  const host = trimmed.split(/[/?#]/)[0]
  const bare = host.replace(/:\d+$/, '')
  const plausible = /^localhost$/i.test(bare)
    || /^127(\.\d{1,3}){3}$/.test(bare)
    || /^\[::1\]$/.test(bare)
    || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(bare)
  if (plausible) {
    const isLoopback = LOOPBACK_HOST.test(bare)
    return `${isLoopback ? 'http' : 'https'}://${trimmed}`
  }

  return trimmed
}
