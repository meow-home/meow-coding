# BaseModal Component & Modal Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable `BaseModal` primitive in `src/renderer/src/components/common/BaseModal.tsx` and refactor existing dialogs across the renderer process to use it.

**Architecture:** Create `BaseModal` portaling to `document.body` with Escape key handling, backdrop click behavior, ARIA accessibility features, and standard styling modifiers. Migrate 7 existing modal/dialog components to wrap `BaseModal`, eliminating redundant backdrop and portal logic. Exclude `GitViewer.tsx` per design spec.

**Tech Stack:** React 19, TypeScript (strict), Vitest (unit/integration testing), Electron 41.

## Global Constraints

- **Portal Target:** Always portal to `document.body`.
- **Keyboard Handling:** Escape key closes modal when `closeOnEscape` is true (default).
- **Backdrop Handling:** Backdrop click closes modal when `closeOnBackdropClick` is true (default).
- **Documentation Sync:** Update `AGENTS.md` and `docs/reference/` files when changing components.
- **Git Commit Rules:** No `Co-Authored-By` trailer in commit messages.

---

### Task 1: Create `BaseModal` Component, Styles, and Unit Tests

**Files:**
- Create: `src/renderer/src/components/common/BaseModal.tsx`
- Create: `src/renderer/src/components/common/BaseModal.test.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/components/common/AGENTS.md`

**Interfaces:**
```typescript
import { ReactNode } from 'react'

export interface BaseModalProps {
  title?: ReactNode
  onClose?: () => void
  children: ReactNode
  actions?: ReactNode
  showCloseButton?: boolean
  closeOnBackdropClick?: boolean
  closeOnEscape?: boolean
  size?: 'sm' | 'md' | 'lg' | 'xl'
  role?: 'dialog' | 'alertdialog'
  className?: string
  backdropClassName?: string
}
```

- [ ] **Step 1: Add dialog size modifier classes to styles.css**

Add the size modifier classes to `src/renderer/src/styles.css`:
```css
.dialog.dialog-sm { width: 28rem; }
.dialog.dialog-md { width: 35rem; }
.dialog.dialog-lg { width: 45rem; }
.dialog.dialog-xl { width: 55rem; }
```

- [ ] **Step 2: Create BaseModal.tsx**

Create `src/renderer/src/components/common/BaseModal.tsx`:
```tsx
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface BaseModalProps {
  title?: ReactNode
  onClose?: () => void
  children: ReactNode
  actions?: ReactNode
  showCloseButton?: boolean
  closeOnBackdropClick?: boolean
  closeOnEscape?: boolean
  size?: 'sm' | 'md' | 'lg' | 'xl'
  role?: 'dialog' | 'alertdialog'
  className?: string
  backdropClassName?: string
}

export default function BaseModal({
  title,
  onClose,
  children,
  actions,
  showCloseButton = true,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  size = 'md',
  role = 'dialog',
  className = '',
  backdropClassName = ''
}: BaseModalProps) {
  useEffect(() => {
    if (!closeOnEscape || !onClose) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeOnEscape, onClose])

  const handleBackdropClick = () => {
    if (closeOnBackdropClick && onClose) {
      onClose()
    }
  }

  const dialogClasses = ['dialog', `dialog-${size}`, className].filter(Boolean).join(' ')
  const backdropClasses = ['dialog-backdrop', backdropClassName].filter(Boolean).join(' ')
  const titleId = title ? 'base-modal-title' : undefined

  return createPortal(
    <div className={backdropClasses} onClick={handleBackdropClick}>
      <div
        className={dialogClasses}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
      >
        {title && (
          <h3 id={titleId}>{title}</h3>
        )}
        {showCloseButton && onClose && (
          <button className="dialog-close" aria-label="Close" onClick={onClose}>✕</button>
        )}
        {children}
        {actions && (
          <div className="dialog-actions">
            {actions}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
```

- [ ] **Step 3: Create BaseModal unit test**

