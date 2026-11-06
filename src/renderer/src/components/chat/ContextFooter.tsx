import { memo, useCallback, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { contextLevel, contextPercent } from '@shared/usage'
import type { ContextSection } from '@shared/types'
import BaseDropdown from '../common/BaseDropdown'

interface Props {
  tokens: number | null
  limit: number | null
  compactThreshold: number | null
  cost: number
  sessionTokens?: { input: number; output: number } | null
  /** Estimated composition of the next request (see agent/context-report.ts). */
  sections?: ContextSection[]
  /** Called when the panel opens, so the breakdown reflects the transcript as it is now. */
  onOpen?: () => void
}

// Ring geometry — kept in sync with .context-ring in styles.css.
const SIZE = 16
const STROKE = 2
const R = (SIZE - STROKE) / 2
const C = 2 * Math.PI * R

function formatPercent(tokens: number, limit: number | null): string {
  if (!limit || limit <= 0) return ''
  const pct = (tokens / limit) * 100
  return pct > 0 && pct < 0.1 ? '<0.1%' : `${pct.toFixed(1)}%`
}

export default memo(function ContextFooter({ tokens, limit, compactThreshold, cost, sessionTokens, sections, onOpen }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const pctUsed = tokens === null ? null : contextPercent(tokens, limit)
  const remaining = pctUsed === null ? null : Math.max(0, 100 - pctUsed)
  const level = tokens === null ? 'normal' : contextLevel(tokens, compactThreshold)
  // Arc reflects how much context is left; depletes as the session fills up.
  const dashOffset = remaining === null ? C : C * (1 - remaining / 100)

  const rows = sections ?? []
  const estimatedTotal = rows.reduce((total, row) => total + row.tokens, 0)
  const used = tokens ?? (estimatedTotal > 0 ? estimatedTotal : null)
  const free = limit && used !== null ? Math.max(0, limit - used) : null
  // The bar always runs from 0 to the window limit: the estimated sections are
  // stretched (or shrunk) to fill exactly the used span, so the bar ends where
  // the provider-reported count does instead of leaving an unexplained gap.
  // Row numbers stay the raw estimates.
  const barScale = estimatedTotal > 0 && used !== null ? used / estimatedTotal : 1
  const bars = limit && used !== null
    ? [
        ...rows.map(row => ({ kind: row.kind, pct: ((row.tokens * barScale) / limit) * 100 })),
        ...(free !== null ? [{ kind: 'free', pct: (free / limit) * 100 }] : [])
      ]
    : []

  const handleOpenChange = useCallback((open: boolean) => {
    if (open) onOpen?.()
  }, [onOpen])

  const toggleRow = useCallback((label: string) => {
    setExpanded(current => ({ ...current, [label]: !current[label] }))
  }, [])

  return (
    <BaseDropdown
      placement="top-end"
      offset={8}
      containerClassName="context-footer-wrap"
      menuClassName="context-panel"
      onOpenChange={handleOpenChange}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          className={`context-ring ${level}`}
          onClick={toggle}
          aria-expanded={open}
          aria-label={remaining === null ? 'Context usage' : `Context ${remaining}% remaining`}
          title="Context usage"
        >
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
            <circle className="context-ring-track" cx={SIZE / 2} cy={SIZE / 2} r={R} strokeWidth={STROKE} fill="none" />
            {remaining !== null && (
              <circle
                className="context-ring-arc"
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                strokeWidth={STROKE}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={dashOffset}
                transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              />
            )}
          </svg>
        </button>
      )}
    >
      <div className="context-panel-body">
        <div className="context-popover-row">
          <span className="context-popover-label">context</span>
          {tokens === null ? (
            <span className="context-popover-dim">—</span>
          ) : (
            <>
              <span>{tokens.toLocaleString()}</span>
              {remaining !== null && <span className="context-popover-dim">({remaining}% left)</span>}
            </>
          )}
        </div>
        {sessionTokens && (
          <div className="context-popover-row">
            <span className="context-popover-label">tokens</span>
            <span className="context-popover-tokens">
              {sessionTokens.input.toLocaleString()} in / {sessionTokens.output.toLocaleString()} out
            </span>
          </div>
        )}
        {cost > 0 && (
          <div className="context-popover-row">
            <span className="context-popover-label">cost</span>
            <span>${cost.toFixed(4)}</span>
          </div>
        )}

        {rows.length > 0 && (
          <div className="context-breakdown">
            <div className="context-breakdown-head">
              <span className="context-popover-label">breakdown</span>
              <span className="context-popover-dim">
                {estimatedTotal.toLocaleString()} estimated
              </span>
            </div>
            {bars.length > 0 && (
              <div className="context-bar" role="img" aria-label="Context composition">
                {bars.map(bar => (
                  <span
                    key={bar.kind}
                    className={`context-bar-seg ctx-${bar.kind}`}
                    style={{ flexGrow: bar.pct }}
                  />
                ))}
              </div>
            )}
            <div className="context-breakdown-rows">
              {rows.map(row => {
                const isOpen = expanded[row.label] === true
                const hasItems = Boolean(row.items && row.items.length > 0)
                return (
                  <div key={row.label} className="context-section">
                    {hasItems ? (
                      <button
                        type="button"
                        className="context-section-head"
                        onClick={() => toggleRow(row.label)}
                        aria-expanded={isOpen}
                      >
                        <ChevronRight className="context-section-caret" size={12} aria-hidden="true" />
                        <span className={`context-section-dot ctx-${row.kind}`} aria-hidden="true" />
                        <span className="context-section-label">{row.label}</span>
                        <span className="context-section-count">{row.items!.length}</span>
                        <span className="context-section-tokens">{row.tokens.toLocaleString()}</span>
                        <span className="context-section-pct">{formatPercent(row.tokens, limit)}</span>
                      </button>
                    ) : (
                      <div className="context-section-head static">
                        <span className="context-section-caret-space" aria-hidden="true" />
                        <span className={`context-section-dot ctx-${row.kind}`} aria-hidden="true" />
                        <span className="context-section-label">{row.label}</span>
                        <span className="context-section-tokens">{row.tokens.toLocaleString()}</span>
                        <span className="context-section-pct">{formatPercent(row.tokens, limit)}</span>
                      </div>
                    )}
                    {hasItems && isOpen && (
                      <div className="context-section-items">
                        {row.items!.map(item => (
                          <div key={item.label} className="context-section-item">
                            <span className="context-item-label" title={item.label}>{item.label}</span>
                            <span className="context-section-tokens">{item.tokens.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
              {free !== null && (
                <div className="context-section-head static context-free">
                  <span className="context-section-caret-space" aria-hidden="true" />
                  <span className="context-section-dot ctx-free" aria-hidden="true" />
                  <span className="context-section-label">Free space</span>
                  <span className="context-section-tokens">{free.toLocaleString()}</span>
                  <span className="context-section-pct">{formatPercent(free, limit)}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </BaseDropdown>
  )
})
