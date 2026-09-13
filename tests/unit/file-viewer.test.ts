import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({ BrowserWindow: class {}, shell: {}, Notification: class {} }))

import {
  extOf, isImagePath, isTextPath, looksLikeBinaryContent, MAX_IMAGE_BYTES, readImageDataUrl, TEXT_EXTENSIONS
} from '../../src/main/file-viewer'

describe('extOf', () => {
  it('extracts lowercase extension', () => {
    expect(extOf('README.MD')).toBe('md')
    expect(extOf('/a/b/app.ts')).toBe('ts')
    expect(extOf('C:\\proj\\notes.txt')).toBe('txt')
  })
  it('returns empty for no extension or dotfiles', () => {
    expect(extOf('Dockerfile')).toBe('')
    expect(extOf('.gitignore')).toBe('')
    expect(extOf('a.')).toBe('')
  })
})

describe('isTextPath', () => {
  it('returns true for known text extensions', () => {
    for (const p of ['README.md', '/a/b/app.ts', 'pkg.json', 'notes.txt', 'main.py', 'styles.css', 'C:\\x\\y.yaml']) {
      expect(isTextPath(p)).toBe(true)
    }
  })
  it('opens code files in the viewer: tsx, java, vue and more', () => {
    for (const p of ['a.tsx', 'b.java', 'c.vue', 'd.svelte', 'e.kt', 'f.swift', 'g.cs', 'h.dart', 'i.rb', 'j.ex', 'k.clj']) {
      expect(isTextPath(p)).toBe(true)
    }
  })
  it('treats extension-less files as text', () => {
    expect(isTextPath('Dockerfile')).toBe(true)
    expect(isTextPath('Makefile')).toBe(true)
  })
  it('returns false for binary extensions', () => {
    for (const p of ['a.pdf', 'a.docx', 'a.png', 'a.zip', 'a.exe', 'a.mp4']) {
      expect(isTextPath(p)).toBe(false)
    }
  })
  it('returns null (unknown) for unlisted extensions', () => {
    expect(isTextPath('a.xyz')).toBeNull()
    expect(isTextPath('b.unknown')).toBeNull()
  })
})

describe('looksLikeBinaryContent', () => {
  it('detects NUL bytes', () => {
    expect(looksLikeBinaryContent('a\u0000b')).toBe(true)
  })
  it('returns false for plain text', () => {
    expect(looksLikeBinaryContent('hello world\nline 2')).toBe(false)
  })
})

describe('TEXT_EXTENSIONS', () => {
  it('includes core text extensions', () => {
    for (const e of ['md', 'txt', 'ts', 'tsx', 'json', 'py', 'yaml', 'yml', 'css', 'html']) {
      expect(TEXT_EXTENSIONS).toContain(e)
    }
  })
  it('includes code file extensions across languages', () => {
    for (const e of [
      'tsx', 'jsx', 'vue', 'svelte', 'astro', 'scss', 'less',
      'java', 'kt', 'swift', 'dart', 'cs', 'go', 'rs', 'zig', 'nim',
      'rb', 'php', 'lua', 'pl', 'hs', 'ex', 'clj', 'erl', 'fs',
      'mts', 'cts', 'graphql', 'gql', 'proto', 'prisma', 'tf', 'hcl'
    ]) {
      expect(TEXT_EXTENSIONS).toContain(e)
    }
  })
})

describe('isImagePath', () => {
  it('returns true for the raster formats the viewer shows', () => {
    for (const p of ['a.png', 'b.jpg', 'c.jpeg', 'd.gif', 'e.webp', 'f.bmp', 'g.ico', 'h.avif', 'I.PNG']) {
      expect(isImagePath(p)).toBe(true)
    }
  })
  it('returns false for text, binary and extension-less paths', () => {
    for (const p of ['a.svg', 'a.ts', 'a.pdf', 'a.md', 'Dockerfile', 'a.']) {
      expect(isImagePath(p)).toBe(false)
    }
  })
  it('takes precedence over the text/binary split', () => {
    expect(isTextPath('logo.png')).toBe(false)
    expect(isImagePath('logo.png')).toBe(true)
  })
})

describe('readImageDataUrl', () => {
  it('returns a data URL that decodes back to the original bytes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-img-'))
    try {
      const file = path.join(dir, 'pixel.png')
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02])
      writeFileSync(file, bytes)
      const r = await readImageDataUrl(file)
      expect(r.path).toBe(file)
      expect(r.ext).toBe('png')
      expect(r.mime).toBe('image/png')
      expect(r.sizeBytes).toBe(bytes.length)
      expect(r.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
      const b64 = r.dataUrl.slice('data:image/png;base64,'.length)
      expect(Buffer.compare(Buffer.from(b64, 'base64'), bytes)).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('uses image/jpeg for jpg and image/x-icon for ico', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-img-'))
    try {
      const jpg = path.join(dir, 'photo.jpg')
      const ico = path.join(dir, 'favicon.ico')
      writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff]))
      writeFileSync(ico, Buffer.from([0x00, 0x00, 0x01]))
      expect((await readImageDataUrl(jpg)).mime).toBe('image/jpeg')
      expect((await readImageDataUrl(ico)).mime).toBe('image/x-icon')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('rejects a missing file', async () => {
    await expect(readImageDataUrl(path.join(tmpdir(), 'meow-missing-image-xyz.png')))
      .rejects.toThrow('File not found:')
  })
  it('rejects a file above the 10MB cap', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meow-img-'))
    try {
      const big = path.join(dir, 'big.png')
      writeFileSync(big, Buffer.alloc(MAX_IMAGE_BYTES + 1))
      await expect(readImageDataUrl(big)).rejects.toThrow('Image is too large')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('rejects a path that is not an image', async () => {
    await expect(readImageDataUrl(path.join(tmpdir(), 'notes.txt'))).rejects.toThrow('Not an image file')
  })
})
