import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { click, read, scroll, select, type, waitFor } from '../../../src/main/browser/cdp-commands'
import type { CdpClient } from '../../../src/main/browser/browser-tab'
import { SNAPSHOT_UNTRUSTED_NOTICE } from '../../../src/main/browser/snapshot-output'
import type { BrowserCommandResult } from '../../../src/shared/browser-types'

class FakeCdp implements CdpClient {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = []
  responses: Record<string, unknown> = {}
  onSend: ((method: string) => Promise<void> | void) | null = null

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params })
    if (this.onSend) await this.onSend(method)
    return (this.responses[method] ?? {}) as T
  }

  onEvent(): () => void {
    return () => {}
  }
}

function paramsOf(call: { params?: Record<string, unknown> }): Record<string, unknown> {
  return call.params ?? {}
}

function errorOf(result: BrowserCommandResult): string {
  if (result.ok) throw new Error('expected an error result')
  return result.error
}

function fakeCdp(): FakeCdp {
  const cdp = new FakeCdp()
  cdp.responses['DOM.getDocument'] = { root: { nodeId: 1 } }
  cdp.responses['DOM.querySelector'] = { nodeId: 7 }
  cdp.responses['DOM.resolveNode'] = { object: { objectId: 'obj-1' } }
  cdp.responses['DOM.getBoxModel'] = {
    model: { content: [10, 20, 110, 20, 110, 70, 10, 70], width: 100, height: 50 }
  }
  // `isConnected` checks return true; callers that need another value override it.
  cdp.responses['Runtime.callFunctionOn'] = { result: { value: true } }
  return cdp
}

describe('cdp click', () => {
  it('clicks the centre of the content quad', async () => {
    const cdp = fakeCdp()
    const result = await click(cdp, new Map(), { selector: '#btn' })
    expect(result).toEqual({ ok: true, data: { selector: '#btn' } })
    expect(cdp.calls.map(c => c.method)).toEqual([
      'DOM.getDocument',
      'DOM.querySelector',
      'DOM.scrollIntoViewIfNeeded',
      'DOM.getBoxModel',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent'
    ])
    expect(paramsOf(cdp.calls[2])).toEqual({ nodeId: 7 })
    const dispatched = cdp.calls.filter(c => c.method === 'Input.dispatchMouseEvent').map(paramsOf)
    expect(dispatched).toEqual([
      { type: 'mouseMoved', x: 60, y: 45 },
      { type: 'mousePressed', x: 60, y: 45, button: 'left', clickCount: 1 },
      { type: 'mouseReleased', x: 60, y: 45, button: 'left', clickCount: 1 }
    ])
  })

  it('uses the backend node id for a ref without a prior DOM.getDocument', async () => {
    const cdp = fakeCdp()
    const result = await click(cdp, new Map([['r1', 42]]), { ref: 'r1' })
    expect(result).toEqual({ ok: true, data: { ref: 'r1' } })
    expect(cdp.calls.map(c => c.method)).toEqual([
      'DOM.scrollIntoViewIfNeeded',
      'DOM.getBoxModel',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent'
    ])
    expect(paramsOf(cdp.calls[0])).toEqual({ backendNodeId: 42 })
    expect(paramsOf(cdp.calls[1])).toEqual({ backendNodeId: 42 })
  })

  it('maps a CDP missing-node error for a known ref to the stale message', async () => {
    const cdp = fakeCdp()
    cdp.onSend = (method) => {
      if (method === 'DOM.scrollIntoViewIfNeeded') throw new Error('Could not find node with given id')
    }
    const result = await click(cdp, new Map([['r1', 42]]), { ref: 'r1' })
    expect(errorOf(result)).toBe('snapshot stale: re-read the page (ref r1 no longer valid)')
  })

  it('maps the real Chromium detached-node error to the stale message', async () => {
    const cdp = fakeCdp()
    cdp.onSend = (method) => {
      if (method === 'DOM.scrollIntoViewIfNeeded') throw new Error('Node is detached from document')
    }
    const result = await click(cdp, new Map([['r1', 42]]), { ref: 'r1' })
    expect(errorOf(result)).toBe('snapshot stale: re-read the page (ref r1 no longer valid)')
  })

  it('reports an attached but invisible element as not visible, not stale', async () => {
    const cdp = fakeCdp()
    cdp.onSend = (method) => {
      if (method === 'DOM.getBoxModel') throw new Error('Could not compute box model.')
    }
    expect(errorOf(await click(cdp, new Map(), { selector: '#hidden' }))).toContain('not visible')
  })

  it('does not mask a missing-node error for a selector target', async () => {
    const cdp = fakeCdp()
    cdp.onSend = (method) => {
      if (method === 'DOM.scrollIntoViewIfNeeded') throw new Error('Could not find node with given id')
    }
    await expect(click(cdp, new Map(), { selector: '#btn' })).rejects.toThrow('Could not find node')
  })

  it('rejects a stale ref with the extension wording and touches nothing', async () => {
    const cdp = fakeCdp()
    const result = await click(cdp, new Map(), { ref: 'r9' })
    expect(errorOf(result)).toBe('snapshot stale: re-read the page (ref r9 no longer valid)')
    expect(cdp.calls).toEqual([])
  })

  it('treats a zero-size box model as not visible instead of clicking at 0,0', async () => {
    const cdp = fakeCdp()
    cdp.responses['DOM.getBoxModel'] = { model: { content: [0, 0, 0, 0, 0, 0, 0, 0], width: 0, height: 0 } }
    const result = await click(cdp, new Map(), { selector: '#btn' })
    expect(errorOf(result)).toContain('not visible')
    expect(cdp.calls.filter(c => c.method === 'Input.dispatchMouseEvent')).toEqual([])
  })

  it('reports a missing selector', async () => {
    const cdp = fakeCdp()
    cdp.responses['DOM.querySelector'] = { nodeId: 0 }
    expect(errorOf(await click(cdp, new Map(), { selector: '#nope' }))).toBe('selector not found: #nope')
  })

  it('uses x/y directly without resolving a node', async () => {
    const cdp = fakeCdp()
    const result = await click(cdp, new Map(), { x: 12, y: 34 })
    expect(result).toEqual({ ok: true, data: { x: 12, y: 34 } })
    expect(cdp.calls.map(c => c.method)).toEqual([
      'Input.dispatchMouseEvent', 'Input.dispatchMouseEvent', 'Input.dispatchMouseEvent'
    ])
    expect(paramsOf(cdp.calls[0])).toEqual({ type: 'mouseMoved', x: 12, y: 34 })
  })
})

