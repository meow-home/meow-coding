import { useEffect, useId } from 'react'

/**
 * Occlusion for the native browser panel.
 *
 * The panel's WebContentsView paints above all renderer HTML, so any overlay that
 * must appear over it has to hide the view first. Hiding costs a capture, so the
 * module keeps a single counter: 0→1 freezes (capture → image → hide), 1→0 shows
 * the view again. Every caller only adds/removes its own reason, so order does not
 * matter. Reasons are `overlay` (a menu/modal needs the frozen image) or `cover`
 * (a full panel or a hidden project covers the placeholder; no capture needed).
 */

export type OcclusionKind = 'overlay' | 'cover'

export interface FreezeResult {
  generation: number
  image: string | null
}

export interface OcclusionDeps {
  freeze(): Promise<FreezeResult | null>
  hide(): Promise<void>
  hideFrozen(generation: number): Promise<void>
  unfreeze(): Promise<void>
  schedule(cb: () => void): number
  cancel(id: number): void
  publish(image: string | null): void
}

export class BrowserOcclusionController {
  private readonly reasons = new Map<string, OcclusionKind>()
  private attached = false
  private seq = 0
  private pending = false
  private hidden = false
  private hiding = false
  private frozen: FreezeResult | null = null
  private showFrame = 0

  constructor(private readonly deps: OcclusionDeps) {}

  /** Called by BrowserViewport when its placeholder is mounted / unmounted. */
  setAttached(attached: boolean): void {
    if (this.attached === attached) return
    this.attached = attached
    if (!attached) {
      this.reset()
      return
    }
    this.engage()
  }

  get reasonCount(): number {
    return this.reasons.size
  }

  isHidden(): boolean {
    return this.hidden
  }

  add(reason: string, kind: OcclusionKind): void {
    if (this.reasons.get(reason) === kind) return
    this.reasons.set(reason, kind)
    this.engage()
  }

  remove(reason: string): void {
    const kind = this.reasons.get(reason)
    if (!this.reasons.delete(reason)) return
    if (this.reasons.size === 0) {
      this.release()
      return
    }
    // The last overlay went away while a cover reason still hides the view:
    // drop the stale page image, the placeholder shows its own content now.
    if (kind === 'overlay' && !this.hasOverlay()) {
      this.seq++
      this.pending = false
      this.frozen = null
      this.deps.publish(null)
    }
  }

  /** Main showed a new tab (activate/create/handoff) while a reason is active. */
  refreeze(): void {
    if (!this.attached || this.reasons.size === 0) return
    // Main just made the new tab visible, so the view is on screen again even
    // though a reason is still active: capture and hide it again.
    const wasHidden = this.hidden || this.hiding
    this.seq++
    this.pending = false
    this.hidden = false
    this.hiding = false
    if (wasHidden) {
      // Main re-showed the tab just now; hide it again without waiting for the
      // new capture, so the page does not paint over the open overlay.
      this.hiding = true
      void this.deps.hide().catch(() => {})
    }
    this.engage()
  }

  private hasOverlay(): boolean {
    return [...this.reasons.values()].includes('overlay')
  }

  /** BrowserViewport painted the frozen image: hide the native view now. */
  imagePainted(): void {
    const frozen = this.frozen
    if (!frozen || this.hidden || this.reasons.size === 0) return
    this.hiding = true
    const seq = this.seq
    void this.deps
      .hideFrozen(frozen.generation)
      .then(() => {
        if (seq === this.seq) this.hidden = true
      })
      .catch(() => {})
  }

  private engage(): void {
    if (!this.attached || this.reasons.size === 0 || this.pending || this.hidden) return
    const overlay = this.hasOverlay()
    const seq = ++this.seq
    this.pending = true
    if (!overlay) {
      // Fully covered: no capture, the placeholder shows its own background.
      this.hiding = true
      void this.deps
        .hide()
        .then(() => {
          if (seq !== this.seq) return
          this.pending = false
          this.hidden = true
        })
        .catch(() => {
          if (seq === this.seq) this.pending = false
        })
      return
    }
    void this.deps
      .freeze()
      .then(result => {
        if (seq !== this.seq) return
        this.pending = false
        if (!result) return
        if (result.image == null) {
          this.hiding = true
          void this.deps
            .hideFrozen(result.generation)
            .then(() => {
              if (seq === this.seq) this.hidden = true
            })
            .catch(() => {})
          return
        }
        this.frozen = result
        this.deps.publish(result.image)
      })
      .catch(() => {
        if (seq === this.seq) this.pending = false
      })
  }

  private release(): void {
    this.seq++
    this.pending = false
    const wasHidden = this.hidden || this.hiding
    this.hidden = false
    this.hiding = false
    this.frozen = null
    if (wasHidden) void this.deps.unfreeze().catch(() => {})
    if (this.showFrame) this.deps.cancel(this.showFrame)
    // Show the view first; drop the image on the next frame so there is no blank frame.
    this.showFrame = this.deps.schedule(() => {
      this.showFrame = 0
      this.deps.publish(null)
    })
  }

  private reset(): void {
    this.seq++
    this.pending = false
    this.hidden = false
    this.hiding = false
    this.frozen = null
    if (this.showFrame) this.deps.cancel(this.showFrame)
    this.showFrame = 0
    this.deps.publish(null)
  }
}

// ---- module singleton (renderer) -------------------------------------------

let controller: BrowserOcclusionController | null = null
let viewportEl: HTMLElement | null = null
const imageListeners = new Set<(image: string | null) => void>()

function getController(): BrowserOcclusionController {
  if (controller) return controller
  controller = new BrowserOcclusionController({
    freeze: () => window.api.browserPanelFreeze(),
    hide: () => window.api.browserPanelHide(),
    hideFrozen: generation => window.api.browserPanelHideFrozen(generation),
    unfreeze: () => window.api.browserPanelUnfreeze(),
    schedule: cb => requestAnimationFrame(cb),
    cancel: id => cancelAnimationFrame(id),
    publish: image => {
      for (const listener of imageListeners) listener(image)
    }
  })
  return controller
}

export function beginOcclusion(reason: string, kind: OcclusionKind = 'overlay'): void {
  getController().add(reason, kind)
}

export function endOcclusion(reason: string): void {
  controller?.remove(reason)
}

export function setBrowserPanelAttached(attached: boolean): void {
  getController().setAttached(attached)
}

export function setBrowserViewportElement(el: HTMLElement | null): void {
  viewportEl = el
}

export function refreezeBrowserPanel(): void {
  controller?.refreeze()
}

export function confirmFrozenImagePainted(): void {
  controller?.imagePainted()
}

export function subscribeFrozenImage(cb: (image: string | null) => void): () => void {
  imageListeners.add(cb)
  return () => {
    imageListeners.delete(cb)
  }
}

/** Whether a fixed overlay rect intersects the panel placeholder on screen. */
export function overlapsBrowserViewport(rect: { left: number; top: number; right: number; bottom: number } | null): boolean {
  if (!rect || !viewportEl || !viewportEl.isConnected) return false
  const view = viewportEl.getBoundingClientRect()
  if (view.width === 0 || view.height === 0) return false
  return rect.left < view.right && rect.right > view.left && rect.top < view.bottom && rect.bottom > view.top
}

// ---- React hook -------------------------------------------------------------

export function useBrowserOcclusion(active: boolean, kind: OcclusionKind = 'overlay'): void {
  const id = useId()
  useEffect(() => {
    if (!active) return
    beginOcclusion(id, kind)
    return () => endOcclusion(id)
  }, [active, kind, id])
}
