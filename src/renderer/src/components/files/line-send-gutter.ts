import { GutterMarker, gutter } from '@codemirror/view'
import { Prec, type Extension } from '@codemirror/state'

export interface SendTextInput {
  /** Project-relative, forward-slash path shown in the composer. */
  relPath: string
  /** Fence language id; '' renders a plain fence. */
  lang: string
  startLine: number
  endLine: number
  code: string
}

export interface LineSendTarget {
  agentId: string
  relPath: string
  lang: string
}

const LANGUAGES: Record<string, string> = {
  js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js', ts: 'ts', tsx: 'tsx', mts: 'ts', cts: 'ts',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin',
  swift: 'swift', lua: 'lua', php: 'php', cs: 'csharp', sql: 'sql', vue: 'vue', svelte: 'svelte',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'fish', ps1: 'powershell',
  json: 'json', jsonc: 'json', json5: 'json',
  html: 'html', htm: 'html', svg: 'html', xml: 'xml',
  css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  md: 'md', markdown: 'md', mdx: 'mdx',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini'
}

/** Fence language for a file path; an unknown extension gets a plain fence. */
export function languageLabel(filePath: string): string {
  const name = filePath.toLowerCase()
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return LANGUAGES[name.slice(dot + 1)] ?? ''
}

function longestBacktickRun(code: string): number {
  let longest = 0
  let run = 0
  for (const char of code) {
    if (char === '`') {
      run++
      if (run > longest) longest = run
    } else {
      run = 0
    }
  }
  return longest
}

export function buildSendText({ relPath, lang, startLine, endLine, code }: SendTextInput): string {
  const range = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`
  // One backtick longer than the longest run inside the code keeps the fence intact.
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(code) + 1))
  return `\`${relPath}:${range}\`\n${fence}${lang}\n${code}\n${fence}`
}

class SendMarker extends GutterMarker {
  toDOM(): Node {
    const marker = document.createElement('span')
    marker.className = 'cm-line-send'
    marker.title = 'Send line to chat'
    marker.textContent = '+'
    return marker
  }
}

const marker = new SendMarker()

/**
 * A gutter left of the line numbers with a `+` on the hovered line. Clicking it
 * sends that line — or the selected lines, when the clicked line is inside a
 * non-empty selection — to the target session's composer.
 */
export function lineSendGutter(getTarget: () => LineSendTarget | null): Extension {
  // Highest precedence puts this gutter before the line numbers and the fold
  // gutter, so adding it never shifts them.
  return Prec.highest(gutter({
    class: 'cm-line-send-gutter',
    lineMarker: () => marker,
    initialSpacer: () => marker,
    domEventHandlers: {
      mousedown(view, block, event) {
        const target = getTarget()
        if (!target) return false
        event.preventDefault()
        const doc = view.state.doc
        const clickedLine = doc.lineAt(block.from).number
        const selection = view.state.selection.main
        let startLine = clickedLine
        let endLine = clickedLine
        if (!selection.empty) {
          const first = doc.lineAt(selection.from).number
          const last = doc.lineAt(selection.to).number
          if (clickedLine >= first && clickedLine <= last) {
            startLine = first
            endLine = last
          }
        }
        const code = doc.sliceString(doc.line(startLine).from, doc.line(endLine).to)
        const text = buildSendText({ relPath: target.relPath, lang: target.lang, startLine, endLine, code })
        // The composer focuses itself when it inserts; the gutter click must not
        // pull focus out of wherever the user was.
        const previous = document.activeElement as HTMLElement | null
        window.dispatchEvent(new CustomEvent('meow:composer-insert', { detail: { agentId: target.agentId, text } }))
        if (previous && previous !== document.activeElement && typeof previous.focus === 'function') previous.focus()
        return true
      }
    }
  }))
}
