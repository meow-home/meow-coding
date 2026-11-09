import { useCallback, useEffect, useMemo, useState } from 'react'
import { Code, Globe, Maximize2, Minimize2, Plus, RotateCw, X } from 'lucide-react'
import type { BrowserTabInfo } from '@shared/browser-types'
import BaseDropdown from '../common/BaseDropdown'
import BrowserControlBanner from './BrowserControlBanner'
import BrowserToolbar from './BrowserToolbar'
import BrowserDrawer from './BrowserDrawer'
import BrowserViewport from './BrowserViewport'

interface Props {
  agentId: string
  full: boolean
  onToggleFull: () => void
  onClose: () => void
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

function tabTitle(tab: BrowserTabInfo): string {
  return tab.title || hostOf(tab.url) || 'New tab'
}

export default function BrowserOverlay({ agentId, full, onToggleFull, onClose }: Props) {
  const [tabs, setTabs] = useState<BrowserTabInfo[]>([])
  const [activeTabId, setActiveTabId] = useState<number | null>(null)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [tabMenu, setTabMenu] = useState<{ tabId: number; x: number; y: number } | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const onError = useCallback((message: string) => setInlineError(message), [])

  useEffect(() => {
    let active = true
    setInlineError(null)
    window.api.browserTabsList(agentId)
      .then((list) => {
        if (!active) return
        setTabs(list)
        setActiveTabId(prev => (prev != null && list.some(t => t.id === prev) ? prev : (list[0]?.id ?? null)))
      })
      .catch(err => {
        if (active) onError(err instanceof Error ? err.message : String(err))
      })
    const unlisten = window.api.onBrowserTabsChanged((event) => {
      if (!active || event.agentId !== agentId) return
      setTabs(event.tabs)
      setActiveTabId(prev => {
        if (event.activeTabId != null) return event.activeTabId
        return prev != null && event.tabs.some(t => t.id === prev) ? prev : (event.tabs[0]?.id ?? null)
      })
    })
    return () => {
      active = false
      unlisten()
    }
  }, [agentId, onError])

  const activeTab = useMemo(
    () => tabs.find(t => t.id === activeTabId) ?? tabs[0] ?? null,
    [tabs, activeTabId]
  )

  const run = useCallback((action: () => Promise<unknown>) => {
    setInlineError(null)
    void action().catch(err => setInlineError(err instanceof Error ? err.message : String(err)))
  }, [])

  const handleCreate = useCallback(() => {
    run(async () => {
      const created = await window.api.browserTabCreate(agentId)
      setActiveTabId(created.id)
    })
  }, [agentId, run])

  const handleActivate = useCallback((tabId: number) => {
    setActiveTabId(tabId)
    run(() => window.api.browserTabActivate(agentId, tabId))
  }, [agentId, run])

  const handleClose = useCallback((tabId: number) => {
    setTabMenu(null)
    run(() => window.api.browserTabClose(tabId))
  }, [run])

  const handleCloseOthers = useCallback((tabId: number) => {
    setTabMenu(null)
    for (const tab of tabs) {
      if (tab.id !== tabId) run(() => window.api.browserTabClose(tab.id))
    }
  }, [run, tabs])

  const handleReload = useCallback((tabId: number) => {
    setTabMenu(null)
    run(() => window.api.browserTabHistory(tabId, 'reload'))
  }, [run])

  const handleBack = useCallback(() => {
    if (activeTab) run(() => window.api.browserTabHistory(activeTab.id, 'back'))
  }, [activeTab, run])

  const handleForward = useCallback(() => {
    if (activeTab) run(() => window.api.browserTabHistory(activeTab.id, 'forward'))
  }, [activeTab, run])

  const handleReloadOrStop = useCallback(() => {
    if (!activeTab) return
    run(() => window.api.browserTabHistory(activeTab.id, activeTab.loading ? 'stop' : 'reload'))
  }, [activeTab, run])

  const handleNavigate = useCallback((url: string) => {
    if (!activeTab) return
    run(() => window.api.browserTabNavigate(activeTab.id, url))
  }, [activeTab, run])

  const handleOpenExternal = useCallback(() => {
    if (activeTab && /^https?:/i.test(activeTab.url)) {
      run(() => window.api.browserOpenExternal(activeTab.url))
    }
  }, [activeTab, run])

  const handleTakeOver = useCallback(() => {
    if (activeTab) run(() => window.api.browserTakeOver(activeTab.id))
  }, [activeTab, run])

  const handleHandBack = useCallback(() => {
    if (activeTab) run(() => window.api.browserHandBack(activeTab.id))
  }, [activeTab, run])

  const handleReloadCrash = useCallback(() => {
    if (!activeTab) return
    // loadUrl is what re-enables the debugger after a crash; history reload is not enough.
    run(async () => {
      await window.api.browserTabNavigate(activeTab.id, activeTab.url)
      await window.api.browserPanelUnfreeze()
    })
  }, [activeTab, run])

  const locked = activeTab?.control === 'agent' || activeTab?.control === 'approval'

  return (
    <section className={`files-overlay browser-overlay${full ? ' full' : ' docked'}`} role="dialog" aria-label="Browser">
      <div className="files-head title-bar">
        <div className="files-head-title">
          <Globe size={14} aria-hidden="true" />
          <span>Browser</span>
        </div>
        <div className="files-head-actions">
          <button className="icon-btn" title="New tab" aria-label="New tab" onClick={handleCreate}>
            <Plus size={14} aria-hidden="true" />
          </button>
          <button
            className="icon-btn"
            title="Console and network"
            aria-label="Console and network"
            aria-pressed={drawerOpen}
            onClick={() => setDrawerOpen(open => !open)}
          >
            <Code size={14} aria-hidden="true" />
          </button>
          <button
            className="icon-btn"
            title={full ? 'Restore size' : 'Expand'}
            aria-label={full ? 'Restore size' : 'Expand'}
            onClick={onToggleFull}
          >
            {full ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
          </button>
          <button className="icon-btn" title="Close" aria-label="Close Browser" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      {tabs.length > 0 && (
        <div className="files-tabs" role="tablist" aria-label="Browser tabs">
          {tabs.map(tab => {
            const isSelected = tab.id === activeTab?.id
            const agentOwned = tab.control === 'agent' || tab.control === 'approval'
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={isSelected}
                className={`files-tab browser-tab${isSelected ? ' active' : ''}`}
                onClick={() => handleActivate(tab.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setTabMenu({ tabId: tab.id, x: e.clientX, y: e.clientY })
                }}
              >
                <span
                  className={`browser-tab-dot${agentOwned ? ' agent' : ''}`}
                  role="img"
                  aria-label={agentOwned ? 'Meow is using this tab' : 'idle'}
                />
                <span className="files-tab-name" title={tabTitle(tab)}>{tabTitle(tab)}</span>
                <button
                  className="files-tab-close"
                  aria-label={`Close ${tabTitle(tab)}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleClose(tab.id)
                  }}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {activeTab && (
        <BrowserToolbar
          tab={activeTab}
          locked={locked}
          onBack={handleBack}
          onForward={handleForward}
          onReloadOrStop={handleReloadOrStop}
          onNavigate={handleNavigate}
          onOpenExternal={handleOpenExternal}
          onError={onError}
        />
      )}

      {activeTab && (
        <BrowserControlBanner
          control={activeTab.control}
          holdReason={activeTab.holdReason}
          onTakeOver={handleTakeOver}
          onHandBack={handleHandBack}
        />
      )}

      {inlineError && (
        <div className="terminal-error-bar" role="alert">
          <span className="terminal-error-text">{inlineError}</span>
          <button className="icon-btn" onClick={() => setInlineError(null)} aria-label="Dismiss error">
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      )}

      <BrowserViewport
        agentId={agentId}
        tab={activeTab}
        onNewTab={handleCreate}
        onReloadCrash={handleReloadCrash}
        onError={onError}
      />

      {drawerOpen && <BrowserDrawer agentId={agentId} tab={activeTab} />}

      <BaseDropdown
        menuClassName="sidebar-menu-dropdown"
        open={Boolean(tabMenu)}
        onOpenChange={(open) => {
          if (!open) setTabMenu(null)
        }}
        anchorPoint={tabMenu ? { x: tabMenu.x, y: tabMenu.y } : undefined}
      >
        {tabMenu && (
          <>
            <button className="menu-item" onClick={() => handleClose(tabMenu.tabId)}>
              <X size={16} aria-hidden="true" />
              Close
            </button>
            <button className="menu-item" onClick={() => handleCloseOthers(tabMenu.tabId)}>
              <X size={16} aria-hidden="true" />
              Close others
            </button>
            <button className="menu-item" onClick={() => handleReload(tabMenu.tabId)}>
              <RotateCw size={16} aria-hidden="true" />
              Reload
            </button>
          </>
        )}
      </BaseDropdown>
    </section>
  )
}
