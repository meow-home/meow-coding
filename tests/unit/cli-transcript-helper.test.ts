import { describe, expect, it } from 'vitest'
import { describeCliStatus, describeCliToolInput, formatCliTime } from '../../src/renderer/src/components/cli/transcript-helper'

describe('cli transcript helper', () => {
  it('describes tool inputs preferring file and command keys', () => {
    expect(describeCliToolInput()).toBe('')
    expect(describeCliToolInput({})).toBe('')
    expect(describeCliToolInput({ path: 'src/index.ts', other: 'ignore' })).toBe('src/index.ts')
    expect(describeCliToolInput({ command: 'npm test -- billing', path: '' })).toBe('npm test -- billing')
    expect(describeCliToolInput({ foo: 'custom_value' })).toBe('custom_value')
  })

  it('formats timestamp to HH:MM', () => {
    expect(formatCliTime(0)).toBe('')
    expect(formatCliTime(Number.NaN)).toBe('')
    const ts = new Date('2026-11-10T14:02:00').getTime()
    const formatted = formatCliTime(ts)
    expect(formatted).toMatch(/^\d{2}:\d{2}$/)
  })

  it('maps session status to label and tone', () => {
    expect(describeCliStatus('running')).toEqual({ label: 'Running', tone: 'ok' })
    expect(describeCliStatus('needs-attention')).toEqual({ label: 'Needs Attention', tone: 'warn' })
    expect(describeCliStatus('failed')).toEqual({ label: 'Failed', tone: 'err' })
    expect(describeCliStatus('idle')).toEqual({ label: 'Idle', tone: 'idle' })
  })
})
