import { describe, expect, it } from 'vitest'
import { SiteApprovals } from '../../../src/main/browser/site-approval'
import { isLoopback } from '../../../src/shared/loopback'

describe('isLoopback', () => {
  it('accepts the loopback forms', () => {
    for (const origin of [
      'http://localhost',
      'http://localhost:3000',
      'https://LOCALHOST',
      'http://127.0.0.1',
      'http://127.0.0.1:8080',
      'http://[::1]',
      'http://[::1]:5173',
      'http://app.localhost',
      'https://a.b.localhost:9000'
    ]) {
      expect(isLoopback(origin), origin).toBe(true)
    }
  })

  it('does not exempt lookalikes', () => {
    for (const origin of [
      'http://localhost.example.com',
      'http://127.0.0.1.example.com',
      'http://localhost@evil.example',
      'http://notlocalhost',
      'http://localhost.',
      'http://evil.localhost.example',
      'http://[::2]',
      'http://192.168.1.10'
    ]) {
      expect(isLoopback(origin), origin).toBe(false)
    }
  })

  it('treats an unparseable or opaque origin as not exempt', () => {
    expect(isLoopback('null')).toBe(false)
    expect(isLoopback('')).toBe(false)
    expect(isLoopback('about:blank')).toBe(false)
  })
})

describe('SiteApprovals', () => {
  it('keeps approvals per owner', () => {
    const approvals = new SiteApprovals()
    expect(approvals.isAllowed('a', 'https://example.com')).toBe(false)
    approvals.allow('a', 'https://example.com')
    expect(approvals.isAllowed('a', 'https://example.com')).toBe(true)
    expect(approvals.isAllowed('b', 'https://example.com')).toBe(false)
    expect(approvals.isAllowed('a', 'https://other.example')).toBe(false)
  })

  it('clears one owner without touching the others', () => {
    const approvals = new SiteApprovals()
    approvals.allow('a', 'https://example.com')
    approvals.allow('b', 'https://example.com')
    approvals.clearOwner('a')
    expect(approvals.isAllowed('a', 'https://example.com')).toBe(false)
    expect(approvals.isAllowed('b', 'https://example.com')).toBe(true)
  })
})
