import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type {
  CliAgent,
  CliRuntimeId,
  CliSessionStatus,
  CliTranscriptItem
} from '../../src/shared/types'
import { CliAgentsManager, type CliAgentsManagerOptions } from '../../src/main/cli-agents'
import type { VaultLike } from '../../src/main/cli-agents/profiles'
import type { CliRunManager, RunTaskInput } from '../../src/main/cli-agents/run-manager'
import type { CliTerminalResult } from '../../src/main/cli-agents/parsers/types'

class MemoryVault implements VaultLike {
  private secrets = new Map<string, string>()

  saveSecret(ref: string, secret: string): void {
    this.secrets.set(ref, secret)
  }

  saveSecretObject(ref: string, secret: unknown): void {
    this.secrets.set(ref, JSON.stringify(secret))
  }

  getSecret(ref: string): string | null {
    return this.secrets.get(ref) ?? null
  }

  getSecretObject<T>(ref: string): T | null {
    const raw = this.secrets.get(ref)
    if (!raw) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }

  hasSecret(ref: string): boolean {
    return this.secrets.has(ref)
  }

  deleteSecret(ref: string): void {
    this.secrets.delete(ref)
  }
}

describe('CliAgentsManager', () => {
  let tmpDir = ''
  let vault: MemoryVault
  let fakeRunTask: ReturnType<typeof vi.fn>
  let fakeCancel: ReturnType<typeof vi.fn>
  let fakeCancelAll: ReturnType<typeof vi.fn>
  let fakeRunManager: CliRunManager
  let fakeCommandRunner: ReturnType<typeof vi.fn>
  let events: { sessionId: string; item: CliTranscriptItem }[]
  let statuses: { sessionId: string; status: CliSessionStatus }[]
  let agentsChangedCalls: number
  let sessionsChangedCalls: number
  let nowTime = 1000

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'meow-cli-manager-test-'))
    vault = new MemoryVault()
    nowTime = 1000

    fakeRunTask = vi.fn().mockImplementation(async (input: RunTaskInput): Promise<CliTerminalResult> => {
      return {
        status: 'completed',
        text: 'Task finished successfully'
      }
    })
    fakeCancel = vi.fn().mockReturnValue(true)
    fakeCancelAll = vi.fn().mockResolvedValue(undefined)

    fakeRunManager = {
      runTask: fakeRunTask,
      cancel: fakeCancel,
      cancelAll: fakeCancelAll
    } as unknown as CliRunManager

    fakeCommandRunner = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0
    })

    events = []
    statuses = []
    agentsChangedCalls = 0
    sessionsChangedCalls = 0
  })

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      try {
        rmSync(tmpDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })

  function createManager(extraOpts: Partial<CliAgentsManagerOptions> = {}): CliAgentsManager {
    return new CliAgentsManager({
      userDataDir: tmpDir,
      vault,
      runManager: fakeRunManager,
      runCommand: fakeCommandRunner,
      now: () => nowTime,
      onEvent: (sessionId, item) => events.push({ sessionId, item }),
      onStatus: (sessionId, status) => statuses.push({ sessionId, status }),
      onAgentsChanged: () => { agentsChangedCalls++ },
      onSessionsChanged: () => { sessionsChangedCalls++ },
      ...extraOpts
    })
  }

  function createFakeBinary(name: string): string {
    const binPath = path.join(tmpDir, name)
    writeFileSync(binPath, '#!/bin/sh\necho "1.5.0"')
    return binPath
  }

  it('addAgent handles secret storage, profile directory creation, and default agent', () => {
    const manager = createManager()

    // Gemini-key without secret throws
    expect(() => {
      manager.addAgent({
        runtime: 'antigravity',
        kind: 'gemini-key',
        label: 'Antigravity Gemini'
      })
    }).toThrow(/Secret is required/)

    // Valid gemini-key agent
    const agyAgent = manager.addAgent({
      runtime: 'antigravity',
      kind: 'gemini-key',
      label: 'Antigravity Gemini',
      secret: 'secret-gemini-key-123'
    })

    expect(agyAgent.id.startsWith('agy_')).toBe(true)
    expect(agyAgent.status).toBe('ready')
    expect(vault.getSecret(`cli:agent:${agyAgent.id}`)).toBe('secret-gemini-key-123')
    expect(agentsChangedCalls).toBe(1)

    // First agent becomes default
    expect(manager.getStatus().defaultAgentId).toBe(agyAgent.id)

    // OpenCode profile agent
    const ocAgent = manager.addAgent({
      runtime: 'opencode',
      kind: 'profile',
      label: 'OpenCode Anthropic',
      provider: 'anthropic'
    })

    expect(ocAgent.id.startsWith('oc_')).toBe(true)
    expect(ocAgent.status).toBe('needs-login')
    expect(ocAgent.profileDir).toBe(path.posix.join('cli-profiles', 'opencode', ocAgent.id))
    expect(existsSync(path.join(tmpDir, 'cli-profiles', 'opencode', ocAgent.id))).toBe(true)

    // Second agent does not change defaultAgentId
    expect(manager.getStatus().defaultAgentId).toBe(agyAgent.id)
  })

  it('renames, activates, sets default, and removes agents', async () => {
    const manager = createManager()

    const agent = manager.addAgent({
      runtime: 'antigravity',
      kind: 'gemini-key',
      label: 'Old Label',
      secret: 'key'
    })

    const renamed = manager.renameAgent(agent.id, 'New Label')
    expect(renamed.label).toBe('New Label')
    expect(manager.agentStore.getAgent(agent.id)?.label).toBe('New Label')

    manager.setDefaultAgent(agent.id)
    expect(manager.getStatus().defaultAgentId).toBe(agent.id)

    manager.activateAgent(agent.id)

    await manager.removeAgent(agent.id)
    expect(manager.agentStore.getAgent(agent.id)).toBeNull()
    expect(vault.hasSecret(`cli:agent:${agent.id}`)).toBe(false)
  })

  it('listModels parses lines, deduplicates slugs, and ignores headers and errors', async () => {
    const binPath = createFakeBinary('fake-agy.cmd')
    const manager = createManager()
    manager.agentStore.setRuntimePath('antigravity', binPath)

    fakeCommandRunner.mockResolvedValueOnce({
      stdout: [
        'Fetching models from remote...',
        '---------------------------------------',
        'MODEL ID             DISPLAY NAME',
        'gemini-3.8-flash     Gemini 3.8 Flash (High)',
        'claude-sonnet-4-6    Claude 3.7 Sonnet',
        'gemini-3.8-flash     Gemini 3.8 Flash (High)',
        'gpt-oss-120b         GPT-OSS 120B'
      ].join('\n'),
      stderr: '',
      exitCode: 0
    })

    const models = await manager.listModels('antigravity')
    expect(models).toEqual(['gemini-3.8-flash', 'claude-sonnet-4-6', 'gpt-oss-120b'])

    // When command runner throws, never throws; returns []
    fakeCommandRunner.mockRejectedValueOnce(new Error('Process error'))
    const emptyModels = await manager.listModels('antigravity')
    expect(emptyModels).toEqual([])
  })

  it('creates, renames, lists, and deletes sessions', async () => {
    const manager = createManager()
    const agent = manager.addAgent({
      runtime: 'antigravity',
      kind: 'gemini-key',
      label: 'Agent 1',
      secret: 'key'
    })

    const session = manager.createSession(agent.id, '/workspace/project-1')
    expect(session.id.startsWith('clis_')).toBe(true)
    expect(session.title).toBe('New session')
    expect(session.status).toBe('idle')
    expect(sessionsChangedCalls).toBe(1)

    const renamed = manager.renameSession(session.id, 'My Custom Session')
    expect(renamed.title).toBe('My Custom Session')

    const list = manager.listSessions('/workspace/project-1')
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(session.id)

    await manager.deleteSession(session.id)
    expect(manager.listSessions()).toHaveLength(0)
    expect(fakeCancel).toHaveBeenCalledWith(session.id)
  })

  it('throws a clear [meow] error when sending a task to an agent that is not ready', async () => {
    const manager = createManager()
    const agent = manager.addAgent({
      runtime: 'opencode',
      kind: 'profile',
      label: 'OpenCode Unauthed'
    })
    expect(agent.status).toBe('needs-login')

    const session = manager.createSession(agent.id, '/proj')

    await expect(manager.sendTask(session.id, 'Do work')).rejects.toThrow(
      /\[meow\] Agent "OpenCode Unauthed" \(.*\) is not ready \(status: needs-login\)/
    )
  })

  it('sendTask executes task, derives policy, updates title on first task, and appends items', async () => {
    const binPath = createFakeBinary('agy.cmd')
    const manager = createManager()
    manager.agentStore.setRuntimePath('antigravity', binPath)

    const agent = manager.addAgent({
      runtime: 'antigravity',
      kind: 'gemini-key',
      label: 'Antigravity Ready',
      secret: 'gemini-secret-xyz'
    })

    const session = manager.createSession(agent.id, '/my/project')
    expect(session.title).toBe('New session')

    const taskText = 'Fix bug in tokenizer and optimize performance for large buffers'
    const result = await manager.sendTask(session.id, taskText)

    expect(result.status).toBe('completed')
    expect(fakeRunTask).toHaveBeenCalledTimes(1)

    // Verify RunTaskInput
    const runInput: RunTaskInput = fakeRunTask.mock.calls[0][0]
    expect(runInput.sessionId).toBe(session.id)
    expect(runInput.task).toBe(taskText)
    expect(runInput.cwd).toBe('/my/project')
    expect(runInput.env?.GEMINI_API_KEY).toBe('gemini-secret-xyz')
    expect(runInput.policy.mode).toBe('edit')

    // Title updated from first task (trimmed to 60 chars)
    const updatedSession = manager.sessionStore.get(session.id)
    expect(updatedSession?.title).toBe(taskText.trim().slice(0, 60))

    // Transcript contains user item and result item
    const transcript = manager.getTranscript(session.id)
    expect(transcript).toHaveLength(2)
    expect(transcript[0]).toEqual({
      kind: 'user',
      text: taskText,
      at: nowTime
    })
    expect(transcript[1]).toEqual({
      kind: 'result',
      status: 'completed',
      text: 'Task finished successfully',
      usage: undefined,
      touchedFiles: undefined,
      deniedActions: undefined,
      at: nowTime
    })

    // Session returned to idle
    expect(manager.sessionStore.get(session.id)?.status).toBe('idle')
  })

  it('sendTask does not overwrite custom title on subsequent tasks', async () => {
    const binPath = createFakeBinary('agy.cmd')
    const manager = createManager()
    manager.agentStore.setRuntimePath('antigravity', binPath)

    const agent = manager.addAgent({
      runtime: 'antigravity',
      kind: 'gemini-key',
      label: 'Antigravity Ready',
      secret: 'secret'
    })

    const session = manager.createSession(agent.id, '/proj')
    manager.renameSession(session.id, 'User Chosen Title')

    await manager.sendTask(session.id, 'A very different task prompt')

    const reloaded = manager.sessionStore.get(session.id)
    expect(reloaded?.title).toBe('User Chosen Title')
  })

  it('sendTask sets session status to needs-attention when deniedActions are present', async () => {
    const binPath = createFakeBinary('agy.cmd')
    const manager = createManager()
    manager.agentStore.setRuntimePath('antigravity', binPath)

    fakeRunTask.mockResolvedValueOnce({
      status: 'completed',
      text: 'Blocked on permission',
      deniedActions: ['bash("rm -rf /")']
    })

    const agent = manager.addAgent({
      runtime: 'antigravity',
      kind: 'gemini-key',
      label: 'Antigravity Ready',
      secret: 'secret'
    })
    const session = manager.createSession(agent.id, '/proj')

    await manager.sendTask(session.id, 'Delete root')
    expect(manager.sessionStore.get(session.id)?.status).toBe('needs-attention')
  })

  it('deleteSession cancels running task', async () => {
    const manager = createManager()
    const agent = manager.addAgent({
      runtime: 'antigravity',
      kind: 'gemini-key',
      label: 'Agy',
      secret: 'key'
    })
    const session = manager.createSession(agent.id, '/proj')

    await manager.deleteSession(session.id)
    expect(fakeCancel).toHaveBeenCalledWith(session.id)
    expect(manager.sessionStore.get(session.id)).toBeNull()
  })

  it('deleteSession cancels running task, awaits in-flight run, and does not recreate transcript file if runner emits after cancellation', async () => {
    const binPath = createFakeBinary('agy.cmd')
    const manager = createManager()
    manager.agentStore.setRuntimePath('antigravity', binPath)

    const agent = manager.addAgent({
      runtime: 'antigravity',
      kind: 'gemini-key',
      label: 'Agy',
      secret: 'key'
    })
    const session = manager.createSession(agent.id, '/proj')

    let resolveRunTask!: (res: CliTerminalResult) => void
    fakeRunTask.mockImplementationOnce(async (): Promise<CliTerminalResult> => {
      return new Promise<CliTerminalResult>((resolve) => {
        resolveRunTask = resolve
      })
    })

    fakeCancel.mockImplementationOnce(() => {
      manager.sessionStore.appendItem(session.id, {
        kind: 'notice',
        level: 'info',
        text: 'Late event from child exit',
        at: nowTime
      })
      resolveRunTask({ status: 'cancelled', text: '' })
      return true
    })

    const sendPromise = manager.sendTask(session.id, 'Task to be cancelled')
    await manager.deleteSession(session.id)
    await sendPromise

    expect(fakeCancel).toHaveBeenCalledWith(session.id)
    expect(manager.sessionStore.get(session.id)).toBeNull()

    const transcriptPath = manager.sessionStore.getTranscriptPath(session.id)
    expect(existsSync(transcriptPath)).toBe(false)
  })

  it('removeAgent cancels and deletes all sessions referencing the agent', async () => {
    const manager = createManager()
    const agent1 = manager.addAgent({
      runtime: 'antigravity',
      kind: 'gemini-key',
      label: 'Agent 1',
      secret: 'key1'
    })
    const agent2 = manager.addAgent({
      runtime: 'antigravity',
      kind: 'gemini-key',
      label: 'Agent 2',
      secret: 'key2'
    })

    const s1 = manager.createSession(agent1.id, '/proj')
    const s2 = manager.createSession(agent1.id, '/proj')
    const s3 = manager.createSession(agent2.id, '/proj')

    expect(manager.listSessions()).toHaveLength(3)

    await manager.removeAgent(agent1.id)

    expect(manager.agentStore.getAgent(agent1.id)).toBeNull()
    const remainingSessions = manager.listSessions()
    expect(remainingSessions).toHaveLength(1)
    expect(remainingSessions[0].id).toBe(s3.id)
    expect(manager.sessionStore.get(s1.id)).toBeNull()
    expect(manager.sessionStore.get(s2.id)).toBeNull()
    expect(existsSync(manager.sessionStore.getTranscriptPath(s1.id))).toBe(false)
    expect(existsSync(manager.sessionStore.getTranscriptPath(s2.id))).toBe(false)
  })

  it('sendTask catch appends error message in notice and result item before rethrowing', async () => {
    const binPath = createFakeBinary('agy.cmd')
    const manager = createManager()
    manager.agentStore.setRuntimePath('antigravity', binPath)

    const agent = manager.addAgent({
      runtime: 'antigravity',
      kind: 'gemini-key',
      label: 'Agy',
      secret: 'key'
    })
    const session = manager.createSession(agent.id, '/proj')

    fakeRunTask.mockRejectedValueOnce(new Error('Task exceeds maximum size of 32768 bytes'))

    await expect(manager.sendTask(session.id, 'Huge task')).rejects.toThrow(
      'Task exceeds maximum size of 32768 bytes'
    )

    const transcript = manager.getTranscript(session.id)
    expect(transcript).toHaveLength(3) // user, notice, result
    expect(transcript[0].kind).toBe('user')

    const noticeItem = transcript[1]
    expect(noticeItem.kind).toBe('notice')
    expect(noticeItem.text).toBe('Task exceeds maximum size of 32768 bytes')

    const resultItem = transcript[2]
    expect(resultItem.kind).toBe('result')
    if (resultItem.kind === 'result') {
      expect(resultItem.status).toBe('failed')
      expect(resultItem.text).toBe('Task exceeds maximum size of 32768 bytes')
    }

    expect(manager.sessionStore.get(session.id)?.status).toBe('failed')
  })

  it('restore marks running sessions as failed with interruption notice and result', () => {
    const manager = createManager()
    const agent = manager.addAgent({
      runtime: 'antigravity',
      kind: 'gemini-key',
      label: 'Agy',
      secret: 'key'
    })

    const s1 = manager.createSession(agent.id, '/proj')
    const s2 = manager.createSession(agent.id, '/proj')

    manager.sessionStore.setStatus(s1.id, 'running')
    manager.sessionStore.setStatus(s2.id, 'idle')

    manager.restore()

    const restored1 = manager.sessionStore.get(s1.id)
    const restored2 = manager.sessionStore.get(s2.id)

    expect(restored1?.status).toBe('failed')
    expect(restored2?.status).toBe('idle')

    const transcript = manager.getTranscript(s1.id)
    expect(transcript).toHaveLength(2)
    expect(transcript[0]).toEqual({
      kind: 'notice',
      level: 'warn',
      text: 'Session was interrupted by restart',
      at: nowTime
    })
    expect(transcript[1]).toEqual({
      kind: 'result',
      status: 'interrupted',
      text: '',
      at: nowTime
    })
  })

  it('manages runtime settings: enabled, detect, and path', async () => {
    const binPath = createFakeBinary('agy.cmd')
    const manager = createManager()

    manager.setRuntimeEnabled('antigravity', false)
    expect(manager.getStatus().runtimes.antigravity.enabled).toBe(false)

    await manager.setRuntimePath('antigravity', binPath)
    expect(manager.getStatus().runtimes.antigravity.binaryPath).toBe(binPath)

    await manager.cancelAll()
    expect(fakeCancelAll).toHaveBeenCalledTimes(1)

    sessionsChangedCalls = 0
    expect(manager.cancelTask('any-session')).toBe(true)
    expect(sessionsChangedCalls).toBe(1)
  })

  it('provides install descriptors for runtimes across platforms', () => {
    const managerWin = createManager({ platform: 'win32' })
    const agyWin = managerWin.getInstallDescriptor('antigravity')
    expect(agyWin).toEqual({
      runtime: 'antigravity',
      command: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://antigravity.google/cli/install.ps1 | iex'],
      docUrl: 'https://antigravity.google/docs'
    })

    const ocWin = managerWin.getInstallDescriptor('opencode')
    expect(ocWin).toEqual({
      runtime: 'opencode',
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm install -g @opencode/cli'],
      docUrl: 'https://opencode.ai/docs'
    })

    const managerLinux = createManager({ platform: 'linux' })
    const agyLinux = managerLinux.getInstallDescriptor('antigravity')
    expect(agyLinux).toEqual({
      runtime: 'antigravity',
      command: 'bash',
      args: ['-c', 'curl -fsSL https://antigravity.google/cli/install.sh | bash'],
      docUrl: 'https://antigravity.google/docs'
    })

    const ocLinux = managerLinux.getInstallDescriptor('opencode')
    expect(ocLinux).toEqual({
      runtime: 'opencode',
      command: 'npm',
      args: ['install', '-g', '@opencode/cli'],
      docUrl: 'https://opencode.ai/docs'
    })
  })

  it('addAgent defaults label when not provided', () => {
    const manager = createManager()
    const ocAgent = manager.addAgent({
      runtime: 'opencode',
      kind: 'profile',
      provider: 'anthropic'
    })
    expect(ocAgent.label).toBe('OpenCode (anthropic)')

    const agyAgent = manager.addAgent({
      runtime: 'antigravity',
      kind: 'gemini-key',
      secret: 'secret-key'
    })
    expect(agyAgent.label).toBe('Antigravity')
  })
})
