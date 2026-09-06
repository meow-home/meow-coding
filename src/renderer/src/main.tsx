import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import FileViewer from './components/FileViewer'
import GitViewer from './components/git/GitViewer'
import '@fontsource-variable/instrument-sans'
import '@fontsource-variable/bricolage-grotesque'
import './styles.css'
import { applyTheme, watchTheme } from './theme'
import { applyFontSize, watchFontSize } from './font'
import type { LogLevel } from '@shared/types'
import { formatConsoleArgs } from '@shared/log-helpers'

// Every renderer (main window, Git viewer, FileViewer popup) applies the
// persisted theme before first paint, and re-applies it when the user toggles
// the theme in the main window (localStorage syncs across same-origin windows).
applyTheme()
watchTheme()

// Applied before first paint so popups (Git viewer / FileViewer) inherit the
// persisted font size, and re-applied when the main window changes it.
applyFontSize()
watchFontSize()

function patchConsoleLogging(): void {
  if (!window.api) return
  // Guard against HMR re-execution: every dev module reload re-runs this module,
  // which would otherwise re-wrap console.* and fire duplicate IPC writes per call.
  const g = console as unknown as { __meowSystemLogPatched?: boolean }
  if (g.__meowSystemLogPatched) return
  g.__meowSystemLogPatched = true
  const levelOf: Record<'log' | 'info' | 'warn' | 'error', LogLevel> = {
    log: 'INFO', info: 'INFO', warn: 'WARN', error: 'ERROR'
  }
  // Console methods are typed read-only, so assign through a looser record
  // (same pattern as the main process) while preserving the original `this`.
  const c = console as unknown as Record<string, (...args: unknown[]) => void>
  for (const name of ['log', 'info', 'warn', 'error'] as const) {
    const original = c[name].bind(console)
    c[name] = (...args: unknown[]) => {
      original(...args)
      // printf substitution (React/devtools log '%s' format strings): without
      // it a render error like "An error occurred in the <X> component" would
      // hide the actual exception text, so the real stack is lost.
      const message = formatConsoleArgs(args)
      void window.api.writeSystemLog(levelOf[name], message || name).catch(() => {})
    }
  }
}

// Exceptions React can't route to an error boundary still reach the window;
// log them with full stacks so the daily log records the true failure even
// when the boundary did not (or could not) catch it. Guarded against HMR
// re-registration like patchConsoleLogging above.
const g2 = window as unknown as { __meowUncaughtPatched?: boolean }
if (!window.api || !g2.__meowUncaughtPatched) {
  g2.__meowUncaughtPatched = true
  window.addEventListener('error', (event) => {
    const err = event.error ?? event.message
    void window.api.writeSystemLog('ERROR', `window error: ${formatConsoleArgs([err instanceof Error ? err.stack ?? err.message : err])}`).catch(() => {})
  })
  window.addEventListener('unhandledrejection', (event) => {
    const err = event.reason
    const text = err instanceof Error ? (err.stack ?? err.message) : formatConsoleArgs([err])
    void window.api.writeSystemLog('ERROR', `unhandledrejection: ${text}`).catch(() => {})
    // Swallow so Electron devtools does not additionally spam stderr; the log
    // line above is the record.
    event.preventDefault()
  })
}

patchConsoleLogging()

const rootEl = document.getElementById('root')!
const params = new URLSearchParams(window.location.search)
const fileParam = params.get('file')
const rootParam = params.get('root') ?? ''
const gitParam = params.get('git')

if (!window.api) {
  createRoot(rootEl).render(
    <div className="empty-state">
      <p className="subtitle">
        Preload is not loaded (window.api is missing). Close any old Electron windows still running,
        then run <code>npm run dev</code> again.
      </p>
    </div>
  )
} else if (fileParam) {
  // File-viewer popup window (opened by main via ?file=...&root=...).
  createRoot(rootEl).render(
    <React.StrictMode>
      <FileViewer path={fileParam} root={rootParam} />
    </React.StrictMode>
  )
} else if (gitParam) {
  // Git viewer popup window (opened by main via ?git=<projectPath>).
  createRoot(rootEl).render(
    <React.StrictMode>
      <GitViewer projectPath={gitParam} />
    </React.StrictMode>
  )
} else {
  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
