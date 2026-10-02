import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'
import { BrowserBridge } from '../../../src/main/browser/bridge'
import type { BridgeToExtension } from '../../../src/shared/browser-types'
import { TrustedExtensionStore } from '../../../src/main/browser/trusted-store'

const bridges: BrowserBridge[] = []
const dirs: string[] = []

function newBridge(deps: Record<string, unknown> = {}): BrowserBridge {
  const b = new BrowserBridge({ preferredPort: 0, ...deps })
  bridges.push(b)
  return b
}

function tmpDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'meow-bridge-'))
  dirs.push(d)
  return d
}

afterEach(async () => {
  for (const b of bridges.splice(0)) await b.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function nextMsg(ws: WebSocket): Promise<BridgeToExtension> {
  return new Promise(resolve => ws.once('message', raw => resolve(JSON.parse(String(raw)) as BridgeToExtension)))
}

describe('BrowserBridge', () => {
  it('starts on an ephemeral port and reports it via /api/status', async () => {
    const b = newBridge()
    const port = await b.start()
    expect(port).toBeGreaterThan(0)
    expect(b.getStatus().port).toBe(port)

    const res = await fetch(`http://127.0.0.1:${port}/api/status`)
    expect(res.ok).toBe(true)
    const body = await res.json() as { port: number; status: string }
    expect(body.port).toBe(port)
  })

  it('pairs with the correct code and rejects a wrong one', async () => {
    const b = newBridge()
    const port = await b.start()
    const ws = await connect(port)

    const { code } = b.pair()
    ws.send(JSON.stringify({ type: 'pair', code: '000000' }))
    const bad = await nextMsg(ws)
    expect(bad).toMatchObject({ type: 'pair_result', ok: false })

    ws.send(JSON.stringify({ type: 'pair', code }))
    const good = await nextMsg(ws)
    expect(good).toMatchObject({ type: 'pair_result', ok: true })
    expect(b.getStatus().status).toBe('paired')
    expect(b.getStatus().paired).toBe(true)
  })

  it('rejects execute when not paired', async () => {
    const b = newBridge()
    await b.start()
    const r = await b.execute('listTabs')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('not connected')
  })

  it('routes a command to the extension and resolves the result', async () => {
    const b = newBridge()
    const port = await b.start()
    const ws = await connect(port)
    const { code } = b.pair()
    ws.send(JSON.stringify({ type: 'pair', code }))
    await nextMsg(ws)

    const done = b.execute('listTabs')
    const cmd = await nextMsg(ws) as Extract<BridgeToExtension, { type: 'cmd' }>
    expect(cmd).toMatchObject({ type: 'cmd', name: 'listTabs' })

    ws.send(JSON.stringify({ type: 'result', id: cmd.id, ok: true, data: { tabs: [{ id: 1 }] } }))
    const r = await done
    expect(r).toEqual({ ok: true, data: { tabs: [{ id: 1 }] } })
  })

  it('times out when the extension never replies', async () => {
    const b = newBridge()
    const port = await b.start()
    const ws = await connect(port)
    const { code } = b.pair()
    ws.send(JSON.stringify({ type: 'pair', code }))
    await nextMsg(ws)

    const done = b.execute('read', undefined, 100)
    await nextMsg(ws) // consume cmd, don't reply
    const r = await done
    expect(r.ok).toBe(false)
    expect(r.error).toContain('timed out')
  })

  it('buffers console and network events in ring buffers', async () => {
    const b = newBridge()
    const port = await b.start()
    const ws = await connect(port)
    const { code } = b.pair()
    ws.send(JSON.stringify({ type: 'pair', code }))
    await nextMsg(ws)

    for (let i = 0; i < 5; i++) {
      ws.send(JSON.stringify({ type: 'event', name: 'console', data: { level: 'log', text: `msg ${i}` } }))
      ws.send(JSON.stringify({ type: 'event', name: 'network', data: { method: 'GET', url: `u${i}` } }))
    }
    await new Promise(r => setTimeout(r, 50))

    expect(b.getConsoleLogs(3)).toHaveLength(3)
    expect(b.getConsoleLogs(3)[2]).toMatchObject({ text: 'msg 4' })
    expect(b.getNetworkLogs()).toHaveLength(5)
  })

  it('saves screenshots to the screenshot dir and returns the path', async () => {
    const dir = tmpDir()
    const b = newBridge({ screenshotDir: dir })
    const port = await b.start()
    const ws = await connect(port)
    const { code } = b.pair()
    ws.send(JSON.stringify({ type: 'pair', code }))
    await nextMsg(ws)

    const done = b.execute('screenshot')
    const cmd = await nextMsg(ws) as Extract<BridgeToExtension, { type: 'cmd' }>
    ws.send(JSON.stringify({ type: 'result', id: cmd.id, ok: true, data: { base64: Buffer.from('pngdata').toString('base64') } }))
    const r = await done
    expect(r.ok).toBe(true)
    const data = r.data as { path: string }
    expect(data.path).toMatch(/\.png$/)
    expect(data.path.startsWith(dir)).toBe(true)
  })

  it('waitForPaired resolves once paired and rejects on timeout', async () => {
    const b = newBridge()
    const port = await b.start()
    const ws = await connect(port)

    const waiter = b.waitForPaired(2000)
    const { code } = b.pair()
    ws.send(JSON.stringify({ type: 'pair', code }))
    await nextMsg(ws)
    expect(await waiter).toBe(true)

    const b2 = newBridge()
    await b2.start()
    expect(await b2.waitForPaired(100)).toBe(false)
  })

  it('re-accepts a previously-paired extension after the code TTL has passed', async () => {
    const b = newBridge({ codeTtlMs: 50 })
    const port = await b.start()
    const { code } = b.pair()
    const ws1 = await connect(port)
    ws1.send(JSON.stringify({ type: 'pair', code }))
    expect(await nextMsg(ws1)).toMatchObject({ type: 'pair_result', ok: true })
    ws1.close()
    await new Promise(r => setTimeout(r, 80))
    const ws2 = await connect(port)
    ws2.send(JSON.stringify({ type: 'pair', code }))
    expect(await nextMsg(ws2)).toMatchObject({ type: 'pair_result', ok: true })
    expect(b.getStatus().paired).toBe(true)
  })

  it('requires the pairing code again after a new code is issued', async () => {
    const b = newBridge({ codeTtlMs: 50 })
    const port = await b.start()
    const { code } = b.pair()
    const ws1 = await connect(port)
    ws1.send(JSON.stringify({ type: 'pair', code }))
    expect(await nextMsg(ws1)).toMatchObject({ type: 'pair_result', ok: true })
    const { code: newCode } = b.pair()
    expect(newCode).not.toBe(code)
    ws1.send(JSON.stringify({ type: 'pair', code }))
    expect(await nextMsg(ws1)).toMatchObject({ type: 'pair_result', ok: false })
  })

  it('replies pong to a heartbeat ping from the extension', async () => {
    const b = newBridge()
    const port = await b.start()
    const ws = await connect(port)

    ws.send(JSON.stringify({ type: 'ping' }))
    expect(await nextMsg(ws)).toMatchObject({ type: 'pong' })
  })

  it('notifies status listeners on pair', async () => {
    const b = newBridge()
    const port = await b.start()
    const seen: string[] = []
    const off = b.onStatusChange(info => seen.push(info.status))
    const ws = await connect(port)
    const { code } = b.pair()
    ws.send(JSON.stringify({ type: 'pair', code }))
    await nextMsg(ws)
    expect(seen).toContain('paired')
    off()
  })
})

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop'
const EXT_ORIGIN = `chrome-extension://${EXT_ID}`

function connectWithOrigin(port: number, origin: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin })
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function hello(ws: WebSocket, extensionId = EXT_ID, version = '0.3.4'): void {
  ws.send(JSON.stringify({ type: 'hello', extensionId, version }))
}

function closed(ws: WebSocket): Promise<void> {
  return new Promise(resolve => ws.once('close', () => resolve()))
}

describe('BrowserBridge extension approval', () => {
  it('pairs silently when the extension id is already trusted', async () => {
    const trusted = new TrustedExtensionStore()
    trusted.approve(EXT_ID, '0.3.4')
    const b = newBridge({ trusted })
    const port = await b.start()

    const ws = await connectWithOrigin(port, EXT_ORIGIN)
    hello(ws)
    expect(await nextMsg(ws)).toMatchObject({ type: 'hello_result', ok: true, paired: true })
    expect(b.getStatus().status).toBe('paired')
    expect(b.getStatus().pendingExtension).toBeUndefined()
    ws.close()
  })

  it('asks for approval when the extension id is unknown', async () => {
    const b = newBridge({ trusted: new TrustedExtensionStore() })
    const port = await b.start()

    const ws = await connectWithOrigin(port, EXT_ORIGIN)
    hello(ws)
    expect(await nextMsg(ws)).toMatchObject({ type: 'hello_result', ok: true, paired: false, pending: true })
    const status = b.getStatus()
    expect(status.status).toBe('pending')
    expect(status.paired).toBe(false)
    expect(status.pendingExtension).toMatchObject({ extensionId: EXT_ID, version: '0.3.4' })
    ws.close()
  })

  it('rejects a hello whose origin does not match the claimed id', async () => {
    const trusted = new TrustedExtensionStore()
    trusted.approve(EXT_ID, '0.3.4')
    const b = newBridge({ trusted })
    const port = await b.start()

    const ws = await connectWithOrigin(port, 'https://evil.example')
    hello(ws)
    expect(await nextMsg(ws)).toMatchObject({ type: 'hello_result', ok: false })
    await closed(ws)
    expect(b.getStatus().paired).toBe(false)
    expect(b.getStatus().status).toBe('listening')
  })

  it('approveExtension pairs the pending socket and persists the id', async () => {
    const trusted = new TrustedExtensionStore()
    const b = newBridge({ trusted })
    const port = await b.start()

    const ws = await connectWithOrigin(port, EXT_ORIGIN)
    hello(ws)
    await nextMsg(ws)

    const info = b.approveExtension(EXT_ID)
    expect(await nextMsg(ws)).toMatchObject({ type: 'hello_result', ok: true, paired: true })
    expect(info.status).toBe('paired')
    expect(info.pendingExtension).toBeUndefined()
    expect(trusted.has(EXT_ID)).toBe(true)
    ws.close()
  })

  it('approveExtension with a different id is a no-op', async () => {
    const trusted = new TrustedExtensionStore()
    const b = newBridge({ trusted })
    const port = await b.start()

    const ws = await connectWithOrigin(port, EXT_ORIGIN)
    hello(ws)
    await nextMsg(ws)

    const info = b.approveExtension('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')
    expect(info.status).toBe('pending')
    expect(trusted.has('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')).toBe(false)
    expect(trusted.has(EXT_ID)).toBe(false)
    ws.close()
  })

  it('denyExtension closes the pending socket and clears the approval', async () => {
    const trusted = new TrustedExtensionStore()
    const b = newBridge({ trusted })
    const port = await b.start()

    const ws = await connectWithOrigin(port, EXT_ORIGIN)
    hello(ws)
    await nextMsg(ws)

    const info = b.denyExtension(EXT_ID)
    await closed(ws)
    expect(info.status).toBe('listening')
    expect(info.pendingExtension).toBeUndefined()
    expect(trusted.has(EXT_ID)).toBe(false)
  })

  it('revokeExtension disconnects the paired extension', async () => {
    const trusted = new TrustedExtensionStore()
    trusted.approve(EXT_ID)
    const b = newBridge({ trusted })
    const port = await b.start()

    const ws = await connectWithOrigin(port, EXT_ORIGIN)
    hello(ws)
    await nextMsg(ws)
    expect(b.getStatus().paired).toBe(true)

    const info = b.revokeExtension(EXT_ID)
    await closed(ws)
    expect(info.status).toBe('listening')
    expect(info.paired).toBe(false)
    expect(trusted.has(EXT_ID)).toBe(false)
  })

  it('drops a pending approval after the ttl', async () => {
    const b = newBridge({ trusted: new TrustedExtensionStore(), pendingTtlMs: 50 })
    const port = await b.start()

    const ws = await connectWithOrigin(port, EXT_ORIGIN)
    hello(ws)
    await nextMsg(ws)
    await closed(ws)

    expect(b.getStatus().status).toBe('listening')
    expect(b.getStatus().pendingExtension).toBeUndefined()
  })

  it('replaces the pending extension when a second unknown one connects', async () => {
    const trusted = new TrustedExtensionStore()
    const b = newBridge({ trusted })
    const port = await b.start()

    const first = await connectWithOrigin(port, EXT_ORIGIN)
    hello(first)
    await nextMsg(first)

    const secondId = 'ponmlkjihgfedcbaponmlkjihgfedcba'
    const second = await connectWithOrigin(port, `chrome-extension://${secondId}`)
    hello(second, secondId)
    await nextMsg(second)

    await closed(first)
    expect(b.getStatus().pendingExtension?.extensionId).toBe(secondId)

    b.approveExtension(secondId)
    expect(await nextMsg(second)).toMatchObject({ type: 'hello_result', ok: true, paired: true })
    expect(b.getStatus().paired).toBe(true)
    second.close()
  })

  it('re-pairs silently after a reconnect once trusted', async () => {
    const trusted = new TrustedExtensionStore()
    trusted.approve(EXT_ID)
    const b = newBridge({ trusted })
    const port = await b.start()

    const first = await connectWithOrigin(port, EXT_ORIGIN)
    hello(first)
    await nextMsg(first)
    first.close()
    await new Promise(r => setTimeout(r, 50))

    const second = await connectWithOrigin(port, EXT_ORIGIN)
    hello(second)
    expect(await nextMsg(second)).toMatchObject({ type: 'hello_result', ok: true, paired: true })
    expect(b.getStatus().paired).toBe(true)
    second.close()
  })

  it('notifies status listeners with the pending extension', async () => {
    const b = newBridge({ trusted: new TrustedExtensionStore() })
    const port = await b.start()
    const seen: { status: string; pending?: string }[] = []
    const off = b.onStatusChange(info => seen.push({ status: info.status, pending: info.pendingExtension?.extensionId }))

    const ws = await connectWithOrigin(port, EXT_ORIGIN)
    hello(ws)
    await nextMsg(ws)

    expect(seen).toContainEqual({ status: 'pending', pending: EXT_ID })
    off()
    ws.close()
  })
})
