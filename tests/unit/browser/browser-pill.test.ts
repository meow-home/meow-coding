import { describe, expect, it } from 'vitest'
import { browserPillLabel } from '../../../src/renderer/src/components/browserPillLabel'
import type { BrowserStatusInfo } from '../../../src/shared/browser-types'

const status = (overrides: Partial<BrowserStatusInfo>): BrowserStatusInfo => ({
  status: 'idle',
  ...overrides
} as BrowserStatusInfo)

describe('browserPillLabel', () => {
  it('shows the built-in backend calmly', () => {
    expect(browserPillLabel('builtin', status({ status: 'idle' }))).toEqual({ text: 'browser: built-in', tone: 'builtin' })
    expect(browserPillLabel(undefined, null)).toEqual({ text: 'browser: built-in', tone: 'builtin' })
  })

  it('lets a pending extension approval win over the built-in label', () => {
    expect(browserPillLabel('builtin', status({ pendingExtension: { extensionId: 'x', name: 'x' } } as never)))
      .toEqual({ text: 'browser: approval needed', tone: 'waiting' })
  })

  it('keeps the Chrome bridge states', () => {
    expect(browserPillLabel('chrome', status({ paired: true }))).toEqual({ text: 'browser: paired', tone: 'paired' })
    expect(browserPillLabel('chrome', status({ pendingExtension: { extensionId: 'x' } } as never)))
      .toEqual({ text: 'browser: approval needed', tone: 'waiting' })
    expect(browserPillLabel('chrome', status({ status: 'listening' }))).toEqual({ text: 'browser: waiting', tone: 'waiting' })
    expect(browserPillLabel('chrome', status({ status: 'stopped' }))).toEqual({ text: 'browser: off', tone: 'offline' })
  })
})
