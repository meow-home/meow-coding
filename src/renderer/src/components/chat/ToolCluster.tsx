import { memo } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ToolCallData } from '@shared/types'
import ToolCallCard from './ToolCallCard'

interface Props {
  calls: ToolCallData[]
  // Stable id (first tool's id) used by the parent as the React key. ToolCluster
  // does not own it — the parent passes the tool ids down as props so children
  // can keep their existing stable keys (which are also the IPC event ids).
  firstId: string
}

// ToolCluster is a thin wrapper around consecutive ToolCallCards. It collapses
// a run of tool calls (which the agent fires one after another, with no
// assistant text between) into a single cluster with a master caret + count
// header, so the feed stops scattering them with the default feed gap.
function statusCounts(calls: ToolCallData[]): { ok: number; running: number; err: number } {
  let ok = 0, running = 0, err = 0
  for (const c of calls) {
    if (c.permission === 'pending') running++
    else if (c.permission === 'denied') err++
    else ok++
  }
  return { ok, running, err }
}

export default memo(function ToolCluster({ calls, firstId }: Props) {
  const counts = statusCounts(calls)
  // `open` keeps the cluster expanded by default (matches the user's
  // screenshot: caret points down, rows visible). The user can still collapse
  // it via the master caret.
  return (
    <details className="tool-cluster" open>
      <summary className="tool-cluster-header">
        <ChevronRight className="tool-cluster-chevron" />
        <span className="tool-cluster-title">Ran {calls.length} {calls.length === 1 ? 'command' : 'commands'}</span>
        <span className="tool-cluster-meta">
          {counts.ok > 0 && <span className="tool-cluster-count ok">{counts.ok} ok</span>}
          {counts.running > 0 && <span className="tool-cluster-count running">{counts.running} running</span>}
          {counts.err > 0 && <span className="tool-cluster-count err">{counts.err} failed</span>}
        </span>
      </summary>
      <div className="tool-cluster-body">
        {calls.map(c => (
          // ToolCallCard already keys on its own id; passing `key` here would
          // double-apply. ToolCallCard is memo'd and replaces its call object
          // wholesale on tool-start/tool-result, so it only re-renders when
          // the call itself changes.
          <ToolCallCard key={c.id} call={c} />
        ))}
      </div>
    </details>
  )
})
