export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif']

const MIME_OVERRIDES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  ico: 'image/x-icon'
}

/** data-URL MIME for an image extension, or null when it is not an image. */
export function imageMimeType(ext: string): string | null {
  const e = ext.toLowerCase()
  if (!IMAGE_EXTENSIONS.includes(e)) return null
  return MIME_OVERRIDES[e] ?? `image/${e}`
}
