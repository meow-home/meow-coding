import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import BaseModal from '../../src/renderer/src/components/common/BaseModal'

describe('BaseModal', () => {
  it('renders title, content, actions, and portal dialog wrapper with close button', () => {
    const markup = renderToStaticMarkup(createElement(BaseModal, {
      title: 'Modal Title Test',
      onClose: () => {},
      actions: createElement('button', { className: 'btn' }, 'Save'),
      size: 'lg',
      role: 'dialog'
    }, createElement('p', null, 'Modal Body Content')))

    expect(markup).toContain('dialog-backdrop')
    expect(markup).toContain('dialog dialog-lg')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('Modal Title Test')
    expect(markup).toContain('Modal Body Content')
    expect(markup).toContain('Save')
    expect(markup).toContain('dialog-close')
  })

  it('omits close button when showCloseButton is false or onClose is absent', () => {
    const markup = renderToStaticMarkup(createElement(BaseModal, {
      title: 'No Close Button',
      showCloseButton: false
    }, createElement('p', null, 'Content')))

    expect(markup).not.toContain('dialog-close')
  })

  it('defines dialog modifier rules in styles.css for size variants', () => {
    const css = readFileSync(resolve(__dirname, '../../src/renderer/src/styles.css'), 'utf8')
    expect(css).toContain('.dialog.dialog-sm { width: 28rem; }')
    expect(css).toContain('.dialog.dialog-md { width: 35rem; }')
    expect(css).toContain('.dialog.dialog-lg { width: 45rem; }')
    expect(css).toContain('.dialog.dialog-xl { width: 55rem; }')
  })
})
