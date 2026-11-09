import { useEffect, useRef } from 'react'
import { Plus, RotateCw } from 'lucide-react'
import type { BrowserTabInfo } from '@shared/browser-types'

interface Props {
  agentId: string
  tab: BrowserTabInfo | null
  onNewTab: () => void
  onReloadCrash: () => void
  onError: (message: string) => void
}

interface Rect { x: number; y: number; width: number; height: number }

function roundedRect(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
}

function sameRect(a: Rect | null, b: Rect): boolean {
  return !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

export default function BrowserViewport({ agentId, tab, onNewTab, onReloadCrash, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const lastRect = useRef<Rect | null>(null)

  // Attach once; IPC order is preserved, so a remount's attach always follows the
  // previous unmount's detach.
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const initial = roundedRect(el)
    lastRect.current = initial
    window.api.browserPanelAttach(agentId, initial).catch(err => {
      onError(err instanceof Error ? err.message : String(err))
    })
    return () => {
      lastRect.current = null
      void window.api.browserPanelDetach().catch(() => {})
    }
  }, [agentId, onError])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    let frame = 0
    const send = (): void => {
      frame = 0
      const rect = roundedRect(el)
      if (rect.width === 0 || rect.height === 0 || sameRect(lastRect.current, rect)) return
      lastRect.current = rect
      void window.api.browserPanelSetBounds(rect).catch(err => {
        onError(err instanceof Error ? err.message : String(err))
      })
    }
    const schedule = (): void => {
      if (frame) return
      frame = requestAnimationFrame(send)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(el)
    window.addEventListener('resize', schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [onError])

  // A crashed tab has no usable view: freeze it away so the message below is visible.
  useEffect(() => {
    let active = true
    if (tab?.crashed) {
      void window.api.browserPanelFreeze().then(frozen => {
        if (active && frozen) window.api.browserPanelHideFrozen(frozen.generation).catch(() => {})
      }).catch(() => {})
    } else {
      window.api.browserPanelUnfreeze().catch(() => {})
    }
    return () => {
      active = false
    }
  }, [tab?.id, tab?.crashed])

  return (
    <div className="browser-viewport" ref={hostRef}>
      {tab?.crashed && (
        <div className="browser-empty" role="alert">
          <div className="browser-empty-title">This tab crashed.</div>
          <button className="btn" onClick={onReloadCrash}>
            <RotateCw size={14} aria-hidden="true" />
            <span>Reload</span>
          </button>
        </div>
      )}
      {!tab && (
        <div className="browser-empty">
          <div className="browser-empty-title">No open tabs</div>
          <button className="btn" onClick={onNewTab}>
            <Plus size={14} aria-hidden="true" />
            <span>New tab</span>
          </button>
        </div>
      )}
    </div>
  )
}
