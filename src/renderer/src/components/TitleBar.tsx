import { useEffect, useState } from 'react'
import { Copy, Minus, PanelLeft, Square, X } from 'lucide-react'
import logoMark from '../assets/logo-mark.png'

function MinimizeIcon() {
  return <Minus size={10} aria-hidden="true" />
}

function MaximizeIcon() {
  return <Square size={10} aria-hidden="true" />
}

function RestoreIcon() {
  return <Copy size={10} aria-hidden="true" />
}

function CloseIcon() {
  return <X size={10} aria-hidden="true" />
}

interface Props {
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  onMouseEnterBrand?: () => void
  onMouseLeaveBrand?: () => void
}

export default function TitleBar({
  sidebarCollapsed, onToggleSidebar,
  onMouseEnterBrand, onMouseLeaveBrand
}: Props) {
  const platform = window.api.platform
  const showCustomControls = platform === 'linux'
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!showCustomControls) return
    void window.api.isWindowMaximized().then(setMaximized)
    return window.api.onWindowMaximizedChange(e => setMaximized(e.maximized))
  }, [showCustomControls])

  return (
    <div
      className={`title-bar title-bar-${platform}`}
      onDoubleClick={() => { if (showCustomControls) void window.api.toggleMaximizeWindow() }}
    >
      <div
        className={`title-bar-brand ${sidebarCollapsed ? 'collapsed' : ''}`}
        onMouseEnter={onMouseEnterBrand}
        onMouseLeave={onMouseLeaveBrand}
      >
        <img src={logoMark} className="title-bar-logo" alt="" />
        {onToggleSidebar && (
          <button
            className={`sidebar-toggle ${sidebarCollapsed ? 'collapsed' : ''}`}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={onToggleSidebar}
          >
            <PanelLeft size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="title-bar-right">
        {showCustomControls && (
          <div className="title-bar-controls" onDoubleClick={e => e.stopPropagation()}>
            <button className="title-bar-btn" aria-label="Minimize" onClick={() => void window.api.minimizeWindow()}>
              <MinimizeIcon />
            </button>
            <button
              className="title-bar-btn"
              aria-label={maximized ? 'Restore' : 'Maximize'}
              onClick={() => void window.api.toggleMaximizeWindow()}
            >
              {maximized ? <RestoreIcon /> : <MaximizeIcon />}
            </button>
            <button className="title-bar-btn title-bar-btn-close" aria-label="Close" onClick={() => void window.api.closeWindow()}>
              <CloseIcon />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
