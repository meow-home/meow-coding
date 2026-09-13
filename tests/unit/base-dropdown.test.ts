import { describe, expect, test } from 'vitest'
import { computeDropdownPosition } from '../../src/renderer/src/components/common/BaseDropdown'

describe('computeDropdownPosition', () => {
  const windowBounds = { width: 1000, height: 800 }
  const triggerRect = { top: 700, bottom: 730, left: 500, right: 600, width: 100, height: 30 }
  const menuRect = { width: 200, height: 300 }

  test('flips from bottom to top when space below is insufficient', () => {
    const pos = computeDropdownPosition({
      triggerRect,
      menuRect,
      windowBounds,
      placement: 'bottom-start',
      offset: 4
    })
    expect(pos.top).toBeUndefined()
    expect(pos.bottom).toBe(800 - triggerRect.top + 4) // 800 - 700 + 4 = 104
  })

  test('clamps horizontal position within screen margin when overflowing right', () => {
    const edgeTriggerRect = { top: 100, bottom: 130, left: 850, right: 980, width: 130, height: 30 }
    const pos = computeDropdownPosition({
      triggerRect: edgeTriggerRect,
      menuRect,
      windowBounds,
      placement: 'bottom-start',
      offset: 4
    })
    expect(pos.left).toBeLessThanOrEqual(windowBounds.width - menuRect.width - 8)
  })

  test('applies maxHeight and overflowY when space is restricted on both sides', () => {
    const tightTriggerRect = { top: 100, bottom: 130, left: 100, right: 200, width: 100, height: 30 }
    const pos = computeDropdownPosition({
      triggerRect: tightTriggerRect,
      menuRect: { width: 200, height: 900 },
      windowBounds: { width: 1000, height: 300 },
      placement: 'bottom-start',
      offset: 4
    })
    expect(pos.maxHeight).toBeDefined()
    expect(pos.overflowY).toBe('auto')
  })
})
