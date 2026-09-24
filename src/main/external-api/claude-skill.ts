import { readFileSync } from 'node:fs'
import path from 'node:path'
import { writeFileAtomic } from '../atomic-write'

export function installClaudeSkill(opts: { templatePath: string; cliPath: string; skillsDir: string }): string {
  const template = readFileSync(opts.templatePath, 'utf8')
  const rendered = template.replaceAll('{{CLI_PATH}}', opts.cliPath.replace(/\\/g, '/'))
  const target = path.join(opts.skillsDir, 'meow-delegate', 'SKILL.md')
  writeFileAtomic(target, rendered)
  return target
}
