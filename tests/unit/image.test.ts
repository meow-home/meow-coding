import { describe, expect, it } from 'vitest'
import { IMAGE_EXTENSIONS, imageMimeType } from '../../src/shared/image'

describe('imageMimeType', () => {
  it('maps raster extensions to data-URL MIME types', () => {
    expect(imageMimeType('png')).toBe('image/png')
    expect(imageMimeType('gif')).toBe('image/gif')
    expect(imageMimeType('webp')).toBe('image/webp')
    expect(imageMimeType('bmp')).toBe('image/bmp')
    expect(imageMimeType('avif')).toBe('image/avif')
  })
  it('maps jpg and jpeg to image/jpeg', () => {
    expect(imageMimeType('jpg')).toBe('image/jpeg')
    expect(imageMimeType('jpeg')).toBe('image/jpeg')
  })
  it('maps ico to image/x-icon', () => {
    expect(imageMimeType('ico')).toBe('image/x-icon')
  })
  it('is case-insensitive', () => {
    expect(imageMimeType('PNG')).toBe('image/png')
  })
  it('returns null for non-image extensions', () => {
    for (const e of ['svg', 'ts', 'tsx', 'pdf', 'md', 'txt', '']) {
      expect(imageMimeType(e)).toBeNull()
    }
  })
})

describe('IMAGE_EXTENSIONS', () => {
  it('lists exactly the raster formats the viewer supports', () => {
    expect(IMAGE_EXTENSIONS).toEqual(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif'])
  })
  it('excludes svg, which stays a text file', () => {
    expect(IMAGE_EXTENSIONS).not.toContain('svg')
  })
})
