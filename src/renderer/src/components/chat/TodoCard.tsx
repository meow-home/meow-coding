import { memo, useState } from 'react'
import { Check, ChevronRight, Circle, Loader2, X } from 'lucide-react'
import type { TodoItem, TodoStatus } from '@shared/types'

function TodoMark({ status }: { status: TodoStatus }) {
  switch (status) {
    case 'completed': return <Check className="chat-todo-mark" aria-hidden="true" />
    case 'in_progress': return <Loader2 className="chat-todo-mark spinning" aria-hidden="true" />
    case 'pending': return <Circle className="chat-todo-mark" aria-hidden="true" />
    case 'cancelled': return <X className="chat-todo-mark" aria-hidden="true" />
  }
}

// The session's todo list as the last transcript row (above a pending prompt),
// scrolling with the feed instead of pinning to the pane. Neutral colours only:
// status is carried by the mark, and the active task spins and pulses.
// Collapsed, the header names the active task so progress stays readable.
function TodoCard({ todos }: { todos: TodoItem[] }) {
  const [collapsed, setCollapsed] = useState(false)
  const done = todos.filter(t => t.status === 'completed' || t.status === 'cancelled').length
  const active = todos.find(t => t.status === 'in_progress')

  return (
    <div className={`chat-todo${collapsed ? ' collapsed' : ''}`}>
      <button
        className="chat-todo-head"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(c => !c)}
      >
        <ChevronRight className="chat-todo-chevron" aria-hidden="true" />
        <span className="chat-todo-title">Tasks</span>
        {collapsed && active && (
          <span className="chat-todo-active">
            <Loader2 className="chat-todo-mark spinning" aria-hidden="true" />
            <span className="chat-todo-text">{active.content}</span>
          </span>
        )}
        <span className="chat-todo-count">{done}/{todos.length}</span>
      </button>
      {!collapsed && (
        <ul className="chat-todo-list">
          {todos.map((t, i) => (
            <li key={i} className={`chat-todo-item status-${t.status}`}>
              <TodoMark status={t.status} />
              <span className="chat-todo-text">{t.content}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default memo(TodoCard)
