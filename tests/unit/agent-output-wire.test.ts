import { describe, expect, it } from 'vitest'
import { DEFAULT_OUTPUT_WIRE_CAP, resolveWireOutputTokens } from '../../src/main/agent/config'

describe('resolveWireOutputTokens', () => {
  it('sends the 32k cap when no limit is known', () => {
    expect(DEFAULT_OUTPUT_WIRE_CAP).toBe(32000)
    expect(resolveWireOutputTokens(null)).toBe(32000)
    expect(resolveWireOutputTokens(undefined)).toBe(32000)
  })

  it('never sends more than the cap even when the model allows more', () => {
    expect(resolveWireOutputTokens(131072)).toBe(32000)
  })

  it('keeps a smaller known or learned limit', () => {
    expect(resolveWireOutputTokens(8192)).toBe(8192)
  })

  it('passes an explicit meow.json override through unchanged', () => {
    expect(resolveWireOutputTokens(8192, 50000)).toBe(50000)
    expect(resolveWireOutputTokens(null, 4096)).toBe(4096)
  })
})
