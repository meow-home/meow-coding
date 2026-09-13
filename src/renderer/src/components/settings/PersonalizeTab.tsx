import { useState } from 'react'
import { Type, Sparkles, Check, Moon, Sun, Palette } from 'lucide-react'
import { getFontSize, setFontSize } from '../../font'
import { applyTheme, getTheme, THEME_STORAGE_KEY, type Theme } from '../../theme'

const PRESETS = [
  { label: 'Compact', size: 10 },
  { label: 'Default', size: 12 },
  { label: 'Medium', size: 14 },
  { label: 'Large', size: 16 },
  { label: 'Extra Large', size: 18 },
  { label: 'Huge', size: 20 }
]

export default function PersonalizeTab() {
  const [size, setSize] = useState<number>(() => getFontSize())
  const [theme, setThemeState] = useState<Theme>(() => getTheme())

  const applyFont = (newSize: number) => {
    const resolved = setFontSize(newSize)
    setSize(resolved)
  }

  const applyColorTheme = (t: Theme) => {
    setThemeState(t)
    localStorage.setItem(THEME_STORAGE_KEY, t)
    applyTheme(t)
  }

  return (
    <div className="personalize-tab">
      {/* Card 1: Appearance & Theme */}
      <div className="personalize-card">
        <div className="personalize-card-head">
          <div className="context-icon-badge">
            <Palette size={18} />
          </div>
          <div className="context-title-group">
            <div className="context-title-row">
              <h4 className="context-card-title">Color Theme & Appearance</h4>
              <span className="context-tag" style={{ textTransform: 'capitalize' }}>{theme} mode</span>
            </div>
            <p className="context-card-desc">
              Choose your preferred visual theme for dark or light environments.
            </p>
          </div>
        </div>

        <div className="personalize-card-body">
          <div className="theme-grid">
            <button
              type="button"
              className={`theme-card-btn ${theme === 'dark' ? 'active' : ''}`}
              onClick={() => applyColorTheme('dark')}
            >
              <div className="theme-card-icon">
                <Moon size={20} />
              </div>
              <div className="theme-card-info">
                <span className="theme-card-title">Dark Mode</span>
                <span className="theme-card-desc">Dark backgrounds, high contrast text (default)</span>
              </div>
              {theme === 'dark' && <Check size={16} className="theme-check" />}
            </button>

            <button
              type="button"
              className={`theme-card-btn ${theme === 'light' ? 'active' : ''}`}
              onClick={() => applyColorTheme('light')}
            >
              <div className="theme-card-icon">
                <Sun size={20} />
              </div>
              <div className="theme-card-info">
                <span className="theme-card-title">Light Mode</span>
                <span className="theme-card-desc">Clean white backgrounds, VSCode Light+ palette</span>
              </div>
              {theme === 'light' && <Check size={16} className="theme-check" />}
            </button>
          </div>
        </div>
      </div>

      {/* Card 2: Font Size & Typography */}
      <div className="personalize-card">
        <div className="personalize-card-head">
          <div className="context-icon-badge">
            <Type size={18} />
          </div>
          <div className="context-title-group">
            <div className="context-title-row">
              <h4 className="context-card-title">Font Size & Typography</h4>
              <span className="context-tag">{size}px</span>
            </div>
            <p className="context-card-desc">
              Select base text sizing across the editor, chat feeds, overlay panels, and dialogs.
            </p>
          </div>
        </div>

        <div className="personalize-card-body">
          <div className="context-field-item">
            <label className="context-field-label">Font Presets</label>
            <div className="font-preset-group">
              {PRESETS.map(p => {
                const isActive = size === p.size
                return (
                  <button
                    key={p.size}
                    type="button"
                    className={`font-preset-btn ${isActive ? 'active' : ''}`}
                    onClick={() => applyFont(p.size)}
                  >
                    {isActive && <Check size={13} style={{ strokeWidth: 2.5 }} />}
                    <span>{p.size}px — {p.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="personalize-preview-box">
            <div className="personalize-preview-title">
              <Sparkles size={13} style={{ color: 'var(--accent)' }} />
              Live Text Preview
            </div>
            <div className="personalize-preview-text">
              Meow Coding — AI Assistant session with instant live reflow.
            </div>
            <div className="personalize-preview-code">
              <code>const activeFontSize = getFontSize(); // {size}px</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
