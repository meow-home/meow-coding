import { memo, useCallback, useRef, useState } from 'react'
import { CheckCircle2, ChevronDown, Circle, Clock, XCircle } from 'lucide-react'
import type { TodoItem, TodoStatus } from '@shared/types'
import BaseDropdown from '../common/BaseDropdown'

interface TodoPillProps {
  todos: TodoItem[]
}

// Ring geometry — matching ContextFooter circular progress ring
const SIZE = 16
const STROKE = 2
const R = (SIZE - STROKE) / 2
const C = 2 * Math.PI * R

function TodoStatusIcon({ status }: { status: TodoStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={13} style={{ color: 'var(--green)' }} aria-hidden="true" />
    case 'in_progress':
      return <Clock size={13} style={{ color: 'var(--accent-strong)' }} aria-hidden="true" />
    case 'pending':
      return <Circle size={13} style={{ color: 'var(--text-faint)' }} aria-hidden="true" />
    case 'cancelled':
      return <XCircle size={13} style={{ color: 'var(--text-faint)' }} aria-hidden="true" />
  }
}

// Direction 1 (Mission Badge): a compact inline chip seated in the pane header,
// immediately left of the action (⋮) button. It shows an orange TODO tag, a
// progress ring + done/total count, and a pulsing cyan status dot while work
// remains. Clicking opens a dropdown with the full list; the dropdown is capped
// in height and scrolls internally, so a long todo list never grows beyond the
// viewport. Hover uses a short close delay so moving from the pill onto the
// dropdown doesn't flicker it closed.
function TodoPill({ todos }: TodoPillProps) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<number | null>(null)

  const scheduleClose = useCallback(() => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setOpen(false), 180)
  }, [])

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const total = todos.length
  const doneCount = todos.filter(t => t.status === 'completed' || t.status === 'cancelled').length
  const isAllDone = total > 0 && doneCount === total
  const pct = total > 0 ? doneCount / total : 0
  const dashOffset = C * (1 - pct)

  return (
    <div
      className="todo-pill"
      onMouseEnter={() => { cancelClose(); setOpen(true) }}
      onMouseLeave={scheduleClose}
    >
      <BaseDropdown
        open={open}
        onOpenChange={setOpen}
        placement="bottom-end"
        menuClassName="todo-pill-menu"
        trigger={({ open: isOpen, toggle }) => (
          <button
            className={`todo-pill-btn ${isOpen ? 'open' : ''}`}
            title="Todo list"
            aria-label="Todo list"
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            onClick={toggle}
          >
            <span
              className={`todo-pill-ring ${isAllDone ? 'done' : ''}`}
              role="img"
              aria-label={`Progress: ${doneCount} of ${total} completed`}
            >
              <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
                <circle
                  className="todo-pill-ring-track"
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  strokeWidth={STROKE}
                  fill="none"
                />
                {total > 0 && (
                  <circle
                    className="todo-pill-ring-arc"
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
            </span>
            <span className="todo-pill-tag">TODO</span>
            <span className="todo-pill-count">{doneCount}/{total}</span>
            {!isAllDone && <span className="todo-pill-pulse" aria-hidden="true" />}
            <ChevronDown size={12} className="todo-pill-chev" aria-hidden="true" />
          </button>
        )}
      >
        <div
          className="todo-pill-menu-inner"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="todo-pill-head">
            <span className="todo-pill-title">TODO LIST</span>
            <span className="todo-pill-count">{doneCount}/{total}</span>
          </div>
          <ul className="todo-pill-list">
            {todos.map((t, i) => (
              <li key={i} className={`todo-pill-item status-${t.status}`}>
                <span className="todo-pill-mark"><TodoStatusIcon status={t.status} /></span>
                <span className="todo-pill-content">{t.content}</span>
              </li>
            ))}
          </ul>
        </div>
      </BaseDropdown>
    </div>
  )
}

export default memo(TodoPill)
