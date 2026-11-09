import type { BrowserCommandResult, BrowserReadMode, SnapshotNode } from '../../shared/browser-types'
import { readInteractiveTree } from '../../shared/browser-ax-snapshot'
import type { CdpClient } from './browser-tab'
import { writeSnapshotFile } from './snapshot-output'

export const NAVIGATE_TIMEOUT_MS = 30_000

export interface TargetRect {
  x: number
  y: number
  w: number
  h: number
  label: string
}

/** Called before input is dispatched so the host can draw the shield ring. */
export type TargetCallback = (target: TargetRect | null) => void

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

export function staleRefError(ref: string): BrowserCommandResult {
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
    if (backendNodeId == null) return staleRefError(ref)
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
    if (ref && isMissingNode(err)) return staleRefError(ref)
    throw err
  }
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Bounding box of the `content` quad; a zero-size box is a real failure (a 0×0 viewport reports exactly this). */
async function boxOf(cdp: CdpClient, target: NodeTarget): Promise<Box | BrowserCommandResult> {
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
  const w = Math.max(...xs) - Math.min(...xs)
  const h = Math.max(...ys) - Math.min(...ys)
  if (w <= 0 || h <= 0) {
    return { ok: false, error: 'element is not visible (zero-size box)' }
  }
  return { x: Math.min(...xs), y: Math.min(...ys), w, h }
}

function labelOf(params: Record<string, unknown>): string {
  return params.ref != null ? String(params.ref) : 'Meow'
}

const SENSITIVE_TARGET = `function(){
  const el = this;
  if (!(el instanceof HTMLInputElement)) return null;
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (type === 'password') return 'password';
  const tokens = (el.getAttribute('autocomplete') || '').toLowerCase().split(/\\s+/).filter(Boolean);
  for (const token of tokens) {
    if (token === 'current-password' || token === 'new-password' || token === 'one-time-code' || token.startsWith('cc-')) {
      return 'payment';
    }
  }
  return null;
}`

/**
 * A password or payment field. `type` alone is not enough: a "show password" toggle
 * flips it to `text`, so the autocomplete tokens are checked too (token by token,
 * because `autocomplete` can be `section-a cc-number`).
 */
export async function isSensitiveTarget(cdp: CdpClient, target: NodeTarget): Promise<boolean> {
  try {
    const { object } = await cdp.send<{ object: { objectId: string } }>('DOM.resolveNode', { ...target })
    const res = await cdp.send<{ result?: { value?: unknown }; exceptionDetails?: { text?: string } }>('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: SENSITIVE_TARGET,
      returnByValue: true
    })
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text ?? 'unknown')
    return res.result?.value != null
  } catch (err) {
    // Fail closed: the caller refuses rather than typing into an unchecked field.
    throw new Error(`sensitive check failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export function sensitiveFieldError(name: 'type' | 'select'): BrowserCommandResult {
  return {
    ok: false,
    error: `browser_${name} refused: this is a sensitive field (password or payment). Call browser_handoff so the user can fill it.`
  }
}

async function clickPoint(
  cdp: CdpClient,
  target: NodeTarget
): Promise<{ x: number; y: number; box: Box } | BrowserCommandResult> {
  const box = await boxOf(cdp, target)
  if (isErrorResult(box)) return box
  return { x: box.x + box.w / 2, y: box.y + box.h / 2, box }
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
  if (connected !== true) return staleRefError(ref)
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

/** What the page calls an element, for the approval prompt. */
export interface RefLabel {
  role: string
  name: string
}

export async function read(
  cdp: CdpClient,
  refs: Map<string, number>,
  labels: Map<string, RefLabel>,
  params: ReadParams
): Promise<BrowserCommandResult> {
  const mode: BrowserReadMode = params.mode === 'full' ? 'full' : 'interactive'
  const { tree, refs: found } = await readInteractiveTree((method, p) => cdp.send(method, p), mode)
  refs.clear()
  for (const r of found) refs.set(r.ref, r.backendDOMNodeId)
  labels.clear()
  const walk = (nodes: SnapshotNode[]): void => {
    for (const node of nodes) {
      if (node.ref) labels.set(node.ref, { role: node.role, name: node.name ?? '' })
      if (node.children) walk(node.children)
    }
  }
  walk(tree)
  return writeSnapshotFile(params.snapshotDir, tree)
}

export async function click(
  cdp: CdpClient,
  refs: Map<string, number>,
  params: Record<string, unknown>,
  onTarget?: TargetCallback
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
    onTarget?.({ ...point.box, label: labelOf(params) })
    await pressAt(cdp, point.x, point.y)
    return { ok: true, data: ref != null ? { ref } : { selector: String(params.selector) } }
  })
}

export async function type(
  cdp: CdpClient,
  refs: Map<string, number>,
  params: Record<string, unknown>,
  onTarget?: TargetCallback
): Promise<BrowserCommandResult> {
  if (params.ref == null && params.selector == null) {
    return { ok: false, error: 'type requires ref or selector' }
  }
  return withTarget(cdp, refs, params, async (target, ref) => {
    await cdp.send('DOM.scrollIntoViewIfNeeded', { ...target })
    const box = await boxOf(cdp, target)
    // Drawing is decoration: a field without a box is still typed into.
    onTarget?.(isErrorResult(box) ? null : { ...box, label: labelOf(params) })
    const objectId = await resolveAttachedObject(cdp, target, ref)
    if (isErrorResult(objectId)) return objectId
    if (await isSensitiveTarget(cdp, target)) return sensitiveFieldError('type')
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
    if (await isSensitiveTarget(cdp, target)) return sensitiveFieldError('select')
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
