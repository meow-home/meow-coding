import { memo } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import type { ToolCallData } from '@shared/types'
import ToolCallCard from './ToolCallCard'
import { describeRunning, diffStats, summarizeCalls } from './toolSummary'

interface Props {
  calls: ToolCallData[]
  // Stable id (first tool's id) used by the parent as the React key. ToolCluster
  // does not own it — the parent passes the tool ids down as props so children
  // can keep their existing stable keys (which are also the IPC event ids).
  firstId: string
}

// ToolCluster folds a run of consecutive tool calls into one collapsed,
// chrome-less line ("Read 2 files, ran a command  +12 −3"), so a long run no
// longer stretches the feed. While a step runs, the line names that step.
export default memo(function ToolCluster({ calls }: Props) {
  const running = calls.filter(c => c.permission === 'pending')
  const failed = calls.filter(c => c.permission === 'denied' || c.error !== undefined).length
  const { added, removed } = diffStats(calls)
  const active = running[running.length - 1]

  // No `open` prop: the cluster starts collapsed and the browser keeps the
  // user's toggle across re-renders.
  return (
    <details className={`tool-cluster${active ? ' running' : ''}`}>
      <summary className="tool-cluster-header">
        {active && <Loader2 className="tool-cluster-spinner" aria-hidden="true" />}
        <span className="tool-cluster-title">
          {active ? `${describeRunning(active)}…` : summarizeCalls(calls)}
        </span>
        {active && <span className="tool-cluster-progress">{calls.length - running.length}/{calls.length}</span>}
        {!active && added > 0 && <span className="tool-cluster-added">+{added}</span>}
        {!active && removed > 0 && <span className="tool-cluster-removed">−{removed}</span>}
        {failed > 0 && <span className="tool-cluster-failed">· {failed} failed</span>}
        <ChevronRight className="tool-cluster-chevron" aria-hidden="true" />
      </summary>
      <div className="tool-cluster-body">
        {calls.map(c => (
          // Steps stay collapsed even while running — the header already
          // names the active step; the user clicks a row to see its body.
          <ToolCallCard key={c.id} call={c} collapseWhileRunning />
        ))}
      </div>
    </details>
  )
})
