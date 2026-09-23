import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configToSettings, loadMeowConfig, settingsToConfig } from '../../src/main/agent/config'

function load(json: unknown) {
  const dir = mkdtempSync(path.join(tmpdir(), 'meow-sampling-'))
  const file = path.join(dir, 'meow.json')
  writeFileSync(file, JSON.stringify(json))
  return loadMeowConfig(file)
}

describe('meow.json sampling', () => {
  it('keeps valid numeric fields and drops everything else', () => {
    const cfg = load({ sampling: { 'glm-*': { temperature: 0.7, topP: 'x', bogus: 1 }, 'bad': 3, 'empty': {} } })
    expect(cfg.sampling).toEqual({ 'glm-*': { temperature: 0.7 } })
  })

  it('is undefined when absent', () => {
    expect(load({}).sampling).toBeUndefined()
  })

  it('survives a settings save round-trip', () => {
    const cfg = load({ provider: { p: { apiKey: 'k', models: ['m'] } }, model: 'p', sampling: { 'qwen*': { temperature: 0.5 } } })
    const next = settingsToConfig(configToSettings(cfg), cfg)
    expect(next.sampling).toEqual({ 'qwen*': { temperature: 0.5 } })
  })
})
