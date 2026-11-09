import { useCallback, useEffect, useMemo, useState } from 'react'
import { Code, ExternalLink, Globe, MoreHorizontal, RotateCw, X } from 'lucide-react'
import type { BrowserTabInfo } from '@shared/browser-types'
import BaseDropdown from '../common/BaseDropdown'
import PanelHeader from '../common/PanelHeader'
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
  const [moreOpen, setMoreOpen] = useState(false)
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
      <PanelHeader
        ariaLabel="Browser tabs"
        activeId={activeTab ? String(activeTab.id) : null}
        onSelect={(id) => handleActivate(Number(id))}
        addLabel="New tab"
        onAdd={handleCreate}
        full={full}
        onToggleFull={onToggleFull}
        closeLabel="Close Browser"
        onClose={onClose}
        tabs={tabs.map(tab => {
          const agentOwned = tab.control === 'agent' || tab.control === 'approval'
          return {
            id: String(tab.id),
            className: 'browser-tab',
            title: tabTitle(tab),
            lead: agentOwned
              ? <span className="browser-tab-dot agent" role="img" aria-label="Meow is using this tab" />
              : <Globe size={14} aria-hidden="true" />,
            label: tabTitle(tab),
            closeLabel: `Close ${tabTitle(tab)}`,
            onClose: () => handleClose(tab.id),
            onContextMenu: (e) => {
              e.preventDefault()
              setTabMenu({ tabId: tab.id, x: e.clientX, y: e.clientY })
            }
          }
        })}
        actions={(
          <>
            <button
              className={`icon-btn${drawerOpen ? ' active' : ''}`}
              title="Console and network"
              aria-label="Console and network"
              aria-pressed={drawerOpen}
              onClick={() => setDrawerOpen(v => !v)}
            >
              <Code size={14} aria-hidden="true" />
            </button>
            <BaseDropdown
              open={moreOpen}
              onOpenChange={setMoreOpen}
              placement="bottom-end"
              menuClassName="sidebar-menu-dropdown"
              trigger={(
                <button className="icon-btn" title="More" aria-label="Browser menu">
                  <MoreHorizontal size={14} aria-hidden="true" />
                </button>
              )}
            >
              <button
                className="menu-item"
                disabled={!activeTab || !/^https?:/i.test(activeTab.url)}
                onClick={() => {
                  setMoreOpen(false)
                  handleOpenExternal()
                }}
              >
                <ExternalLink size={16} aria-hidden="true" />
                Open in default browser
              </button>
            </BaseDropdown>
          </>
        )}
      />

      {activeTab && (
        <BrowserToolbar
          tab={activeTab}
          locked={locked}
          onBack={handleBack}
          onForward={handleForward}
          onReloadOrStop={handleReloadOrStop}
          onNavigate={handleNavigate}
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
