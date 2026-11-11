import type { IpcMain } from 'electron'
import { Channels } from '../../shared/ipc'
import type { AntigravityCli } from './index'

export interface RegisterCliAgentsIpcOptions {
  ipcMain: IpcMain
  cli: AntigravityCli
}

export function registerCliAgentsIpc(opts: RegisterCliAgentsIpcOptions): void {
  const { ipcMain, cli } = opts
  ipcMain.handle(Channels.CliCheck, () => cli.check())
  ipcMain.handle(Channels.CliTest, () => cli.test())
}