describe('cdp type', () => {
  it('focuses, selects the content, inserts text and dispatches change', async () => {
    const cdp = fakeCdp()
    const result = await type(cdp, new Map(), { selector: '#q', text: 'hello' })
    expect(result).toEqual({ ok: true, data: { selector: '#q' } })
    expect(cdp.calls.map(c => c.method)).toEqual([
      'DOM.getDocument',
      'DOM.querySelector',
      'DOM.scrollIntoViewIfNeeded',
      'DOM.getBoxModel',
      'DOM.resolveNode',
      'Runtime.callFunctionOn',
      'Input.insertText',
      'Runtime.callFunctionOn'
    ])
    const focusSelect = paramsOf(cdp.calls[5])
    expect(focusSelect.objectId).toBe('obj-1')
    expect(String(focusSelect.functionDeclaration)).toContain('isContentEditable')
    expect(String(focusSelect.functionDeclaration)).toContain('.select()')
    expect(paramsOf(cdp.calls[6])).toEqual({ text: 'hello' })
    const change = paramsOf(cdp.calls[7])
    expect(String(change.functionDeclaration)).toContain("dispatchEvent(new Event('change'")
  })
})

describe('cdp target callback', () => {
  it('reports the click rect and label before dispatching input', async () => {
    const cdp = fakeCdp()
    const targets: Array<{ x: number; y: number; w: number; h: number; label: string } | null> = []
    let callsAtTarget = -1
    const result = await click(cdp, new Map([['r4', 42]]), { ref: 'r4' }, target => {
      callsAtTarget = cdp.calls.length
      targets.push(target)
    })
    expect(result).toEqual({ ok: true, data: { ref: 'r4' } })
    expect(targets).toEqual([{ x: 10, y: 20, w: 100, h: 50, label: 'r4' }])
    const firstInput = cdp.calls.findIndex(c => c.method === 'Input.dispatchMouseEvent')
    expect(callsAtTarget).toBe(firstInput)
  })

  it('reports the type rect and still types when the field has no box', async () => {
    const cdp = fakeCdp()
    const targets: Array<{ x: number; y: number; w: number; h: number; label: string } | null> = []
    expect((await type(cdp, new Map(), { selector: '#q', text: 'hi' }, t => targets.push(t))).ok).toBe(true)
    expect(targets).toEqual([{ x: 10, y: 20, w: 100, h: 50, label: 'Meow' }])

    cdp.responses['DOM.getBoxModel'] = { model: { content: [0, 0, 0, 0, 0, 0, 0, 0], width: 0, height: 0 } }
    targets.length = 0
    expect((await type(cdp, new Map(), { selector: '#q', text: 'hi' }, t => targets.push(t))).ok).toBe(true)
    expect(targets).toEqual([null])
    expect(cdp.calls.some(c => c.method === 'Input.insertText')).toBe(true)
  })
})

