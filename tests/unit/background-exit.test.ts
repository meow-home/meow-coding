import { describe, expect, it, vi } from 'vitest'
import { handleBackgroundExit, backgroundExitMessage } from '../../src/main/agent/background-exit'
import type { BgExitInfo } from '../../src/main/agent/background-process-store'

const info: BgExitInfo = { id: 'abc12345', agentId: 'a1', sessionId: 's9', command: 'npm run build', exitCode: 0 }

describe('handleBackgroundExit', () => {
  it('builds a message that names the id and command', () => {
    const msg = backgroundExitMessage(info)
    expect(msg).toContain('abc12345')
    expect(msg).toContain('npm run build')
    expect(msg).toContain('bash_output')
  })

  it('appends to the originating session and notifies', () => {
    const appendMessage = vi.fn()
    const notify = vi.fn()
    handleBackgroundExit(info, { appendMessage, notify, isRunning: () => true, wake: vi.fn() })
    expect(appendMessage).toHaveBeenCalledWith('s9', expect.stringContaining('abc12345'))
    expect(notify).toHaveBeenCalledWith(info)
  })

  it('wakes the agent only when idle', () => {
    const wakeIdle = vi.fn()
    handleBackgroundExit(info, { appendMessage: vi.fn(), isRunning: () => false, wake: wakeIdle })
    expect(wakeIdle).toHaveBeenCalledTimes(1)

    const wakeBusy = vi.fn()
    handleBackgroundExit(info, { appendMessage: vi.fn(), isRunning: () => true, wake: wakeBusy })
    expect(wakeBusy).not.toHaveBeenCalled()
  })
})
