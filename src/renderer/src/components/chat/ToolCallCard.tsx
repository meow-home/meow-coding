import { memo } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ToolCallData } from '@shared/types'
import DiffView from './DiffView'

interface Props {
  call: ToolCallData
  // When true, the card never auto-opens (even while the call is `pending`).
  // Used by ToolCluster so a long run of tool steps stays collapsed and the
  // feed reads as a tight group — the user can still click any step to peek.
  collapseWhileRunning?: boolean
}

// Short single-line description of what the tool did, shown on the collapsed
// header (e.g. "edit src/main/index.ts", "bash npm run build").
function describeInput(call: ToolCallData): string {
  const input = call.input ?? {}
  const first = (keys: string[]) => {
    for (const k of keys) {
      const v = input[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return ''
  }
  switch (call.tool) {
    case 'edit': case 'apply-patch': case 'write': case 'read':
      return first(['file_path', 'path'])
    case 'bash': case 'terminal': case 'cmd': case 'sh':
      return first(['command', 'cmd'])
    case 'websearch': case 'webfetch':
      return first(['query', 'url'])
    case 'glob': case 'grep': case 'ls': case 'dir':
      return first(['pattern', 'path'])
    default: {
      for (const v of Object.values(input)) {
        if (typeof v === 'string' && v.trim()) return v.trim()
      }
      return ''
    }
  }
}

// call objects are replaced wholesale on tool-start/tool-result, so memo keeps
// finished cards from re-rendering (and re-stringifying) on every stream delta.
export default memo(function ToolCallCard({ call, collapseWhileRunning }: Props) {
  const pending = call.permission === 'pending'
  const input = call.input ?? {}
  const editDiff = call.tool === 'edit'
    && typeof input.old_string === 'string'
    && typeof input.new_string === 'string'
  const patch = call.tool === 'apply-patch' && typeof input.patch === 'string'
    ? input.patch
    : null

  const statusClass = pending
    ? 'status-running'
    : call.permission === 'denied'
      ? 'status-err'
      : 'status-ok'

  // Default: open while running so the user can watch what the agent is doing.
  // In a cluster, the parent (ToolCluster) passes collapseWhileRunning so the
  // step stays collapsed — the cluster header already shows progress.
  const openDefault = collapseWhileRunning ? false : pending

  // Re-key on the pending → done transition so the card resets to collapsed
  // even if the user had clicked it open during the run; otherwise the
  // browser keeps the open attribute from the previous render.
  const stepKey = pending ? `pending:${call.id}` : `done:${call.id}`

  return (
    <details className={`tool-call ${statusClass}`} open={openDefault} key={stepKey}>
      <summary className="tool-call-header">
        <ChevronRight className="tool-call-chevron" />
        <span className={`tool-call-badge tool-call-badge-${call.tool}`}>{call.tool}</span>
        <span className="tool-call-summary" title={describeInput(call)}>{describeInput(call)}</span>
        {pending && <span className="tool-call-running">running…</span>}
        {!pending && (
          <span className={`tool-call-status ${call.permission === 'denied' ? 'err' : 'ok'}`}>
            {call.permission === 'denied' ? '✗' : '✓'}
          </span>
        )}
      </summary>
      <div className="tool-call-body">
        {patch !== null ? (
          <pre className="tool-call-input tool-call-diff">{patch}</pre>
        ) : editDiff ? (
          <DiffView oldText={input.old_string as string} newText={input.new_string as string} />
        ) : (
          <pre className="tool-call-input">{JSON.stringify(input, null, 2)}</pre>
        )}
        {call.output !== undefined && <pre className="tool-call-output">{call.output}</pre>}
        {call.error !== undefined && <pre className="tool-call-error">{call.error}</pre>}
      </div>
    </details>
  )
})
