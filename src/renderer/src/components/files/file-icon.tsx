import { Ban, File, FileCode, FileCog, FileImage, FileJson, FileText, Palette } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type FileIconKind = 'code' | 'json' | 'markdown' | 'image' | 'styles' | 'config' | 'gitignore' | 'file'

export interface FileIconSpec {
  Icon: LucideIcon
  /** Colour class; the colours live in styles.css so the theme owns them. */
  className: string
}

const SPECS: Record<FileIconKind, FileIconSpec> = {
  code: { Icon: FileCode, className: 'file-icon-code' },
  json: { Icon: FileJson, className: 'file-icon-json' },
  markdown: { Icon: FileText, className: 'file-icon-markdown' },
  image: { Icon: FileImage, className: 'file-icon-image' },
  styles: { Icon: Palette, className: 'file-icon-styles' },
  config: { Icon: FileCog, className: 'file-icon-config' },
  gitignore: { Icon: Ban, className: 'file-icon-gitignore' },
  file: { Icon: File, className: 'file-icon-file' }
}

const BY_EXTENSION: Record<string, FileIconKind> = {
  js: 'code', jsx: 'code', mjs: 'code', cjs: 'code', ts: 'code', tsx: 'code', mts: 'code', cts: 'code',
  py: 'code', rb: 'code', go: 'code', rs: 'code', java: 'code', kt: 'code', kts: 'code', swift: 'code',
  c: 'code', h: 'code', cc: 'code', cpp: 'code', hpp: 'code', cs: 'code', php: 'code', lua: 'code',
  sh: 'code', bash: 'code', zsh: 'code', fish: 'code', ps1: 'code', sql: 'code', vue: 'code', svelte: 'code',
  json: 'json', jsonc: 'json', json5: 'json', webmanifest: 'json',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', ico: 'image',
  svg: 'image', avif: 'image',
  css: 'styles', scss: 'styles', sass: 'styles', less: 'styles', styl: 'styles',
  yml: 'config', yaml: 'config', toml: 'config', ini: 'config', cfg: 'config', conf: 'config',
  env: 'config', properties: 'config', lock: 'config'
}

const GITIGNORE_NAMES = new Set(['.gitignore', '.gitattributes', '.dockerignore'])
const CONFIG_NAMES = new Set(['dockerfile', 'makefile', 'procfile', 'caddyfile'])

export function fileIconKind(fileName: string): FileIconKind {
  const name = fileName.toLowerCase()
  if (GITIGNORE_NAMES.has(name)) return 'gitignore'
  if (CONFIG_NAMES.has(name) || name.startsWith('.env')) return 'config'
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return 'file'
  return BY_EXTENSION[name.slice(dot + 1)] ?? 'file'
}

export function fileIconFor(fileName: string): FileIconSpec {
  return SPECS[fileIconKind(fileName)]
}

export function FileIcon({ name, size = 13, className = '' }: { name: string; size?: number; className?: string }) {
  const { Icon, className: kindClass } = fileIconFor(name)
  return (
    <Icon
      size={size}
      aria-hidden="true"
      className={className ? `${kindClass} ${className}` : kindClass}
    />
  )
}

export default FileIcon
