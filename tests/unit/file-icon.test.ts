import { describe, expect, it } from 'vitest'
import { fileIconFor, fileIconKind, type FileIconKind } from '../../src/renderer/src/components/files/file-icon'

describe('fileIconKind', () => {
  it('maps source files to the code icon', () => {
    for (const name of ['index.ts', 'App.tsx', 'main.js', 'script.py', 'main.go', 'lib.rs', 'run.sh']) {
      expect(fileIconKind(name)).toBe('code')
    }
  })

  it('maps json, markdown, images and styles', () => {
    expect(fileIconKind('package.json')).toBe('json')
    expect(fileIconKind('tsconfig.jsonc')).toBe('json')
    expect(fileIconKind('README.md')).toBe('markdown')
    expect(fileIconKind('logo.png')).toBe('image')
    expect(fileIconKind('icon.svg')).toBe('image')
    expect(fileIconKind('styles.css')).toBe('styles')
    expect(fileIconKind('theme.scss')).toBe('styles')
  })

  it('maps config files by extension and by name', () => {
    expect(fileIconKind('docker-compose.yml')).toBe('config')
    expect(fileIconKind('Cargo.toml')).toBe('config')
    expect(fileIconKind('.env')).toBe('config')
    expect(fileIconKind('.env.local')).toBe('config')
    expect(fileIconKind('Dockerfile')).toBe('config')
  })

  it('gives ignore files their own icon', () => {
    expect(fileIconKind('.gitignore')).toBe('gitignore')
    expect(fileIconKind('.dockerignore')).toBe('gitignore')
  })

  it('falls back to the generic icon', () => {
    expect(fileIconKind('LICENSE')).toBe('file')
    expect(fileIconKind('archive.tar')).toBe('file')
    expect(fileIconKind('.npmrc')).toBe('file')
    expect(fileIconKind('trailing.')).toBe('file')
  })

  it('ignores the extension case', () => {
    expect(fileIconKind('MAIN.TS')).toBe('code')
    expect(fileIconKind('README.MD')).toBe('markdown')
  })

  it('gives every kind its own colour class', () => {
    const kinds: FileIconKind[] = ['code', 'json', 'markdown', 'image', 'styles', 'config', 'gitignore', 'file']
    const classes = kinds.map(kind => {
      const sample: Record<FileIconKind, string> = {
        code: 'a.ts',
        json: 'a.json',
        markdown: 'a.md',
        image: 'a.png',
        styles: 'a.css',
        config: 'a.yml',
        gitignore: '.gitignore',
        file: 'LICENSE'
      }
      expect(fileIconKind(sample[kind])).toBe(kind)
      return fileIconFor(sample[kind]).className
    })
    expect(new Set(classes).size).toBe(kinds.length)
  })
})
