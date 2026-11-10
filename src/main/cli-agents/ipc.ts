import type { IpcMain } from 'electron'
import { Channels } from '../../shared/ipc'
import type {
  CliAgentKind,
  CliRuntimeId
} from '../../shared/types'
import type { CliAgentsManager } from './index'

export interface RegisterCliAgentsIpcOptions {
  ipcMain: IpcMain
  manager: CliAgentsManager
  log?: (msg: string) => void
}

export function registerCliAgentsIpc(opts: RegisterCliAgentsIpcOptions): void {
  const { ipcMain, manager, log } = opts

  ipcMain.handle(Channels.CliAgentsStatus, () => {
    return manager.getStatus()
  })

  ipcMain.handle(Channels.CliRuntimeDetect, (_e, runtime: CliRuntimeId) => {
    return manager.detectRuntime(runtime)
  })

  ipcMain.handle(Channels.CliRuntimeInstall, (_e, runtime: CliRuntimeId) => {
    return manager.getInstallDescriptor(runtime)
  })

  ipcMain.handle(Channels.CliRuntimeSetPath, async (_e, runtime: CliRuntimeId, path: string | null) => {
    await manager.setRuntimePath(runtime, path)
  })

  ipcMain.handle(Channels.CliRuntimeSetEnabled, (_e, runtime: CliRuntimeId, enabled: boolean) => {
    manager.setRuntimeEnabled(runtime, enabled)
  })

  ipcMain.handle(Channels.CliModelsList, (_e, runtime: CliRuntimeId, agentId?: string) => {
    return manager.listModels(runtime, agentId)
  })

  ipcMain.handle(Channels.CliAgentAdd, (_e, runtime: CliRuntimeId, kind: CliAgentKind, provider?: string, secret?: string) => {
    const agent = manager.addAgent({ runtime, kind, provider, secret })
    return { agent }
  })

  ipcMain.handle(Channels.CliAgentRename, (_e, id: string, label: string) => {
    manager.renameAgent(id, label)
  })

  ipcMain.handle(Channels.CliAgentRemove, async (_e, id: string) => {
    await manager.removeAgent(id)
  })

  ipcMain.handle(Channels.CliAgentActivate, (_e, id: string) => {
    manager.activateAgent(id)
  })

  ipcMain.handle(Channels.CliAgentSetDefault, (_e, id: string) => {
    manager.setDefaultAgent(id)
  })

  ipcMain.handle(Channels.CliLoginInput, () => {
    throw new Error('[meow] CLI login is not available yet')
  })

  ipcMain.handle(Channels.CliLoginCancel, () => {
    throw new Error('[meow] CLI login is not available yet')
  })

  ipcMain.handle(Channels.CliSessionCreate, (_e, agentId: string, projectPath: string) => {
    return manager.createSession(agentId, projectPath)
  })

  ipcMain.handle(Channels.CliSessionRename, (_e, id: string, title: string) => {
    manager.renameSession(id, title)
  })

  ipcMain.handle(Channels.CliSessionDelete, async (_e, id: string) => {
    await manager.deleteSession(id)
  })

  ipcMain.handle(Channels.CliSessionOpenTerminal, () => {
    throw new Error('[meow] Opening a CLI session terminal is not available yet')
  })

  ipcMain.handle(Channels.CliTaskSend, (_e, sessionId: string, text: string) => {
    void manager.sendTask(sessionId, text).catch(err => {
      log?.(`[meow] sendTask error for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`)
    })
  })

  ipcMain.handle(Channels.CliTaskCancel, (_e, sessionId: string) => {
    return manager.cancelTask(sessionId)
  })

  ipcMain.handle(Channels.CliDelegationCancel, () => {
    throw new Error('[meow] CLI delegation is not available yet')
  })
}
