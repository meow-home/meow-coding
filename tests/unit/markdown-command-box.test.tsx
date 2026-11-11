// @vitest-environment jsdom
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MarkdownText from '../../src/renderer/src/components/chat/MarkdownText'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let copied: string[]

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  copied = []
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn((text: string) => { copied.push(text); return Promise.resolve() }) }
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(text: string, onRunCommand?: (command: string) => void): void {
  act(() => {
    root.render(createElement(MarkdownText, { text, onRunCommand }))
  })
}

const boxes = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('.chat-cmd')]
const button = (action: 'run' | 'copy'): HTMLButtonElement =>
  container.querySelector<HTMLButtonElement>(`.chat-cmd-btn[data-cmd-action="${action}"]`)!

describe('MarkdownText command boxes', () => {
  it('wraps a bash fence in a command box with Run and Copy', () => {
    render('Run this:\n\n```bash\ngit branch -d fix/v0.4.1-review\n```\n', vi.fn())

    expect(boxes()).toHaveLength(1)
    expect(container.querySelector('.chat-cmd-text')?.textContent).toBe('git branch -d fix/v0.4.1-review\n')
    expect(button('run').getAttribute('aria-label')).toBe('Run in terminal')
    expect(button('copy').getAttribute('aria-label')).toBe('Copy command')
    expect(container.textContent).toContain('Run this:')
  })

  it('leaves non-shell fences as plain code blocks', () => {
    render('```ts\nconst a = 1\n```\n\n```console\n$ npm test\nok\n```\n', vi.fn())

    expect(boxes()).toHaveLength(0)
    expect(container.querySelectorAll('pre')).toHaveLength(2)
  })

  it('renders no command box when the caller cannot run one', () => {
    render('```bash\ngit status\n```\n')

    expect(boxes()).toHaveLength(0)
    expect(container.querySelector('pre')?.textContent).toBe('git status\n')
  })

  it('hands the whole block to onRunCommand', () => {
    const onRun = vi.fn()
    render('```powershell\nGet-ChildItem\ngit status\n```\n', onRun)

    act(() => button('run').click())

    expect(onRun).toHaveBeenCalledWith('Get-ChildItem\ngit status')
  })

  it('copies the command without the trailing newline', async () => {
    render('```sh\ngit status\n```\n', vi.fn())

    await act(async () => {
      button('copy').click()
      await Promise.resolve()
    })

    expect(copied).toEqual(['git status'])
    expect(button('copy').classList.contains('copied')).toBe(true)
  })

  it('does not treat a command box click as a file link', () => {
    const onOpenFile = vi.fn()
    act(() => {
      root.render(createElement(MarkdownText, { text: '```bash\n./scripts/build.sh\n```\n', onRunCommand: vi.fn(), onOpenFile }))
    })

    act(() => button('run').click())

    expect(onOpenFile).not.toHaveBeenCalled()
  })
})
