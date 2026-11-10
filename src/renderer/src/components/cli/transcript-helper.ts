import type { CliSessionStatus } from '@shared/types'

export function describeCliToolInput(input?: Record<string, unknown>): string {
  if (!input) return ''
  const preferredKeys = ['file_path', 'path', 'command', 'cmd', 'query', 'url', 'pattern']
  for (const k of preferredKeys) {
    const val = input[k]
    if (typeof val === 'string' && val.trim()) {
      return val.trim()
    }
  }
  for (const val of Object.values(input)) {
    if (typeof val === 'string' && val.trim()) {
      return val.trim()
    }
  }
  return ''
}

export function formatCliTime(at: number): string {
  if (!at || !Number.isFinite(at)) return ''
  const d = new Date(at)
  const hours = d.getHours().toString().padStart(2, '0')
  const minutes = d.getMinutes().toString().padStart(2, '0')
  return `${hours}:${minutes}`
}

export function describeCliStatus(status: CliSessionStatus): { label: string; tone: 'ok' | 'warn' | 'err' | 'idle' } {
  switch (status) {
    case 'running':
      return { label: 'Running', tone: 'ok' }
    case 'needs-attention':
      return { label: 'Needs Attention', tone: 'warn' }
    case 'failed':
      return { label: 'Failed', tone: 'err' }
    case 'idle':
    default:
      return { label: 'Idle', tone: 'idle' }
  }
}
