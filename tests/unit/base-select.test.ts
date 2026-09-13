import { describe, expect, test } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import BaseSelect from '../../src/renderer/src/components/common/BaseSelect'

describe('BaseSelect', () => {
  test('renders trigger button with correct ARIA attributes when closed', () => {
    const html = renderToString(
      createElement(BaseSelect, {
        open: false,
        onToggle: () => {},
        onClose: () => {},
        title: 'Select option',
        trigger: 'Build',
        children: 'Options'
      })
    )
    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-haspopup="listbox"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Build')
  })
})
