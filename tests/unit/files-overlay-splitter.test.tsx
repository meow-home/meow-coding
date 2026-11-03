// @vitest-environment jsdom
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FilesOverlay, { FILES_MAIN_MIN_WIDTH, FILES_SIDE_MIN_WIDTH } from '../../src/renderer/src/components/files/FilesOverlay'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../src/renderer/src/components/files/FilesTree', () => ({ default: () => null }))
vi.mock('../../src/renderer/src/components/file-content/FileContentView', () => ({ default: () => null }))

const BODY_WIDTH = 800
const SIDE_WIDTH = 300

let root: Root | null = null
let container: HTMLDivElement | null = null

function rect(width: number): DOMRect {
  return { width, height: 400, top: 0, left: 0, right: width, bottom: 400, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
}

function render(): void {
  act(() => {
    root!.render(createElement(FilesOverlay, { projectPath: '/proj', full: true, onToggleFull: vi.fn(), onClose: vi.fn() }))
  })
}

function side(): HTMLElement {
  return container!.querySelector('.files-side') as HTMLElement
}

function drag(dx: number): void {
  const splitter = container!.querySelector('.files-side-resizer') as HTMLElement
  act(() => {
    splitter.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 + dx }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 100 + dx }))
  })
}

describe('FilesOverlay tree splitter', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('files-body')) return rect(BODY_WIDTH)
      if (this.classList.contains('files-side')) return rect(SIDE_WIDTH)
      return rect(0)
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('keeps the CSS default width until the splitter is dragged', () => {
    render()
    expect(side().style.flexBasis).toBe('')
  })

  it('resizes the tree by the drag distance and remembers it', () => {
    render()
    drag(60)
    expect(side().style.flexBasis).toBe(`${SIDE_WIDTH + 60}px`)
    expect(localStorage.getItem('meow.files.sideWidth')).toBe(String(SIDE_WIDTH + 60))
  })

  it('clamps to the minimum tree width and leaves room for the editor', () => {
    render()
    drag(-1000)
    expect(side().style.flexBasis).toBe(`${FILES_SIDE_MIN_WIDTH}px`)
    drag(5000)
    expect(side().style.flexBasis).toBe(`${BODY_WIDTH - FILES_MAIN_MIN_WIDTH}px`)
  })

  it('restores the saved width and resets it on double-click', () => {
    localStorage.setItem('meow.files.sideWidth', '250')
    render()
    expect(side().style.flexBasis).toBe('250px')
    const splitter = container!.querySelector('.files-side-resizer') as HTMLElement
    act(() => { splitter.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    expect(side().style.flexBasis).toBe('')
    expect(localStorage.getItem('meow.files.sideWidth')).toBeNull()
  })
})
