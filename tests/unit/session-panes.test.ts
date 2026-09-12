import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { PaneModel } from '../../src/renderer/src/App'

// `SessionPanes` is the unit under test, so `Pane` is stubbed out: the markup
// assertions count the wrappers SessionPanes itself emits, not what a pane
// renders. The stub returns its pane id so each slot stays identifiable.
vi.mock('../../src/renderer/src/components/Pane', () => ({
  default: (props: { pane: { agent: { id: string } } }) => props.pane.agent.id
}))

import SessionPanes from '../../src/renderer/src/components/SessionPanes'

function paneModel(id: string): PaneModel {
  return {
    agent: { id, name: id, templateId: 'meow', cwd: '/tmp' },
    state: { agentId: id, status: 'idle', exitCode: null, lastOutputAt: null, alert: 'normal' },
    git: null
  }
}

// Matches every `.pane-slot` wrapper SessionPanes emits and reports whether it
// is hidden. `hidden` is a boolean attribute, so React renders `hidden=""` for
// true and omits it entirely for false.
function slots(markup: string): { id: string; hidden: boolean }[] {
  return [...markup.matchAll(/<div class="pane-slot"([^>]*)>([\s\S]*?)<\/div>/g)].map(m => ({
    hidden: /(?:^|\s)hidden(?:=|>|\s|$)/.test(m[1]),
    id: m[2]
  }))
}

describe('SessionPanes', () => {
  // Spec Goal 1: switching a session must not stop or pause any other session's
  // run. That holds only while every session stays mounted and the inactive ones
  // are hidden — so this fails loudly if anyone adds a conditional render, an
  // early return, or a key that varies with `activeId`.
  it('mounts every session and hides exactly the inactive ones', () => {
    const panes = [paneModel('sess-a'), paneModel('sess-b'), paneModel('sess-c')]
    const markup = renderToStaticMarkup(createElement(SessionPanes, {
      panes,
      activeId: 'sess-b',
      onActiveChange: () => {},
      backgrounds: {},
      onRemove: () => {}
    }))

    expect(slots(markup)).toEqual([
      { id: 'sess-a', hidden: true },
      { id: 'sess-b', hidden: false },
      { id: 'sess-c', hidden: true }
    ])
  })

  // The other half of the same promise. `hidden` alone does NOT hide a slot:
  // `.session-panes .pane-slot` sets `display: flex`, which overrides the
  // browser's default `[hidden] { display: none }`. Dropping this rule leaves
  // every session stacked and visible while the markup test above stays green.
  it('hides a non-active slot in CSS, overriding its display: flex', () => {
    const css = readFileSync(resolve(__dirname, '../../src/renderer/src/styles.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
      // Whitespace-insensitive so a reformat does not break the match.
      selectors: selectors.split(',').map(s => s.replace(/\s+/g, '')),
      body: body.replace(/\s+/g, '').toLowerCase()
    }))
    const rule = rules.find(r => r.selectors.includes('.session-panes.pane-slot[hidden]'))

    expect(rule, 'styles.css has no `.session-panes .pane-slot[hidden]` rule').toBeDefined()
    expect(rule!.body).toContain('display:none')
    expect(rule!.body).toContain('!important')
  })
})
