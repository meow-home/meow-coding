import { describe, expect, it } from 'vitest'
import { findLoopbackLinks } from '../../../src/renderer/src/components/terminal/findLoopbackLinks'

describe('findLoopbackLinks', () => {
  it('matches loopback http(s) URLs', () => {
    for (const url of [
      'http://localhost:5173/',
      'https://127.0.0.1:3000/x?y=1',
      'http://[::1]:8080',
      'http://app.localhost:3000',
      'http://localhost'
    ]) {
      const links = findLoopbackLinks(`  ready at ${url}`)
      expect(links.map(l => l.url), url).toEqual([url])
    }
  })

  it('rejects lookalikes and non-http schemes', () => {
    for (const url of [
      'http://localhost.evil.example',
      'http://127.0.0.1.evil.example',
      'http://localhost@evil.example',
      'ftp://localhost',
      'file:///x'
    ]) {
      expect(findLoopbackLinks(url), url).toEqual([])
    }
    expect(findLoopbackLinks('localhost:5173')).toEqual([])
  })

  it('trims trailing punctuation and brackets', () => {
    expect(findLoopbackLinks('http://localhost:5173/.').map(l => l.url)).toEqual(['http://localhost:5173/'])
    expect(findLoopbackLinks('(http://localhost:5173/)').map(l => l.url)).toEqual(['http://localhost:5173/'])
    expect(findLoopbackLinks('http://localhost:5173/,').map(l => l.url)).toEqual(['http://localhost:5173/'])
  })

  it('reports 0-based columns and finds multiple links', () => {
    const line = 'a http://localhost:1/ b http://127.0.0.1:2/x'
    const links = findLoopbackLinks(line)
    expect(links).toEqual([
      { start: 2, end: 21, url: 'http://localhost:1/' },
      { start: 24, end: 44, url: 'http://127.0.0.1:2/x' }
    ])
    expect(line.slice(links[0].start, links[0].end)).toBe(links[0].url)
    expect(line.slice(links[1].start, links[1].end)).toBe(links[1].url)
  })

  it('returns nothing for a wrapped URL fragment', () => {
    expect(findLoopbackLinks('http://localhost:5173/very/long')).toHaveLength(1)
    expect(findLoopbackLinks('very/long')).toHaveLength(0)
  })
})
