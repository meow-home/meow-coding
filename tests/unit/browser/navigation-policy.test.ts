import { describe, expect, it } from 'vitest'
import { isAllowedNavigation } from '../../../src/main/browser/navigation-policy'

describe('isAllowedNavigation', () => {
  describe('main frame', () => {
    it('allows http, https and about:blank', () => {
      expect(isAllowedNavigation('http://example.com/', true)).toBe(true)
      expect(isAllowedNavigation('HTTPS://example.com/a?b=1', true)).toBe(true)
      expect(isAllowedNavigation('about:blank', true)).toBe(true)
    })

    it('blocks inline documents and custom schemes, but allows file', () => {
      expect(isAllowedNavigation('about:srcdoc', true)).toBe(false)
      expect(isAllowedNavigation('blob:https://example.com/1234', true)).toBe(false)
      expect(isAllowedNavigation('data:text/html,<p>x</p>', true)).toBe(false)
      expect(isAllowedNavigation('file:///C:/secret.txt', true)).toBe(true)
      expect(isAllowedNavigation('FILE:///C:/secret.txt', true)).toBe(true)
      expect(isAllowedNavigation('javascript:alert(1)', true)).toBe(false)
      expect(isAllowedNavigation('meow://open', true)).toBe(false)
    })
  })

  describe('subframe', () => {
    it('allows http, https, about:blank, about:srcdoc, blob and data', () => {
      expect(isAllowedNavigation('http://example.com/frame', false)).toBe(true)
      expect(isAllowedNavigation('https://example.com/frame', false)).toBe(true)
      expect(isAllowedNavigation('about:blank', false)).toBe(true)
      expect(isAllowedNavigation('about:srcdoc', false)).toBe(true)
      expect(isAllowedNavigation('blob:https://example.com/1234', false)).toBe(true)
      expect(isAllowedNavigation('data:text/html,<button>x</button>', false)).toBe(true)
    })

    it('still blocks file and custom schemes', () => {
      expect(isAllowedNavigation('file:///C:/secret.txt', false)).toBe(false)
      expect(isAllowedNavigation('FILE:///C:/secret.txt', false)).toBe(false)
      expect(isAllowedNavigation('javascript:alert(1)', false)).toBe(false)
      expect(isAllowedNavigation('meow://open', false)).toBe(false)
    })
  })

  it('rejects malformed urls for both frame kinds', () => {
    for (const url of ['', 'not a url', 'http://[', '://example.com', 'https://']) {
      expect(isAllowedNavigation(url, true), url).toBe(false)
      expect(isAllowedNavigation(url, false), url).toBe(false)
    }
  })
})
