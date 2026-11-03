import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import BaseDropdown from '../common/BaseDropdown'

interface TerminalViewProps {
  terminalId: string
  agentId: string
}

// The terminal is always dark (--terminal-* tokens are not overridden by the light theme),
// so the theme is read once and never follows a data-theme flip.
function getTerminalTheme() {
  const style = window.getComputedStyle(document.documentElement)
  const background = style.getPropertyValue('--terminal-bg').trim() || '#0a0a0b'
  const foreground = style.getPropertyValue('--terminal-fg').trim() || '#e5e5e5'
  return {
    background,
    foreground,
    cursor: foreground,
    selectionBackground: 'rgba(0, 122, 204, 0.35)',
    fontFamily: style.getPropertyValue('--font-mono').trim() || 'monospace'
  }
}

export default function TerminalView({ terminalId, agentId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [hasSelection, setHasSelection] = useState(false)

  useEffect(() => {
    let disposed = false
    const initialTheme = getTerminalTheme()
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: initialTheme.fontFamily,
      fontSize: 13,
      theme: {
        background: initialTheme.background,
        foreground: initialTheme.foreground,
        cursor: initialTheme.cursor,
        selectionBackground: initialTheme.selectionBackground
      }
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    xtermRef.current = term
    fitAddonRef.current = fitAddon

    if (containerRef.current) {
      term.open(containerRef.current)
      try {
        fitAddon.fit()
      } catch {}
    }

    const dataDisposable = term.onData((data) => {
      if (disposed) return
      void window.api.terminalWrite(terminalId, data)
    })

    let resizeObserver: ResizeObserver | null = null
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        if (disposed || !containerRef.current) return
        if (resizeTimer) clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => {
          if (disposed || !containerRef.current) return
          try {
            fitAddon.fit()
            if (term.cols && term.rows) {
              void window.api.terminalResize(terminalId, term.cols, term.rows)
            }
          } catch {}
        }, 50)
      })
      resizeObserver.observe(containerRef.current)
    }

    let isAttached = false
    const buffer: string[] = []

    const unlistenData = window.api.onTerminalData((event) => {
      if (event.id !== terminalId) return
      if (!isAttached) {
        buffer.push(event.data)
      } else {
        term.write(event.data)
      }
    })

    window.api
      .terminalAttach(terminalId)
      .then((snapshot) => {
        if (disposed) return
        if (snapshot.scrollback) {
          term.write(snapshot.scrollback)
        }
        for (const chunk of buffer) {
          term.write(chunk)
        }
        buffer.length = 0
        isAttached = true
      })
      .catch((err) => {
        if (disposed) return
        console.error('[meow] Failed to attach terminal:', err)
      })

    return () => {
      disposed = true
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeObserver?.disconnect()
      unlistenData()
      dataDisposable.dispose()
      void window.api.terminalDetach(terminalId).catch(() => {})
      term.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, [terminalId])

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const term = xtermRef.current
    const sel = term ? term.getSelection() : ''
    setHasSelection(Boolean(sel && sel.length > 0))
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleSendSelection = () => {
    const sel = xtermRef.current?.getSelection() || ''
    if (sel) {
      const text = `\`\`\`text\n${sel}\n\`\`\``
      window.dispatchEvent(new CustomEvent('meow:composer-insert', { detail: { agentId, text } }))
    }
    setContextMenu(null)
  }

  const handleCopy = () => {
    const sel = xtermRef.current?.getSelection() || ''
    if (sel) {
      void navigator.clipboard.writeText(sel)
    }
    setContextMenu(null)
  }

  const handleSend100Lines = () => {
    const term = xtermRef.current
    if (term) {
      const buf = term.buffer.active
      const lines: string[] = []
      const end = buf.baseY + buf.cursorY
      const start = Math.max(0, end - 100)
      for (let i = start; i <= end; i++) {
        const line = buf.getLine(i)
        if (line) lines.push(line.translateToString(true))
      }
      const rawText = lines.join('\n').trimEnd()
      if (rawText) {
        const text = `\`\`\`text\n${rawText}\n\`\`\``
        window.dispatchEvent(new CustomEvent('meow:composer-insert', { detail: { agentId, text } }))
      }
    }
    setContextMenu(null)
  }

  const handlePaste = () => {
    void navigator.clipboard
      .readText()
      .then((clip) => {
        if (clip) {
          void window.api.terminalWrite(terminalId, clip)
        }
      })
      .catch(() => {})
    setContextMenu(null)
  }

  const handleClear = () => {
    xtermRef.current?.clear()
    setContextMenu(null)
  }

  return (
    <div className="terminal-view-container" onContextMenu={handleContextMenu}>
      <div className="terminal-view-host" ref={containerRef} />
      <BaseDropdown
        menuClassName="sidebar-menu-dropdown"
        open={Boolean(contextMenu)}
        onOpenChange={(open) => {
          if (!open) setContextMenu(null)
        }}
        anchorPoint={contextMenu ?? undefined}
      >
        {hasSelection && (
          <>
            <button className="menu-item" onClick={handleSendSelection}>
              Send selection to chat
            </button>
            <button className="menu-item" onClick={handleCopy}>
              Copy
            </button>
            <div className="menu-sep" />
          </>
        )}
        <button className="menu-item" onClick={handleSend100Lines}>
          Send last 100 lines to chat
        </button>
        <button className="menu-item" onClick={handlePaste}>
          Paste
        </button>
        <div className="menu-sep" />
        <button className="menu-item" onClick={handleClear}>
          Clear scrollback
        </button>
      </BaseDropdown>
    </div>
  )
}
