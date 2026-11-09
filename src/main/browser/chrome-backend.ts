import type { BrowserCommandName, BrowserCommandResult } from '../../shared/browser-types'
import type { ToolRunResult } from '../agent/tools/types'
import type { BrowserBackend, BrowserBridgeLike, BrowserCall, BrowserLauncherLike } from './browser-backend'

export interface ChromeBackendDeps {
  bridge: BrowserBridgeLike
  launcher: BrowserLauncherLike
}

/** The paired-Chrome extension backend: today's browser bridge and launcher. */
export class ChromeBackend implements BrowserBackend {
  constructor(private readonly deps: ChromeBackendDeps) {}

  async start(_call: BrowserCall): Promise<ToolRunResult> {
    const status = this.deps.bridge.getStatus()
    if (status.paired) {
      return { output: `browser paired (port ${status.port})` }
    }
    await this.deps.launcher.openChrome()
    await this.deps.launcher.showInstallGuide()
    const paired = await this.deps.bridge.waitForPaired(60_000)
    if (!paired) return { error: 'browser not paired after 60s — approve the extension in Meow → Browser Bridge' }
    return { output: `browser paired (port ${this.deps.bridge.getStatus().port})` }
  }

  execute(name: BrowserCommandName, params: Record<string, unknown>, _call: BrowserCall, timeoutMs?: number): Promise<BrowserCommandResult> {
    return this.deps.bridge.execute(name, params, timeoutMs)
  }

  getConsoleLogs(_call: BrowserCall, limit?: number, _tabId?: number): unknown[] {
    return this.deps.bridge.getConsoleLogs(limit)
  }

  getNetworkLogs(_call: BrowserCall, limit?: number, _tabId?: number): unknown[] {
    return this.deps.bridge.getNetworkLogs(limit)
  }
}
