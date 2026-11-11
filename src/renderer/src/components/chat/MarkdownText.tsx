import { useMemo } from 'react'
import { marked } from 'marked'
import markedKatex from 'marked-katex-extension'
import DOMPurify from 'dompurify'
import { normalizeMarkdownTables } from './markdownTable'
import { isPathLike } from './markdownPaths'
import { shellLanguage } from './commandBlocks'

interface Props {
  text: string
  onOpenFile?: (path: string) => void
  onRunCommand?: (command: string) => void
}

marked.setOptions({ gfm: true, breaks: true })
marked.use(markedKatex({ throwOnError: false, nonStandard: true }))

const DOMPURIFY_CONFIG = {
  ADD_TAGS: [
    'math',
    'annotation',
    'semantics',
    'mtext',
    'mn',
    'mo',
    'mi',
    'mspace',
    'mover',
    'munder',
    'munderover',
    'msup',
    'msub',
    'msubsup',
    'mfrac',
    'mroot',
    'msqrt',
    'mtable',
    'mtr',
    'mtd',
    'mlabeledtr',
    'mrow'
  ],
  ADD_ATTR: ['aria-hidden', 'tabindex', 'style', 'encoding', 'mathvariant']
}

// Static icons for the command box. Built with the DOM API after sanitizing,
// so they never travel through the markdown HTML string.
const ICON_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"'
const ICON_RUN = `<svg ${ICON_ATTRS}><polygon points="6 3 20 12 6 21 6 3"/></svg>`
const ICON_COPY = `<svg ${ICON_ATTRS}><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`
const ICON_CHECK = `<svg ${ICON_ATTRS}><path d="M20 6 9 17l-5-5"/></svg>`

function commandButton(doc: Document, action: 'run' | 'copy', label: string, icon: string): HTMLButtonElement {
  const btn = doc.createElement('button')
  btn.type = 'button'
  btn.className = 'chat-cmd-btn'
  btn.dataset.cmdAction = action
  btn.title = label
  btn.setAttribute('aria-label', label)
  btn.innerHTML = icon
  return btn
}

// Wraps a shell fence in a command box: the code on the left, Run/Copy on the
// right. The command itself stays the code element's text, so the buttons read
// it back instead of duplicating it into an attribute (multi-line safe).
function decorateCommandBlock(doc: Document, pre: Element): void {
  pre.classList.add('chat-cmd-text')
  const box = doc.createElement('div')
  box.className = 'chat-cmd'
  const actions = doc.createElement('div')
  actions.className = 'chat-cmd-actions'
  actions.append(
    commandButton(doc, 'run', 'Run in terminal', ICON_RUN),
    commandButton(doc, 'copy', 'Copy command', ICON_COPY)
  )
  pre.replaceWith(box)
  box.append(pre, actions)
}

function commandText(button: HTMLElement): string {
  const code = button.closest('.chat-cmd')?.querySelector('.chat-cmd-text')
  return (code?.textContent ?? '').replace(/\s+$/, '')
}

export default function MarkdownText({ text, onOpenFile, onRunCommand }: Props) {
  const canRun = Boolean(onRunCommand)
  const html = useMemo(() => {
    const raw = marked.parse(normalizeMarkdownTables(text), { async: false }) as string
    const sanitized = DOMPurify.sanitize(raw, DOMPURIFY_CONFIG)
    // Post-process instead of a custom marked renderer: keeps the default
    // renderer for link text/escaping and avoids global marked.use mutations.
    const doc = new DOMParser().parseFromString(sanitized, 'text/html')
    doc.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href') ?? ''
      if (href.startsWith('#') || /^(https?|mailto):/i.test(href)) return
      if (isPathLike(href)) {
        a.setAttribute('href', '#')
        a.setAttribute('data-file', href)
        a.classList.add('chat-file-link')
      }
    })
    doc.querySelectorAll('code').forEach(code => {
      // Code blocks (fenced/indented) are never file links — only inline code
      // can reference a path. Without this a long block whose last line ends
      // in .ext gets underlined like a link.
      if (code.closest('pre')) return
      const t = code.textContent?.trim() ?? ''
      if (isPathLike(t)) {
        code.setAttribute('data-file', t)
        code.classList.add('chat-file-link')
      }
    })
    if (canRun) {
      doc.querySelectorAll('pre > code').forEach(code => {
        const pre = code.parentElement
        if (!pre) return
        if (shellLanguage(code.className.match(/(?:^|\s)language-(\S+)/)?.[1])) {
          decorateCommandBlock(doc, pre)
        }
      })
    }
    return doc.body.innerHTML
  }, [text, canRun])

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd-action]')
    if (btn) {
      const command = commandText(btn)
      if (!command) return
      if (btn.dataset.cmdAction === 'run') {
        onRunCommand?.(command)
      } else {
        void navigator.clipboard.writeText(command).then(() => {
          btn.classList.add('copied')
          btn.innerHTML = ICON_CHECK
          setTimeout(() => {
            btn.classList.remove('copied')
            btn.innerHTML = ICON_COPY
          }, 1500)
        }).catch(() => {})
      }
      return
    }
    if (!onOpenFile) return
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-file]')
    if (!el) return
    const p = el.getAttribute('data-file')
    if (p) {
      e.preventDefault()
      onOpenFile(p)
    }
  }

  return (
    <div className="chat-text chat-md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
  )
}
