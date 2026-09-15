import { useState } from 'react'
import { Gauge, Bell, Sliders, ChevronDown, ChevronRight, Zap, FileText, Cpu, BellRing } from 'lucide-react'
import type { CompactionSettings, NotificationsSettings, ToolOutputSettings } from '@shared/types'

interface Props {
  maxSteps: number
  compaction: CompactionSettings
  toolOutput: ToolOutputSettings
  notifications: NotificationsSettings
  mcpOutput?: { maxTokens?: number }
  /** Active agent's context limit, for the "auto ≈" placeholders. */
  resolvedContextTokens?: number | null
  onChange: (patch: {
    maxSteps: number
    compaction: CompactionSettings
    toolOutput: ToolOutputSettings
    notifications: NotificationsSettings
    mcpOutput?: { maxTokens?: number }
  }) => void
}

// Empty input = undefined = auto-resolved by ratio of the context window.
function numOrUndefined(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function num(value: string, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function displaySteps(n: number): string {
  return Number.isFinite(n) && n > 0 ? String(n) : ''
}

// Same ratios as COMPACTION_RATIOS in the main process; the renderer cannot
// import main-process token helpers, so placeholders show the token count.
const RATIO = { buffer: 0.15, keepTokens: 0.06, toolOutputMaxChars: 0.015 }

export default function ContextTab({
  maxSteps,
  compaction,
  toolOutput,
  notifications,
  mcpOutput,
  resolvedContextTokens,
  onChange
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const setMaxSteps = (value: string) =>
    onChange({ maxSteps: num(value, maxSteps), compaction, toolOutput, notifications, mcpOutput })
  const setComp = (patch: Partial<CompactionSettings>) =>
    onChange({ maxSteps, compaction: { ...compaction, ...patch }, toolOutput, notifications, mcpOutput })
  const setToolOutput = (patch: Partial<ToolOutputSettings>) =>
    onChange({ maxSteps, compaction, toolOutput: { ...toolOutput, ...patch }, notifications, mcpOutput })
  const setNotifications = (patch: Partial<NotificationsSettings>) =>
    onChange({ maxSteps, compaction, toolOutput, notifications: { ...notifications, ...patch }, mcpOutput })
  const setMcpOutput = (patch: Partial<NonNullable<typeof mcpOutput>>) =>
    onChange({ maxSteps, compaction, toolOutput, notifications, mcpOutput: { ...mcpOutput, ...patch } })

  const ctx = typeof resolvedContextTokens === 'number' && resolvedContextTokens > 0 ? resolvedContextTokens : null
  const auto = (key: keyof typeof RATIO) => (ctx ? `auto ≈ ${Math.round(ctx * RATIO[key])} tokens` : 'auto')

  return (
    <div className="settings-tab context-tab">
      <p className="settings-hint">
        Manage agent context limits, auto-compaction boundaries, tool result previews, and desktop notifications.
      </p>

      {/* Card 1: Primary Limits */}
      <div className="context-card">
        <div className="context-card-head">
          <div className="context-icon-badge">
            <Gauge size={16} aria-hidden="true" />
          </div>
          <div className="context-title-group">
            <h4 className="context-card-title">Session & Compaction Limits</h4>
            <p className="context-card-desc">Configure tool execution steps and token thresholds for active sessions.</p>
          </div>
        </div>

        <div className="context-card-body">
          <div className="context-fields-grid">
            <div className="context-field-item">
              <label className="context-field-label">Max steps per turn</label>
              <input
                className="input"
                type="number"
                min={1}
                value={displaySteps(maxSteps)}
                placeholder="unlimited"
                onChange={e => setMaxSteps(e.target.value)}
              />
              <span className="context-field-hint">Maximum tool steps per turn (empty = unlimited).</span>
            </div>

            <div className="context-field-item">
              <label className="context-field-label">MCP output max tokens</label>
              <input
                className="input"
                type="number"
                min={1000}
                value={mcpOutput?.maxTokens ?? ''}
                placeholder="25000"
                onChange={e => setMcpOutput({ maxTokens: numOrUndefined(e.target.value) })}
              />
              <span className="context-field-hint">Tool results above limit write to file preview. Empty = 25000.</span>
            </div>
          </div>

          <div className="context-check-row" onClick={() => setComp({ auto: !compaction.auto })}>
            <div className="context-check-info">
              <span className="context-check-title">Auto-compact context</span>
              <span className="context-check-desc">Automatically summarize older context when the context limit is approached.</span>
            </div>
            <input
              type="checkbox"
              className="context-checkbox"
              checked={compaction.auto}
              onChange={e => e.stopPropagation()}
            />
          </div>
        </div>
      </div>

      {/* Card 2: Notifications */}
      <div className="context-card">
        <div className="context-card-head">
          <div className="context-icon-badge">
            <Bell size={16} aria-hidden="true" />
          </div>
          <div className="context-title-group">
            <h4 className="context-card-title">Notifications</h4>
            <p className="context-card-desc">Choose when desktop alerts appear for background agent activity.</p>
          </div>
        </div>

        <div className="context-card-body">
          <div
            className="context-check-row"
            onClick={() => setNotifications({ needsInput: !notifications.needsInput })}
          >
            <div className="context-check-info">
              <span className="context-check-title">Notify when input is required</span>
              <span className="context-check-desc">Trigger notification when an agent pauses for user confirmation or input.</span>
            </div>
            <input
              type="checkbox"
              className="context-checkbox"
              checked={notifications.needsInput}
              onChange={e => e.stopPropagation()}
            />
          </div>

          <div
            className="context-check-row"
            onClick={() => setNotifications({ onDone: !notifications.onDone })}
          >
            <div className="context-check-info">
              <span className="context-check-title">Notify on completion or error</span>
              <span className="context-check-desc">Send alert when an agent finishes running or encounters an unhandled error.</span>
            </div>
            <input
              type="checkbox"
              className="context-checkbox"
              checked={notifications.onDone}
              onChange={e => e.stopPropagation()}
            />
          </div>
        </div>
      </div>

      {/* Card 3: Advanced Compaction Tuning */}
      <div className="context-card">
        <div
          className="context-card-head clickable"
          onClick={() => setAdvancedOpen(prev => !prev)}
        >
          <div className="context-icon-badge">
            <Sliders size={16} aria-hidden="true" />
          </div>
          <div className="context-title-group">
            <div className="context-title-row">
              <h4 className="context-card-title">Advanced Compaction Tuning</h4>
              <span className="context-tag">Optional</span>
            </div>
            <p className="context-card-desc">Fine-tune buffer allocations, tail turns, and tool result truncations (empty = auto).</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Toggle advanced settings">
            {advancedOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>

        {advancedOpen && (
          <div className="context-card-body border-top">
            <div className="context-fields-grid">
              <div className="context-field-item">
                <label className="context-field-label">Buffer (tokens)</label>
                <input
                  className="input"
                  type="number"
                  min={1000}
                  value={compaction.buffer ?? ''}
                  placeholder={auto('buffer')}
                  onChange={e => setComp({ buffer: numOrUndefined(e.target.value) })}
                />
                <span className="context-field-hint">Tokens reserved before compaction triggers.</span>
              </div>

              <div className="context-field-item">
                <label className="context-field-label">Keep recent tokens</label>
                <input
                  className="input"
                  type="number"
                  min={1000}
                  value={compaction.keepTokens ?? ''}
                  placeholder={auto('keepTokens')}
                  onChange={e => setComp({ keepTokens: numOrUndefined(e.target.value) })}
                />
                <span className="context-field-hint">Recent tokens kept verbatim during compaction.</span>
              </div>

              <div className="context-field-item">
                <label className="context-field-label">Tail turns</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={compaction.tailTurns}
                  onChange={e => setComp({ tailTurns: num(e.target.value, compaction.tailTurns) })}
                />
                <span className="context-field-hint">Recent turns kept verbatim during compaction.</span>
              </div>

              <div className="context-field-item">
                <label className="context-field-label">Tool output max chars</label>
                <input
                  className="input"
                  type="number"
                  min={100}
                  value={compaction.toolOutputMaxChars ?? ''}
                  placeholder={auto('toolOutputMaxChars')}
                  onChange={e => setComp({ toolOutputMaxChars: numOrUndefined(e.target.value) })}
                />
                <span className="context-field-hint">Tool results sent to model truncated to chars.</span>
              </div>

              <div className="context-field-item">
                <label className="context-field-label">Tool output max bytes</label>
                <input
                  className="input"
                  type="number"
                  min={1000}
                  value={toolOutput.maxBytes}
                  onChange={e => setToolOutput({ maxBytes: num(e.target.value, toolOutput.maxBytes) })}
                />
                <span className="context-field-hint">Threshold for writing tool output preview file.</span>
              </div>

              <div className="context-field-item">
                <label className="context-field-label">Tool output max lines</label>
                <input
                  className="input"
                  type="number"
                  min={100}
                  value={toolOutput.maxLines}
                  onChange={e => setToolOutput({ maxLines: num(e.target.value, toolOutput.maxLines) })}
                />
                <span className="context-field-hint">Maximum lines kept in tool-result preview.</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
