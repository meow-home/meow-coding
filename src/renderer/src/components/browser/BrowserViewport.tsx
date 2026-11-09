import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, RotateCw } from 'lucide-react'
import type { BrowserTabInfo } from '@shared/browser-types'
import {
  confirmFrozenImagePainted,
  setBrowserPanelAttached,
  setBrowserViewportElement,
  subscribeFrozenImage,
  useBrowserOcclusion
} from '../common/useBrowserOcclusion'

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
  const frame = useRef(0)
  const [frozenImage, setFrozenImage] = useState<string | null>(null)

  // A crashed tab has no usable view: hide it as a cover reason so the message
  // below is visible. Keeping it a reason means a menu closing while the tab is
  // still crashed does not bring the view back.
  useBrowserOcclusion(!!tab?.crashed, 'cover')

  // ResizeObserver misses position-only moves (a CSS transform, the panel's rise
  // animation, the grid re-laying out). Re-measure on animation/transition ends too.
  const schedule = useCallback(() => {
    const el = hostRef.current
    if (!el || frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const rect = roundedRect(el)
      if (rect.width === 0 || rect.height === 0 || sameRect(lastRect.current, rect)) return
      lastRect.current = rect
      void window.api.browserPanelSetBounds(rect).catch(err => {
        onError(err instanceof Error ? err.message : String(err))
      })
    })
  }, [onError])

  // Attach once; IPC order is preserved, so a remount's attach always follows the
  // previous unmount's detach.
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const initial = roundedRect(el)
    lastRect.current = initial
    let cancelled = false
    setBrowserViewportElement(el)
    // Attach first: a reason can be active already (a modal was open before the
    // panel appeared). Freezing before the attach returns would see no view and
    // the attach would then paint over the modal.
    window.api.browserPanelAttach(agentId, initial)
      .then(() => {
        if (!cancelled) setBrowserPanelAttached(true)
      })
      .catch(err => {
        onError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
      lastRect.current = null
      if (frame.current) cancelAnimationFrame(frame.current)
      frame.current = 0
      setBrowserViewportElement(null)
      setBrowserPanelAttached(false)
      void window.api.browserPanelDetach().catch(() => {})
    }
  }, [agentId, onError])

  useEffect(() => subscribeFrozenImage(setFrozenImage), [])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const observer = new ResizeObserver(schedule)
    observer.observe(el)
    if (el.parentElement) observer.observe(el.parentElement)
    const main = document.querySelector('.main')
    if (main) observer.observe(main)
    window.addEventListener('resize', schedule)
    document.addEventListener('animationend', schedule, true)
    document.addEventListener('transitionend', schedule, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('animationend', schedule, true)
      document.removeEventListener('transitionend', schedule, true)
    }
  }, [schedule])

  // The banner and the error row move the viewport without changing the panel size.
  useEffect(() => {
    schedule()
  }, [tab?.id, tab?.control, schedule])

  return (
    <div className="browser-viewport" ref={hostRef}>
      {frozenImage && (
        <img
          className="browser-frozen"
          src={frozenImage}
          alt=""
          aria-hidden="true"
          draggable={false}
          onLoad={e => {
            const img = e.currentTarget
            void img
              .decode()
              .catch(() => {})
              .then(() => {
                requestAnimationFrame(() => requestAnimationFrame(() => confirmFrozenImagePainted()))
              })
          }}
        />
      )}
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
