import type { EnvSnapshot } from './env'
import type { MemoryIndex } from './memory'

export interface BuildSystemPromptArgs {
  baseSystemPrompt: string
  modeNote: string
  instructionText: string
  skillsText: string
  memoryRules: string
}

export const PRECEDENCE_NOTE =
  'Precedence: project instructions (AGENTS.md/CLAUDE.md) > memory > skills > base system prompt.'

/** Which part of the prompt a section is, so callers can label it for the user. */
export type SystemPromptSectionKey = 'system' | 'instructions' | 'memory' | 'skills' | 'mode'

export interface SystemPromptSection {
  key: SystemPromptSectionKey
  /** Heading the model sees (`# <title>`). */
  title: string
  text: string
}

// The labeled sections in prompt order, empty ones dropped (e.g. build mode has
// no mode note). Exported so the context readout can measure each part with the
// exact text the model receives instead of re-deriving it.
export function systemPromptSections(a: BuildSystemPromptArgs): SystemPromptSection[] {
  const sections: SystemPromptSection[] = [
    { key: 'system', title: 'Identity & how to work', text: a.baseSystemPrompt.trim() },
    { key: 'instructions', title: 'Project instructions', text: a.instructionText.trim() },
    { key: 'memory', title: 'Memory', text: a.memoryRules.trim() },
    { key: 'skills', title: 'Skills', text: a.skillsText.trim() },
    { key: 'mode', title: 'Mode & permissions', text: a.modeNote.trim() }
  ]
  return sections.filter(s => s.text !== '')
}

// Static harness prompt: labeled sections, assembled once per run so an edited
// AGENTS.md or a new skill lands on the next turn while the provider still
// caches the stable prefix; the precedence note always closes the prompt.
export function buildSystemPrompt(a: BuildSystemPromptArgs): string {
  const body = systemPromptSections(a)
    .map(s => `# ${s.title}\n\n${s.text}`)
    .join('\n\n')
  return `${body}\n\n${PRECEDENCE_NOTE}`
}

// Dynamic context: a <system-reminder> user message prepended at turn start,
// recomputed every run so it is always fresh. Not written to the store.
export function buildTurnReminder(env: EnvSnapshot, memory: MemoryIndex): string {
  const lines = [
    '<system-reminder>',
    `Environment: platform=${env.platform}, shell=${env.shell}, cwd=${env.cwd}, date=${env.date}`
  ]
  if (env.git) {
    const branch = env.git.branch ?? '(detached)'
    lines.push(`Git: on ${branch}, ${env.git.dirtyCount} dirty file(s).`)
  }
  if (memory.lines.length > 0) {
    lines.push('', `Memory index (${memory.path}):`)
    lines.push(...memory.lines)
    if (memory.truncated) lines.push('(index truncated)')
  }
  if (env.peers && env.peers.length > 0) {
    lines.push('', 'Delegatable session peers (same project):')
    for (const p of env.peers) {
      lines.push(`- ${p.name} (${p.agentId}): mode=${p.mode}, state=${p.state}`)
    }
    lines.push('', 'To route a focused task to another persistent session, call the `delegate_session` tool (not the ephemeral `task` subagent). Do not edit the delegated scope before its result returns.')
  }
  lines.push('</system-reminder>')
  return lines.join('\n')
}
