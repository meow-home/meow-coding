export const TASK_MAX_BYTES = 32 * 1024 // 32 KiB
export const RESULT_MAX_BYTES = 64 * 1024 // 64 KiB
export const STDERR_MAX_BYTES = 16 * 1024 // 16 KiB
export const DEFAULT_TASK_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
export const TEST_TIMEOUT_MS = 90 * 1000

export const ENV_ALLOWLIST: readonly string[] = [
  'PATH',
  'Path',
  'HOME',
  'USERPROFILE',
  'TMP',
  'TEMP',
  'LANG',
  'LC_*',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'SystemRoot',
  'ComSpec',
  'APPDATA',
  'LOCALAPPDATA'
] as const

export function isEnvAllowed(key: string, platform: NodeJS.Platform = process.platform): boolean {
  const isWindows = platform === 'win32'
  const keyUpper = key.toUpperCase()

  for (const item of ENV_ALLOWLIST) {
    if (item.endsWith('*')) {
      const prefix = item.slice(0, -1)
      if (isWindows) {
        if (keyUpper.startsWith(prefix.toUpperCase())) return true
      } else {
        if (key.startsWith(prefix)) return true
      }
    } else {
      if (isWindows) {
        if (keyUpper === item.toUpperCase()) return true
      } else {
        if (key === item) return true
      }
    }
  }
  return false
}
