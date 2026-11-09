import { describe, expect, it } from 'vitest'
import { BrowserRouter } from '../../../src/main/browser/browser-router'
import type { BrowserBackend } from '../../../src/main/browser/browser-backend'

function backend(name: string): BrowserBackend {
  return {
    start: async () => ({ output: `${name} ready` }),
    execute: async () => ({ ok: true, data: { name } }),
    getConsoleLogs: () => [],
    getNetworkLogs: () => []
  }
}

describe('BrowserRouter', () => {
  it('uses the configured default for an owner without a selection', () => {
    const chrome = backend('chrome')
    const builtin = backend('builtin')
    const router = new BrowserRouter({ backends: { chrome, builtin }, defaultBackend: () => 'builtin' })
    expect(router.backendFor('a')).toBe(builtin)
    expect(router.backendFor('b')).toBe(builtin)
  })

  it('resolves to chrome while the built-in backend is absent', () => {
    const chrome = backend('chrome')
    const router = new BrowserRouter({ backends: { chrome }, defaultBackend: () => 'builtin' })
    expect(router.backendFor('a')).toBe(chrome)
  })

  it('keeps the selection sticky per owner', () => {
    const chrome = backend('chrome')
    const builtin = backend('builtin')
    const router = new BrowserRouter({ backends: { chrome, builtin }, defaultBackend: () => 'chrome' })
    router.select('a', 'builtin')
    expect(router.backendFor('a')).toBe(builtin)
    expect(router.backendFor('a')).toBe(builtin)
    expect(router.backendFor('b')).toBe(chrome)
  })

  it('isolates owners from each other', () => {
    const chrome = backend('chrome')
    const builtin = backend('builtin')
    const router = new BrowserRouter({ backends: { chrome, builtin }, defaultBackend: () => 'chrome' })
    router.select('a', 'builtin')
    router.select('b', 'chrome')
    expect(router.backendFor('a')).toBe(builtin)
    expect(router.backendFor('b')).toBe(chrome)
    expect(router.backendFor('c')).toBe(chrome)
  })

  it('rejects a target without a backend and leaves the previous selection', () => {
    const chrome = backend('chrome')
    const router = new BrowserRouter({ backends: { chrome }, defaultBackend: () => 'chrome' })
    router.select('a', 'chrome')
    expect(() => router.select('a', 'builtin')).toThrow(/built-in browser is not available/)
    expect(router.backendFor('a')).toBe(chrome)
  })

  it('reads the default per call, so a settings change applies without a restart', () => {
    const chrome = backend('chrome')
    const builtin = backend('builtin')
    let current: 'builtin' | 'chrome' = 'chrome'
    const router = new BrowserRouter({ backends: { chrome, builtin }, defaultBackend: () => current })
    expect(router.backendFor('a')).toBe(chrome)
    current = 'builtin'
    expect(router.backendFor('a')).toBe(builtin)
  })
})
