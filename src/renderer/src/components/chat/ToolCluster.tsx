import { memo } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import type { ToolCallData } from '@shared/types'
import ToolCallCard from './ToolCallCard'
import { describeRunning, diffStats, summarizeCalls } from './toolSummary'

export type ClusterStep =
  | { kind: 'tool'; call: ToolCallData }
  | { kind: 'thought'; id: string; text: string }

interface Props {
  steps: ClusterStep[]
  // Stable id (first step's id) used by the parent as the React key. ToolCluster
  // does not own it — the parent passes the step ids down as props so children
  // can keep their existing stable keys (which are also the IPC event ids).
  firstId: string
  // The cluster is the newest feed row of a running turn: with no tool pending,
  // the agent is thinking, and the header says so instead of the past-tense summary.
  live?: boolean
}

function ThoughtStep({ text }: { text: string }) {
  const firstLine = text.trim().split('\n', 1)[0]
  return (
    <details className="tool-call tool-thought">
      <summary className="tool-call-header">
        <ChevronRight className="tool-call-chevron" />
        <span className="tool-call-badge tool-call-badge-thought">thought</span>
        <span className="tool-call-summary tool-thought-preview">{firstLine}</span>
      </summary>
      <div className="tool-call-body">
        <div className="tool-thought-text">{text}</div>
      </div>
    </details>
  )
}

// ToolCluster folds a run of tool calls — and the thinking between them — into
// one collapsed, chrome-less line ("Read 2 files, ran a command  +12 −3"), so a
// long run no longer stretches the feed. While a step runs, the line names it.
export default memo(function ToolCluster({ steps, live }: Props) {
  const calls = steps.flatMap(s => (s.kind === 'tool' ? [s.call] : []))
  const running = calls.filter(c => c.permission === 'pending')
  const failed = calls.filter(c => c.permission === 'denied' || c.error !== undefined).length
  const { added, removed } = diffStats(calls)
  const active = running[running.length - 1]
  const thinking = !active && live === true
  const busy = active !== undefined || thinking

  // No `open` prop: the cluster starts collapsed and the browser keeps the
  // user's toggle across re-renders.
  return (
    <details className={`tool-cluster${busy ? ' running' : ''}`}>
      <summary className="tool-cluster-header">
        {busy && <Loader2 className="tool-cluster-spinner" aria-hidden="true" />}
        <span className="tool-cluster-title">
          {active ? `${describeRunning(active)}…` : thinking ? 'Thinking…' : summarizeCalls(calls)}
        </span>
        {active && <span className="tool-cluster-progress">{calls.length - running.length}/{calls.length}</span>}
        {!busy && added > 0 && <span className="tool-cluster-added">+{added}</span>}
        {!busy && removed > 0 && <span className="tool-cluster-removed">−{removed}</span>}
        {failed > 0 && <span className="tool-cluster-failed">· {failed} failed</span>}
        <ChevronRight className="tool-cluster-chevron" aria-hidden="true" />
      </summary>
      <div className="tool-cluster-body">
        {steps.map(s => s.kind === 'thought'
          ? <ThoughtStep key={s.id} text={s.text} />
          // Steps stay collapsed even while running — the header already
          // names the active step; the user clicks a row to see its body.
          : <ToolCallCard key={s.call.id} call={s.call} collapseWhileRunning />
        )}
      </div>
    </details>
  )
})