Create `src/renderer/src/components/common/BaseModal.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import BaseModal from './BaseModal'

describe('BaseModal', () => {
  it('renders title, children, actions, and portal content in body', () => {
    render(
      <BaseModal title="Test Modal Title" actions={<button>Save</button>}>
        <p>Modal content</p>
      </BaseModal>
    )

    expect(screen.getByText('Test Modal Title')).toBeInTheDocument()
    expect(screen.getByText('Modal content')).toBeInTheDocument()
    expect(screen.getByText('Save')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('triggers onClose when clicking close button', () => {
    const onClose = vi.fn()
    render(
      <BaseModal title="Close Test" onClose={onClose}>
        <p>Content</p>
      </BaseModal>
    )

    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('triggers onClose on Escape key press when enabled', () => {
    const onClose = vi.fn()
    render(
      <BaseModal title="Escape Test" onClose={onClose} closeOnEscape={true}>
        <p>Content</p>
      </BaseModal>
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('triggers onClose on backdrop click when closeOnBackdropClick is true', () => {
    const onClose = vi.fn()
    const { container } = render(
      <BaseModal title="Backdrop Test" onClose={onClose} closeOnBackdropClick={true}>
        <p>Content</p>
      </BaseModal>
    )

    const backdrop = container.parentElement?.querySelector('.dialog-backdrop')
    expect(backdrop).toBeInTheDocument()
    if (backdrop) {
      fireEvent.click(backdrop)
    }
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 4: Update common/AGENTS.md**

Update `src/renderer/src/components/common/AGENTS.md` to document `BaseModal.tsx`.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/common/BaseModal.tsx src/renderer/src/components/common/BaseModal.test.tsx src/renderer/src/styles.css src/renderer/src/components/common/AGENTS.md
git commit -m "feat(ui): add BaseModal common component with size modifiers and unit tests"
```

---

### Task 2: Migrate `ConfirmDialog.tsx` & `settings/Modal.tsx`

**Files:**
- Modify: `src/renderer/src/components/ConfirmDialog.tsx`
- Modify: `src/renderer/src/components/settings/Modal.tsx`

- [ ] **Step 1: Refactor ConfirmDialog.tsx**

Replace `ConfirmDialog.tsx` body with `BaseModal`:
```tsx
import type { ReactNode } from 'react'
import BaseModal from './common/BaseModal'

interface Props {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm(): void
  onCancel(): void
}

export default function ConfirmDialog({
  title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = true, onConfirm, onCancel
}: Props) {
  const actions = (
    <>
      <button className="btn" onClick={onCancel}>{cancelLabel}</button>
      <button className={`btn ${danger ? 'danger' : 'primary'}`} autoFocus onClick={onConfirm}>
        {confirmLabel}
      </button>
    </>
  )

  return (
    <BaseModal
      title={title}
      onClose={onCancel}
      actions={actions}
      role="alertdialog"
      size="sm"
    >
      <p className="settings-hint">{message}</p>
    </BaseModal>
  )
}
```

- [ ] **Step 2: Refactor settings/Modal.tsx**

Replace `settings/Modal.tsx` body with `BaseModal`:
```tsx
import type { ReactNode } from 'react'
import BaseModal from '../common/BaseModal'

interface Props {
  title: string
  onClose(): void
  children: ReactNode
  submitLabel?: string
  onSubmit?(): void
  submitDisabled?: boolean
}

export default function Modal({
  title, onClose, children, submitLabel = 'Save', onSubmit, submitDisabled = false
}: Props) {
  const actions = (
    <>
      <button className="btn" onClick={onClose}>Cancel</button>
      {onSubmit && (
        <button className="btn primary submit" disabled={submitDisabled} onClick={onSubmit}>
          {submitLabel}
        </button>
      )}
    </>
  )

  return (
    <BaseModal
      title={title}
      onClose={onClose}
      actions={actions}
    >
      {children}
    </BaseModal>
  )
}
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/ConfirmDialog.tsx src/renderer/src/components/settings/Modal.tsx
git commit -m "refactor(ui): migrate ConfirmDialog and settings/Modal to BaseModal"
```

---

### Task 3: Migrate `BrowserDialog.tsx` & `InstallGuideDialog.tsx`

**Files:**
- Modify: `src/renderer/src/components/BrowserDialog.tsx`
- Modify: `src/renderer/src/components/InstallGuideDialog.tsx`

- [ ] **Step 1: Refactor BrowserDialog.tsx**

