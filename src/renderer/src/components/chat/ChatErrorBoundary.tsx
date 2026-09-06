import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { formatConsoleArgs } from '@shared/log-helpers'

interface Props {
  agentId: string
  children: ReactNode
}

interface State {
  error: Error | null
  // Bumped on retry so the children tree is fully remounted (ChatPanel rebuilds
  // its state from the stored transcript instead of resuming on stale data).
  resetKey: number
}

// A render/lifecycle error inside the chat pane used to unmount the entire
// React root: with no error boundary, React tears the app down and the window
// goes black and unresponsive. This boundary contains that failure to the chat
// pane — the sidebar/settings/tray stay alive — and surfaces the exception
// with its full stack to the system log for diagnosis.
class ChatErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const detail = formatConsoleArgs([error.stack ?? error.message, `\ncomponentStack: ${info.componentStack ?? ''}`])
    void window.api.writeSystemLog('ERROR', `ChatPanel render error (agent=${this.props.agentId}): ${detail}`).catch(() => {})
  }

  private handleRetry = (): void => {
    this.setState(prev => ({ error: null, resetKey: prev.resetKey + 1 }))
  }

  private copyError = (): void => {
    const error = this.state.error
    if (!error) return
    void navigator.clipboard.writeText(formatConsoleArgs([error.stack ?? error.message])).catch(() => {})
  }

  render(): ReactNode {
    if (this.state.error) {
      const detail = this.state.error.stack ?? this.state.error.message ?? String(this.state.error)
      return (
        <div className="chat-error-boundary">
          <div className="chat-error-boundary-title">The chat view hit an unexpected error.</div>
          <div className="chat-error-boundary-detail">{detail}</div>
          <div className="chat-error-boundary-actions">
            <button className="btn small" onClick={this.handleRetry}>Reload chat view</button>
            <button className="btn small" onClick={this.copyError}>Copy error</button>
          </div>
        </div>
      )
    }
    // display: contents keeps the boundary host from affecting layout while the
    // key change still forces a full remount of the chat tree on retry.
    return <div key={this.state.resetKey} className="chat-error-boundary-host">{this.props.children}</div>
  }
}

export default ChatErrorBoundary
