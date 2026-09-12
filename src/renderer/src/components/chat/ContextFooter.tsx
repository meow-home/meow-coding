import { memo } from 'react'
import { contextLevel, contextPercent } from '@shared/usage'

interface Props {
  tokens: number | null
  limit: number | null
  compactThreshold: number | null
  cost: number
  sessionTokens?: { input: number; output: number } | null
}

// Ring geometry — kept in sync with .context-ring in styles.css.
const SIZE = 20
const STROKE = 2.5
const R = (SIZE - STROKE) / 2
const C = 2 * Math.PI * R

export default memo(function ContextFooter({ tokens, limit, compactThreshold, cost, sessionTokens }: Props) {
  const pctUsed = tokens === null ? null : contextPercent(tokens, limit)
  const remaining = pctUsed === null ? null : Math.max(0, 100 - pctUsed)
  const level = tokens === null ? 'normal' : contextLevel(tokens, compactThreshold)
  // Arc reflects how much context is left; depletes as the session fills up.
  const dashOffset = remaining === null ? C : C * (1 - remaining / 100)

  return (
    <div className="context-footer-wrap">
      <div className={`context-ring ${level}`} role="img" aria-label={remaining === null ? 'Context' : `Context ${remaining}% remaining`}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
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
      </div>
      <div className="context-footer-popover" role="tooltip">
        <div className="context-popover-row">
          <span className="context-popover-label">context</span>
          {tokens === null ? (
            <span className="context-popover-dim">—</span>
          ) : (
            <>
              <span>{tokens.toLocaleString()}</span>
              {pctUsed !== null && <span className="context-popover-dim">({remaining}% left)</span>}
            </>
          )}
        </div>
        {level === 'danger' && (
          <div className="context-popover-row">
            <span className="context-footer-note">· compacting soon</span>
          </div>
        )}
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
      </div>
    </div>
  )
})
