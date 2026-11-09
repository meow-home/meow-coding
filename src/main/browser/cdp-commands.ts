import type { BrowserCommandResult, BrowserReadMode } from '../../shared/browser-types'
import { readInteractiveTree } from '../../shared/browser-ax-snapshot'
import type { CdpClient } from './browser-tab'
import { writeSnapshotFile } from './snapshot-output'

export const NAVIGATE_TIMEOUT_MS = 30_000

// DOM.scrollIntoViewIfNeeded / DOM.getBoxModel / DOM.resolveNode accept either key.
// A ref keeps the backend id from the snapshot: frontend nodeIds only exist after a
// DOM.getDocument and are invalidated by the next one.
interface NodeTarget {
  nodeId?: number
  backendNodeId?: number
}

interface BoxModel {
  model: { content: number[]; width?: number; height?: number }
}

function stale(ref: string): BrowserCommandResult {
  return { ok: false, error: `snapshot stale: re-read the page (ref ${ref} no longer valid)` }
}

// Chromium says "Node is detached from document" for a removed backend node and
// "Could not find node with given id" for other stale ids.
const MISSING_NODE = /node is detached|could not find node|no node with given id|node with given id|cannot find node|node not found/i

function isMissingNode(err: unknown): boolean {
  return MISSING_NODE.test(err instanceof Error ? err.message : String(err))
}

/** Ref → backendNodeId, or a selector → frontend nodeId. Returns the error result when it cannot resolve. */
async function resolveNode(
  cdp: CdpClient,
  refs: Map<string, number>,
  params: Record<string, unknown>
): Promise<NodeTarget | BrowserCommandResult> {
  if (params.ref != null) {
    const ref = String(params.ref)
    const backendNodeId = refs.get(ref)
    if (backendNodeId == null) return stale(ref)
    return { backendNodeId }
  }
  const selector = params.selector != null ? String(params.selector) : null
  if (!selector) return { ok: false, error: 'ref or selector required' }
  const doc = await cdp.send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: 0 })
  const found = await cdp.send<{ nodeId: number }>('DOM.querySelector', { nodeId: doc.root.nodeId, selector })
  if (!found.nodeId) return { ok: false, error: `selector not found: ${selector}` }
  return { nodeId: found.nodeId }
}

function isErrorResult(value: unknown): value is BrowserCommandResult {
  return typeof value === 'object' && value !== null && 'ok' in value
}

async function withTarget(
  cdp: CdpClient,
  refs: Map<string, number>,
  params: Record<string, unknown>,
  action: (target: NodeTarget, ref: string | null) => Promise<BrowserCommandResult>
): Promise<BrowserCommandResult> {
  const target = await resolveNode(cdp, refs, params)
  if (isErrorResult(target)) return target
  const ref = params.ref != null ? String(params.ref) : null
  try {
    return await action(target, ref)
  } catch (err) {
    // The node was removed or replaced since the snapshot: answer like an unknown ref,
    // not with the raw CDP "could not find node" text.
    if (ref && isMissingNode(err)) return stale(ref)
    throw err
  }
}

/** Centre of the `content` quad; a zero-size box is a real failure (a 0×0 viewport reports exactly this). */
async function clickPoint(cdp: CdpClient, target: NodeTarget): Promise<{ x: number; y: number } | BrowserCommandResult> {
  let model: BoxModel['model']
  try {
    ({ model } = await cdp.send<BoxModel>('DOM.getBoxModel', { ...target }))
  } catch (err) {
    // An attached but hidden element (display:none) has no box; a detached ref is
    // caught earlier by scrollIntoViewIfNeeded and mapped to the stale error.
    if (/could not compute box model/i.test(err instanceof Error ? err.message : String(err))) {
      return { ok: false, error: 'element is not visible (no box model)' }
    }
    throw err
  }
  const q = model?.content
  if (!q || q.length < 8 || q.some(v => !Number.isFinite(v))) {
    return { ok: false, error: 'element is not visible (no box model)' }
  }
  const xs = [q[0], q[2], q[4], q[6]]
  const ys = [q[1], q[3], q[5], q[7]]
  const width = Math.max(...xs) - Math.min(...xs)
  const height = Math.max(...ys) - Math.min(...ys)
  if (width <= 0 || height <= 0) {
    return { ok: false, error: 'element is not visible (zero-size box)' }
  }
  return { x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4 }
}

async function pressAt(cdp: CdpClient, x: number, y: number): Promise<void> {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

async function resolveObject(cdp: CdpClient, target: NodeTarget): Promise<string> {
  const { object } = await cdp.send<{ object: { objectId: string } }>('DOM.resolveNode', { ...target })
  return object.objectId
}

/**
 * `DOM.resolveNode` succeeds even for a detached node, so a ref target is checked
 * for attachment before typing or selecting into it.
 */
async function resolveAttachedObject(
  cdp: CdpClient,
  target: NodeTarget,
  ref: string | null
): Promise<string | BrowserCommandResult> {
  const objectId = await resolveObject(cdp, target)
  if (ref == null) return objectId
  const connected = await callOnObject(cdp, objectId, 'function(){ return this.isConnected === true }')
  if (connected !== true) return stale(ref)
  return objectId
}

async function callOnObject(
  cdp: CdpClient,
  objectId: string,
  functionDeclaration: string,
  args: unknown[] = []
): Promise<unknown> {
  const res = await cdp.send<{ result?: { value?: unknown }; exceptionDetails?: { text?: string } }>('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration,
    arguments: args.map(value => ({ value })),
    returnByValue: true
  })
  if (res.exceptionDetails) throw new Error(`call failed: ${res.exceptionDetails.text ?? 'unknown'}`)
  return res.result?.value
}