describe('cdp select', () => {
  it('sets the value and fires change on a ref target', async () => {
    const cdp = fakeCdp()
    const result = await select(cdp, new Map([['r2', 5]]), { ref: 'r2', value: 'b' })
    expect(result).toEqual({ ok: true, data: { ref: 'r2' } })
    expect(cdp.calls.map(c => c.method)).toEqual([
      'DOM.resolveNode',
      'Runtime.callFunctionOn',
      'Runtime.callFunctionOn'
    ])
    expect(paramsOf(cdp.calls[0])).toEqual({ backendNodeId: 5 })
    expect(String(paramsOf(cdp.calls[1]).functionDeclaration)).toContain('isConnected')
    const call = paramsOf(cdp.calls[2])
    expect(call.objectId).toBe('obj-1')
    expect(call.arguments).toEqual([{ value: 'b' }])
    expect(String(call.functionDeclaration)).toContain("new Event('change'")
  })

  it('reports a detached ref as stale before typing into it', async () => {
    const cdp = fakeCdp()
    cdp.responses['Runtime.callFunctionOn'] = { result: { value: false } }
    const result = await type(cdp, new Map([['r3', 7]]), { ref: 'r3', text: 'x' })
    expect(errorOf(result)).toBe('snapshot stale: re-read the page (ref r3 no longer valid)')
    expect(cdp.calls.some(c => c.method === 'Input.insertText')).toBe(false)
  })
})

describe('cdp scroll and waitFor', () => {
  it('scrolls by direction through Runtime.evaluate', async () => {
    const cdp = fakeCdp()
    expect(await scroll(cdp, new Map(), { direction: 'top' })).toEqual({ ok: true })
    expect(paramsOf(cdp.calls[0]).expression).toBe('window.scrollTo(0, 0)')
    await scroll(cdp, new Map(), { direction: 'bottom' })
    expect(String(paramsOf(cdp.calls[1]).expression)).toContain('scrollHeight')
  })

  it('scrolls a selector into view and reports a missing element', async () => {
    const cdp = fakeCdp()
    cdp.responses['Runtime.evaluate'] = { result: { value: true } }
    expect(await scroll(cdp, new Map(), { selector: '#a' })).toEqual({ ok: true })
    expect(String(paramsOf(cdp.calls[0]).expression)).toContain('scrollIntoView')
    cdp.responses['Runtime.evaluate'] = { result: { value: false } }
    expect(errorOf(await scroll(cdp, new Map(), { selector: '#b' }))).toBe('selector not found: #b')
  })

  it('waits for a selector with awaitPromise and reports a timeout', async () => {
    const cdp = fakeCdp()
    cdp.responses['Runtime.evaluate'] = { result: { value: true } }
    expect(await waitFor(cdp, new Map(), { selector: '#ready', timeoutMs: 2000 })).toEqual({
      ok: true, data: { selector: '#ready' }
    })
    expect(paramsOf(cdp.calls[0]).awaitPromise).toBe(true)
    cdp.responses['Runtime.evaluate'] = { result: { value: false } }
    expect(errorOf(await waitFor(cdp, new Map(), { selector: '#never' }))).toBe('timeout waiting for selector: #never')
  })
})

describe('cdp read', () => {
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'meow-cdp-read-'))
  })

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('stores refs and writes a snapshot file', async () => {
    const cdp = fakeCdp()
    cdp.responses['Runtime.evaluate'] = { result: { value: true } }
    cdp.responses['Page.getFrameTree'] = { frameTree: { frame: { id: 'F1' } } }
    cdp.responses['Accessibility.getFullAXTree'] = {
      nodes: [
        { nodeId: '1', role: { value: 'rootwebarea' }, childIds: ['2'] },
        { nodeId: '2', role: { value: 'button' }, name: { value: 'Go' }, backendDOMNodeId: 12 }
      ]
    }
    const refs = new Map<string, number>([['old', 1]])
    const result = await read(cdp, refs, { mode: 'interactive', snapshotDir: dir })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const data = result.data as { path: string; nodeCount: number; preview: string }
    expect(data.nodeCount).toBe(2)
    expect(data.preview).toContain('button "Go" [r1]')
    expect(readFileSync(data.path, 'utf-8').split('\n')[0]).toBe(SNAPSHOT_UNTRUSTED_NOTICE)
    expect(refs.get('r1')).toBe(12)
    expect(refs.has('old')).toBe(false)
  })
})
