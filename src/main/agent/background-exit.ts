import type { BgExitInfo } from './background-process-store'

export interface BackgroundExitDeps {
  appendMessage: (sessionId: string, text: string) => void
  notify?: (info: BgExitInfo) => void
  isRunning: (agentId: string) => boolean
  wake: (agentId: string, text: string) => void
}

export function backgroundExitMessage(info: BgExitInfo): string {
  const status = info.exitCode === null ? 'was stopped' : `exited (code ${info.exitCode})`
  return `[background bash ${info.id}] \`${info.command}\` ${status}. ` +
    `Read its output with bash_output({ id: "${info.id}" }).`
}

export function handleBackgroundExit(info: BgExitInfo, deps: BackgroundExitDeps): void {
  deps.appendMessage(info.sessionId, backgroundExitMessage(info))
  deps.notify?.(info)
  // Auto-wake only when the agent is idle; a mid-turn agent picks the message
  // up on its next step, and the drainQueue guard would ignore a wake anyway.
  if (!deps.isRunning(info.agentId)) {
    deps.wake(
      info.agentId,
      `A background shell (${info.id}) just finished. If it is relevant, read its output with bash_output and continue.`
    )
  }
}
