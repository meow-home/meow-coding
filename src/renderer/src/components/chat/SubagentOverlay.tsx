import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle, Bot, Check, CheckCircle2, Clock, Copy, FileText, GitBranch,
  Search, Sparkles, Terminal, Wrench, XCircle
} from 'lucide-react'
import MarkdownText from './MarkdownText'
import PanelHeader from '../common/PanelHeader'

export interface SubagentOverlayItem {
  taskId: string
  // The session that spawned the sub-agent; the overlay is per project, so the tab
  // is filed under that session's project.
  agentId?: string
  projectPath?: string
  subagentType?: string
  background?: boolean
  state: 'running' | 'completed' | 'cancelled' | 'error'
  tools: string[]
  text?: string
  reasoning?: string
  result?: string
}

interface Props {
  items: SubagentOverlayItem[]
  activeId: string | null
  onSelect: (taskId: string) => void
  onCloseTab: (taskId: string) => void
  full: boolean
  onToggleFull: () => void
  onClose: () => void
}

function StatusIcon({ state }: { state: SubagentOverlayItem['state'] }) {
  if (state === 'running') return <Clock size={12} className="subagent-status-icon running" />
  if (state === 'completed') return <CheckCircle2 size={12} className="subagent-status-icon completed" />
  if (state === 'error') return <AlertCircle size={12} className="subagent-status-icon error" />
  return <XCircle size={12} className="subagent-status-icon cancelled" />
}

function ToolIcon({ name }: { name: string }) {
  const lower = name.toLowerCase()
  if (lower.includes('bash') || lower.includes('cmd') || lower.includes('terminal') || lower.includes('shell')) {
    return <Terminal size={12} className="tool-icon" />
  }
  if (lower.includes('file') || lower.includes('read') || lower.includes('write') || lower.includes('edit')) {
    return <FileText size={12} className="tool-icon" />
  }
  if (lower.includes('git')) {
    return <GitBranch size={12} className="tool-icon" />
  }
  if (lower.includes('search') || lower.includes('grep') || lower.includes('glob')) {
    return <Search size={12} className="tool-icon" />
  }
  return <Wrench size={12} className="tool-icon" />
}

function tabLabel(item: SubagentOverlayItem): string {
  return `${item.subagentType || 'sub-agent'} ${item.taskId.slice(0, 6)}`
}

/** One tab per sub-agent the user opened from the chat. */
export default function SubagentOverlay({ items, activeId, onSelect, onCloseTab, full, onToggleFull, onClose }: Props) {
  const item = items.find(i => i.taskId === activeId) ?? items[items.length - 1]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <section
      className={`files-overlay subagent-overlay${full ? ' full' : ' docked'}`}
      role="dialog"
      aria-label="Sub-agent Details"
    >
      <PanelHeader
        ariaLabel="Sub-agents"
        activeId={item?.taskId ?? null}
        onSelect={onSelect}
        tabs={items.map(i => ({
          id: i.taskId,
          title: i.taskId,
          lead: <StatusIcon state={i.state} />,
          label: tabLabel(i),
          closeLabel: `Close ${tabLabel(i)}`,
          onClose: () => onCloseTab(i.taskId)
        }))}
        full={full}
        onToggleFull={onToggleFull}
        closeLabel="Close Sub-agent"
        onClose={onClose}
      />
      {item && <SubagentDetails key={item.taskId} item={item} />}
    </section>
  )
}

function SubagentDetails({ item }: { item: SubagentOverlayItem }) {
  const outRef = useRef<HTMLDivElement>(null)
  const [copiedId, setCopiedId] = useState(false)

  const handleCopyId = useCallback(() => {
    void navigator.clipboard.writeText(item.taskId)
    setCopiedId(true)
    setTimeout(() => setCopiedId(false), 1500)
  }, [item.taskId])

  useEffect(() => {
    const el = outRef.current
    if (el && item.state === 'running') {
      el.scrollTop = el.scrollHeight
    }
  }, [item.text, item.state])

  return (
      <div className="files-body">
        <div className="files-side subagent-side">
          {/* Subagent Profile Card */}
          <div className="subagent-hero-card">
            <div className="subagent-hero-avatar">
              <Bot size={18} aria-hidden="true" />
            </div>
            <div className="subagent-hero-info">
              <div className="subagent-hero-role">{item.subagentType || 'subagent'}</div>
              <div className="subagent-hero-badge-row">
                <span className={`subagent-state-badge state-${item.state}`}>
                  <StatusIcon state={item.state} />
                  <span>{item.state}</span>
                </span>
                {item.background && <span className="subagent-bg-pill">background</span>}
              </div>
            </div>
          </div>

          {/* Execution Details Card */}
          <div className="subagent-card-section">
            <div className="subagent-section-eyebrow">Task Metadata</div>
            <div className="subagent-meta-grid">
              <div className="subagent-meta-item">
                <span className="subagent-meta-label">Task ID</span>
                <button
                  className="subagent-id-btn"
                  onClick={handleCopyId}
                  title="Click to copy full Task ID"
                >
                  <span className="subagent-id-code">{item.taskId.slice(0, 8)}</span>
                  {copiedId ? <Check size={11} className="subagent-copied-icon" /> : <Copy size={11} />}
                </button>
              </div>
              <div className="subagent-meta-item">
                <span className="subagent-meta-label">Mode</span>
                <span className="subagent-meta-val">{item.background ? 'Background' : 'Foreground'}</span>
              </div>
              <div className="subagent-meta-item">
                <span className="subagent-meta-label">Total Tools</span>
                <span className="subagent-meta-val">{item.tools.length}</span>
              </div>
            </div>
          </div>

          {/* Tools Called Timeline */}
          <div className="subagent-card-section tools-section">
            <div className="subagent-section-eyebrow">
              <span>Executed Tools</span>
              <span className="subagent-tools-count">{item.tools.length}</span>
            </div>
            {item.tools.length === 0 ? (
              <div className="subagent-empty-tools">
                <Sparkles size={13} aria-hidden="true" />
                <span>No tool executions yet</span>
              </div>
            ) : (
              <div className="subagent-tools-timeline">
                {item.tools.map((t, idx) => (
                  <div key={idx} className="subagent-tool-row">
                    <span className="tool-step-idx">{String(idx + 1).padStart(2, '0')}</span>
                    <ToolIcon name={t} />
                    <span className="tool-name">{t}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="files-main subagent-main">
          <div className="subagent-output-header">Output Stream</div>
          <div ref={outRef} className="subagent-output-body">
            {item.text ? (
              <MarkdownText text={item.text} />
            ) : item.state === 'running' ? (
              <div className="subagent-live-placeholder">Agent is running…</div>
            ) : (
              <div className="subagent-live-placeholder">(No output recorded)</div>
            )}
            {item.result && (
              <div className="subagent-result-section">
                <div className="subagent-result-title">Task Result</div>
                <MarkdownText text={item.result} />
              </div>
            )}
          </div>
        </div>
      </div>
  )
}
