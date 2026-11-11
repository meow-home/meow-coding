import { describe, expect, it } from 'vitest'
import { normalizeUrlInput } from '../../../src/renderer/src/components/browser/normalizeUrlInput'

describe('normalizeUrlInput', () => {
  it('defaults bare hosts to https', () => {
    expect(normalizeUrlInput('example.com')).toBe('https://example.com')
    expect(normalizeUrlInput('  example.com/path?q=1  ')).toBe('https://example.com/path?q=1')
  })

  it('defaults loopback hosts to http', () => {
    expect(normalizeUrlInput('localhost:5173/x')).toBe('http://localhost:5173/x')
    expect(normalizeUrlInput('127.0.0.1:3000')).toBe('http://127.0.0.1:3000')
    expect(normalizeUrlInput('[::1]:3000')).toBe('http://[::1]:3000')
    expect(normalizeUrlInput('LOCALHOST:8080')).toBe('http://LOCALHOST:8080')
  })

  it('leaves a full http(s) URL unchanged', () => {
    expect(normalizeUrlInput('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(normalizeUrlInput('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000/')
  })

  it('rejects spaces, other schemes and malformed input', () => {
    expect(normalizeUrlInput('two words')).toBeNull()
    expect(normalizeUrlInput('file:///C:/secret.txt')).toBe('file:///C:/secret.txt')
    expect(normalizeUrlInput('javascript:alert(1)')).toBeNull()
    expect(normalizeUrlInput('ftp://example.com')).toBeNull()
    expect(normalizeUrlInput('')).toBeNull()
    expect(normalizeUrlInput('   ')).toBeNull()
  })
})