Refactor `BrowserDialog.tsx` to use `BaseModal`:
```tsx
import { useState } from 'react'
import type { BrowserStatusInfo, PairingInfo } from '@shared/browser-types'
import BaseModal from './common/BaseModal'

interface Props {
  status: BrowserStatusInfo | null
  onClose: () => void
}

export default function BrowserDialog({ status, onClose }: Props) {
  const [pairing, setPairing] = useState<PairingInfo | null>(null)

  const pair = async () => {
    setPairing(await window.api.pairBrowser())
  }

  const waiting = !status?.paired && (status?.status === 'listening' || status?.status === 'idle')
  const stateLabel = status?.paired
    ? `paired${status.port ? ` (port ${status.port})` : ''}`
    : waiting
      ? 'waiting for extension'
      : status?.status ?? 'unknown'
  const pillClass = status?.paired ? 'browser-pill-on' : waiting ? 'browser-pill-waiting' : 'browser-pill-off'

  const titleNode = (
    <div className="browser-hd">
      <h3>Browser Bridge</h3>
      <span className={`browser-pill ${pillClass}`}>
        ● {stateLabel}
      </span>
    </div>
  )

  const actionsNode = status?.paired ? (
    <button className="btn" onClick={pair}>New Pairing Code</button>
  ) : undefined

  return (
    <BaseModal
      title={titleNode}
      onClose={onClose}
      actions={actionsNode}
      size="lg"
      className="browser-dialog"
    >
      {status?.paired ? (
        <div className="browser-section">
          <p className="browser-section-label">Connection</p>
          <p className="browser-hint">Extension is paired and ready.</p>
        </div>
      ) : (
        <>
          <div className="browser-section">
            <p className="browser-section-label">Setup</p>
            <p className="browser-hint">
              Install the extension in Chrome, then pair it with a one-time code.
            </p>
            <div className="row">
              <button className="btn" onClick={() => void window.api.openBrowserInstallGuide()}>Open Install Guide</button>
              <button className="btn" onClick={() => void window.api.openBrowserExtensionFolder()}>Extension Folder</button>
            </div>
          </div>
          <div className="browser-section">
            <p className="browser-section-label">Pairing</p>
            {pairing ? (
              <div className="browser-pairing">
                <span className="browser-code">{pairing.code}</span>
                <span className="browser-hint">Expires {new Date(pairing.expiresAt).toLocaleTimeString()}</span>
              </div>
            ) : (
              <div className="browser-pairing-cta">
                <button className="btn primary" onClick={pair}>Pair With Code</button>
              </div>
            )}
          </div>
        </>
      )}
    </BaseModal>
  )
}
```

- [ ] **Step 2: Refactor InstallGuideDialog.tsx**

Refactor `InstallGuideDialog.tsx` to use `BaseModal`:
```tsx
import { useEffect, useState } from 'react'
import type { BrowserInstallGuideEvent } from '@shared/ipc'
import BaseModal from './common/BaseModal'

interface Props {
  guide: BrowserInstallGuideEvent | null
  onClose: () => void
}

export default function InstallGuideDialog({ guide, onClose }: Props) {
  const [extensionDir, setExtensionDir] = useState<string | null>(guide?.extensionDir ?? null)

  useEffect(() => {
    if (guide) setExtensionDir(guide.extensionDir)
  }, [guide])

  const actionsNode = (
    <>
      <button className="btn" onClick={() => void window.api.openBrowserChromeExtensions()}>Open chrome://extensions</button>
      <button className="btn" onClick={() => void window.api.openBrowserExtensionFolder()}>Extension Folder</button>
    </>
  )

  return (
    <BaseModal
      title="Install Meow Browser Bridge"
      onClose={onClose}
      actions={actionsNode}
      size="lg"
      className="browser-dialog"
    >
      <ol className="browser-guide">
        <li>Click <strong>Open chrome://extensions</strong> — Chrome opens the extensions page.</li>
        <li>Enable <strong>Developer mode</strong> (top-right corner).</li>
        <li>Click <strong>Load unpacked</strong> and select the folder:
          <code className="browser-guide-dir">{extensionDir}</code>
        </li>
        <li>Back in Meow, open the Browser dialog and click <strong>Pair With Code</strong>, then enter the code in the extension popup.</li>
      </ol>
      <p className="browser-hint">
        The extension only connects to Meow on this machine (127.0.0.1) and requires a pairing code.
      </p>
    </BaseModal>
  )
}
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/BrowserDialog.tsx src/renderer/src/components/InstallGuideDialog.tsx
git commit -m "refactor(ui): migrate BrowserDialog and InstallGuideDialog to BaseModal"
```

---

### Task 4: Migrate `UpdateDialog.tsx`, `App.tsx` (`UpToDateDialog`), and `ChatPanel.tsx` (`subagent-live`)

**Files:**
- Modify: `src/renderer/src/components/UpdateDialog.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/chat/ChatPanel.tsx`

- [ ] **Step 1: Refactor UpdateDialog.tsx**

