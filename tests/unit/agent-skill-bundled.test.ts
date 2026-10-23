import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { collectSkills, skillListText } from '../../src/main/agent/skill'
import { createSkillTool } from '../../src/main/agent/tools/skill'
import type { ToolContext } from '../../src/main/agent/tools/types'

const ROOT = path.resolve(__dirname, '../..')
const BUILTIN = path.join(ROOT, 'resources', 'skills')

const ctx: ToolContext = { cwd: ROOT, ask: async () => null }

describe('bundled skills', () => {
  it('collects every bundled skill with name+description', () => {
    const skills = collectSkills(ROOT, undefined, BUILTIN)
    const names = skills.map(s => s.name).sort()
    expect(names).toEqual([
      'brand-guidelines', 'canvas-design', 'frontend-design',
      'katalon-studio', 'theme-factory', 'web-artifacts-builder'
    ])
    for (const s of skills) {
      expect(s.description.length).toBeGreaterThan(0)
      expect(s.content.length).toBeGreaterThan(50)
    }
  })

  it('skill tool returns frontend-design content with a path hint', async () => {
    const tool = createSkillTool(() => undefined, () => BUILTIN)
    const r = await tool.run({ name: 'frontend-design' }, ctx)
    expect(r.error).toBeUndefined()
    expect(r.output).toContain('Design principles')
    expect(r.output).toContain('frontend-design')
  })

  it('skillListText lists bundled skill names', () => {
    const skills = collectSkills(ROOT, undefined, BUILTIN)
    const text = skillListText(skills)
    expect(text).not.toContain('using-superpowers')
    expect(text).toContain('frontend-design')
    expect(text).toContain('canvas-design')
    expect(text).toContain('theme-factory')
    expect(text).toContain('katalon-studio')
  })

  it('supporting assets exist on disk for every bundled skill', () => {
    const tool = createSkillTool(() => undefined, () => BUILTIN)
    const skills = collectSkills(ROOT, undefined, BUILTIN)
    for (const s of skills) {
      expect(s.path).toBeTruthy()
    }
    const assets: Record<string, string[]> = {
      'web-artifacts-builder': ['scripts/init-artifact.sh', 'scripts/bundle-artifact.sh', 'scripts/shadcn-components.tar.gz'],
      'theme-factory': ['themes/ocean-depths.md', 'themes/midnight-galaxy.md', 'theme-showcase.pdf'],
      'canvas-design': ['canvas-fonts/WorkSans-Regular.ttf', 'canvas-fonts/ArsenalSC-Regular.ttf']
    }
    for (const skill of skills) {
      for (const rel of assets[skill.name] ?? []) {
        expect(existsSync(path.join(skill.path!, rel))).toBe(true)
      }
    }
  })
})
