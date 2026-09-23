import type { z } from 'zod'
import type { SnapshotStore } from '../snapshot'
import type { BackgroundProcessStore } from '../background-process-store'
import type { MonitorStore } from '../monitor-store'
import type { PollMonitorStore } from '../poll-monitor-store'
import type { AgentRunContext } from '../run-context'
import type { ArtifactEntry, QuestionPrompt, TodoItem } from '../../../shared/types'

export type ToolSchema = z.ZodType | Record<string, unknown>

export interface ToolDefinition {
  name: string
  description: string
  schema: ToolSchema
  /**
   * Read-only and safe to run alongside other safe calls. Absent = runs alone,
   * which is the only safe default for MCP and user tools.
   */
  concurrencySafe?: boolean
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolRunResult>
}

export interface ToolContext {
  cwd: string
  // The fixed identity of the run that invoked the tool (a delegated turn has
  // its own `AgentRunContext`), snapshot per invocation. Lets the
  // `delegate_session` tool correlate the source run.
  runContext?: AgentRunContext
  ask(question: QuestionPrompt): Promise<string | null>
  setTodos?(todos: TodoItem[]): void
  emitSubagent?(taskId: string, e: SubagentToolEvent): void
  signal?: AbortSignal
  agentId?: string
  // Subagents run under their own agentId for tracing, but their file changes
  // belong to the parent's turn so undo/revert can reach them.
  snapshotAgentId?: string
  taskId?: string
  turn?: number
  snapshots?: SnapshotStore
  diagnostics?: (filePath: string, text: string) => Promise<string>
  // Returns instruction-reminder text to append to the read tool output
  // ('' when no nearby instructions or already attached) — opencode-style.
  onFileRead?(filePath: string): string
  // Records a file created/modified by this agent (id/ts/agentName resolved by main).
  onArtifact?(entry: Omit<ArtifactEntry, 'id' | 'ts'>): void
  // Long-lived background shell processes (bash run_in_background / bash_output / kill_shell).
  backgroundProcs?: BackgroundProcessStore
  // Async watches over background shells (monitor tool).
  monitors?: MonitorStore
  // Interval polling of a command (monitor tool, command mode).
  pollMonitors?: PollMonitorStore
}

export interface SubagentToolEvent {
  sub: 'start' | 'delta' | 'tool' | 'done'
  parentTaskId?: string
  subagentType?: string
  text?: string
  tool?: string
  reasoning?: string
  background?: boolean
  result?: string
  state?: 'running' | 'completed' | 'cancelled' | 'error'
}

export interface ToolRunResult {
  output?: string
  error?: string
  background?: boolean
  /** Ad-hoc data attached to the persisted ToolCallData (e.g. delegationId). */
  metadata?: Record<string, unknown>
}