Refactor `UpdateDialog.tsx` to use `BaseModal`:
```tsx
import { useEffect, useState } from 'react'
import type { UpdaterStatusEvent } from '@shared/types'
import MarkdownText from './chat/MarkdownText'
import BaseModal from './common/BaseModal'

interface Props {
  status: UpdaterStatusEvent | null
  onClose: () => void
  onInstall: () => void
}

export default function UpdateDialog({ status, onClose, onInstall }: Props) {
  const [meta, setMeta] = useState<{ version: string; currentVersion?: string; releaseNotes?: string } | null>(null)

  useEffect(() => {
    if (status?.type === 'update-available') {
      setMeta({ version: status.version, currentVersion: status.currentVersion, releaseNotes: status.releaseNotes })
    }
  }, [status])

  if (!status || (status.type !== 'update-available' && status.type !== 'downloaded' && status.type !== 'download-progress')) {
    return null
  }

  const downloading = status.type === 'download-progress'
  const ready = status.type === 'downloaded'
  const version = status.type === 'downloaded' ? status.version : status.type === 'update-available' ? status.version : meta?.version
  const currentVersion = status.type === 'update-available' ? status.currentVersion : meta?.currentVersion
  const releaseNotes = status.type === 'update-available' ? status.releaseNotes : meta?.releaseNotes

  const actionsNode = (
    <>
      <button className="btn" onClick={onClose} disabled={downloading}>Later</button>
      <button className="btn primary" onClick={onInstall} disabled={downloading}>
        {ready ? 'Restart now' : 'Update & Restart'}
      </button>
    </>
  )

  return (
    <BaseModal
      title={ready ? 'Update ready' : 'Update available'}
      onClose={onClose}
      actions={actionsNode}
      size="lg"
      className="update-dialog"
      closeOnBackdropClick={!downloading}
      closeOnEscape={!downloading}
    >
      {version && (
        <p className="update-version">
          {currentVersion ? `v${currentVersion} → v${version}` : `v${version}`}
        </p>
      )}
      {releaseNotes && (
        <div className="update-changelog">
          <MarkdownText text={releaseNotes} />
        </div>
      )}
      {downloading && (
        <>
          <div className="update-progress-track">
            <div className="update-progress-fill" style={{ width: `${status.percent}%` }} />
          </div>
          <div className="update-progress-label">{status.percent}%</div>
        </>
      )}
    </BaseModal>
  )
}
```

- [ ] **Step 2: Refactor UpToDateDialog in App.tsx**

In `src/renderer/src/App.tsx`, update `UpToDateDialog` to use `BaseModal`:
```tsx
import BaseModal from './components/common/BaseModal'

function UpToDateDialog({ version, onClose }: { version?: string; onClose: () => void }) {
  return (
    <BaseModal
      title="Update"
      onClose={onClose}
      size="sm"
      actions={<button className="btn" onClick={onClose}>Close</button>}
    >
      <p className="settings-hint">
        This is the latest version{version ? ` (v${version})` : ''}.
      </p>
    </BaseModal>
  )
}
```

- [ ] **Step 3: Refactor subagent live dialog in ChatPanel.tsx**

In `src/renderer/src/components/chat/ChatPanel.tsx`, import `BaseModal` from `../common/BaseModal` and replace the subagent live popup container:

```tsx
      {liveTaskId && (() => {
        const live = items.find(i => i.kind === 'subagent' && i.taskId === liveTaskId) as FeedItem & { kind: 'subagent' } | undefined
        if (!live) return null
        return (
          <BaseModal
            title={`sub-agent${live.subagentType ? ` (${live.subagentType})` : ''}${live.background ? ' · background' : ''}`}
            onClose={() => setLiveTaskId(null)}
            className="subagent-live"
            closeOnBackdropClick={false}
          >
            <div className="subagent-live-state">
              <span className={`subagent-state state-${live.state}`}>{live.state}</span>
              {live.tools.length > 0 && live.tools.map(t => <code key={t}>{t}</code>)}
            </div>
            {live.reasoning && <details className="chat-reasoning"><summary>Thinking</summary><div className="chat-reasoning-text">{live.reasoning}</div></details>}
            <div className="subagent-live-text">{live.text || (live.state === 'running' ? '…' : '')}</div>
            {live.result && <div className="subagent-live-result">{live.result}</div>}
          </BaseModal>
        )
      })()}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/UpdateDialog.tsx src/renderer/src/App.tsx src/renderer/src/components/chat/ChatPanel.tsx
git commit -m "refactor(ui): migrate UpdateDialog, UpToDateDialog, and ChatPanel subagent live popup to BaseModal"
```

---

### Task 5: Documentation Sync & System Reference Update

**Files:**
- Modify: `src/renderer/src/components/AGENTS.md`
- Modify: `docs/reference/09-ui-architecture.md` (or relevant reference doc under `docs/reference/`)

- [ ] **Step 1: Update src/renderer/src/components/AGENTS.md**

Add `BaseModal.tsx` under common components table in `src/renderer/src/components/AGENTS.md` or `src/renderer/src/components/common/AGENTS.md`.

- [ ] **Step 2: Update reference documentation**

Update `docs/reference/` if modal/dialog patterns are described.

- [ ] **Step 3: Run full verification suite**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/AGENTS.md docs/
git commit -m "docs: update system reference and AGENTS.md for BaseModal migration"
```
