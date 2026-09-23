import type { ToolCallData } from '../../shared/types'

/**
 * The loop talks to the model mid-turn only through notes attached to a tool
 * result, the way Claude Code and Codex annotate tool output. A synthetic user
 * message would read as the user scolding the model and stay in history.
 */
export type CutReason = 'tool-flood' | 'interleaved' | 'repetition'

export function harnessNote(text: string): string {
  return `<system-reminder>\n[meow] ${text}\n</system-reminder>`
}

export function attachNote(call: ToolCallData, note: string): void {
  if (call.error) call.error = `${call.error}\n${note}`
  else call.output = call.output ? `${call.output}\n${note}` : note
}

export function cutNote(reason: CutReason, maxToolCalls: number): string {
  if (reason === 'tool-flood') {
    return harnessNote(
      `Your response was cut after ${maxToolCalls} tool calls; the rest were dropped. Tool results only ` +
      'arrive after your response ends — call the tools you need, then wait for their results.'
    )
  }
  if (reason === 'interleaved') {
    return harnessNote(
      'Your response was cut: it kept writing after calling tools, and the calls that followed were ' +
      'dropped. Tool results only arrive after your response ends — call tools, then stop and wait for their results.'
    )
  }
  return harnessNote(
    'Your response was cut because it started repeating itself. The tool calls above ran; continue ' +
    'from their results without restating earlier text.'
  )
}

export function toolLoopNote(verdict: { kind: 'poll' | 'repeat'; tool: string; count: number }): string {
  if (verdict.kind === 'poll') {
    return harnessNote(
      `The shell is still running with no new output (${verdict.count} identical checks). Wait with ` +
      'bash_output({ id, wait_s: 120 }), or end your turn — you will be woken when it exits.'
    )
  }
  return harnessNote(
    `This exact ${verdict.tool} call returned the same result ${verdict.count} times; repeating it will ` +
    'not change the result. Use what you have, try a different approach, or end your turn and explain what is blocking you.'
  )
}