/** Focus the element and select its whole content without a platform-specific key combo. */
const FOCUS_AND_SELECT = `function(){
  const el = this;
  if (typeof el.focus === 'function') el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) { el.select(); return true; }
  if (el.isContentEditable) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    return true;
  }
  return false;
}`

const DISPATCH_CHANGE = `function(){
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}`

const SET_VALUE_AND_CHANGE = `function(value){
  this.value = value;
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}`

export interface ReadParams extends Record<string, unknown> {
  mode?: BrowserReadMode
  /** Where the snapshot file goes; supplied by the tab, not by the model. */
  snapshotDir: string
}

export async function read(
  cdp: CdpClient,
  refs: Map<string, number>,
  params: ReadParams
): Promise<BrowserCommandResult> {
  const mode: BrowserReadMode = params.mode === 'full' ? 'full' : 'interactive'
  const { tree, refs: found } = await readInteractiveTree((method, p) => cdp.send(method, p), mode)
  refs.clear()
  for (const r of found) refs.set(r.ref, r.backendDOMNodeId)
  return writeSnapshotFile(params.snapshotDir, tree)
}

export async function click(
  cdp: CdpClient,
  refs: Map<string, number>,
  params: Record<string, unknown>
): Promise<BrowserCommandResult> {
  if (params.ref == null && params.selector == null) {
    const x = Number(params.x)
    const y = Number(params.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, error: 'click requires ref, selector or x/y' }
    }
    await pressAt(cdp, x, y)
    return { ok: true, data: { x, y } }
  }
  return withTarget(cdp, refs, params, async (target, ref) => {
    await cdp.send('DOM.scrollIntoViewIfNeeded', { ...target })
    const point = await clickPoint(cdp, target)
    if (isErrorResult(point)) return point
    await pressAt(cdp, point.x, point.y)
    return { ok: true, data: ref != null ? { ref } : { selector: String(params.selector) } }
  })
}

export async function type(
  cdp: CdpClient,
  refs: Map<string, number>,
  params: Record<string, unknown>
): Promise<BrowserCommandResult> {
  if (params.ref == null && params.selector == null) {
    return { ok: false, error: 'type requires ref or selector' }
  }
  return withTarget(cdp, refs, params, async (target, ref) => {
    const objectId = await resolveAttachedObject(cdp, target, ref)
    if (isErrorResult(objectId)) return objectId
    await callOnObject(cdp, objectId, FOCUS_AND_SELECT)
    await cdp.send('Input.insertText', { text: String(params.text ?? '') })
    await callOnObject(cdp, objectId, DISPATCH_CHANGE)
    return { ok: true, data: ref != null ? { ref } : { selector: String(params.selector) } }
  })
}

export async function select(
  cdp: CdpClient,
  refs: Map<string, number>,
  params: Record<string, unknown>
): Promise<BrowserCommandResult> {
  if (params.ref == null && params.selector == null) {
    return { ok: false, error: 'select requires ref or selector' }
  }
  return withTarget(cdp, refs, params, async (target, ref) => {
    const objectId = await resolveAttachedObject(cdp, target, ref)
    if (isErrorResult(objectId)) return objectId
    await callOnObject(cdp, objectId, SET_VALUE_AND_CHANGE, [String(params.value ?? '')])
    return { ok: true, data: ref != null ? { ref } : { selector: String(params.selector) } }
  })
}

export async function scroll(
  cdp: CdpClient,
  _refs: Map<string, number>,
  params: Record<string, unknown>
): Promise<BrowserCommandResult> {
  if (params.selector != null) {
    const selector = String(params.selector)
    const expression = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      return true;
    })()`
    const res = await cdp.send<{ result?: { value?: unknown } }>('Runtime.evaluate', { expression, returnByValue: true })
    if (!res.result?.value) return { ok: false, error: `selector not found: ${selector}` }
    return { ok: true }
  }
  const direction = String(params.direction ?? 'down')
  const expression = direction === 'top'
    ? 'window.scrollTo(0, 0)'
    : direction === 'bottom'
      ? 'window.scrollTo(0, document.body.scrollHeight)'
      : direction === 'up'
        ? 'window.scrollBy(0, -window.innerHeight * 0.8)'
        : 'window.scrollBy(0, window.innerHeight * 0.8)'
  await cdp.send('Runtime.evaluate', { expression, returnByValue: true })
  return { ok: true }
}

export async function waitFor(
  cdp: CdpClient,
  _refs: Map<string, number>,
  params: Record<string, unknown>
): Promise<BrowserCommandResult> {
  const selector = String(params.selector ?? '')
  if (!selector) return { ok: false, error: 'waitFor requires selector' }
  const timeoutMs = Number(params.timeoutMs ?? 10_000)
  const expression = `new Promise((resolve) => {
    const deadline = Date.now() + ${Number.isFinite(timeoutMs) ? timeoutMs : 10_000};
    const check = () => {
      if (document.querySelector(${JSON.stringify(selector)})) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(check, 200);
    };
    check();
  })`
  const res = await cdp.send<{ result?: { value?: unknown } }>('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (!res.result?.value) return { ok: false, error: `timeout waiting for selector: ${selector}` }
  return { ok: true, data: { selector } }
}
