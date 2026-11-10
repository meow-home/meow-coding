import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { UpdaterStatusEvent } from '../../src/shared/types'
import type { UpdaterEnv } from '../../src/main/updater'

const { mockAutoUpdater, listeners } = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>()
  return {
    listeners,
    mockAutoUpdater: {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(() => Promise.resolve()),
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        listeners.set(event, cb)
      }),
      quitAndInstall: vi.fn()
    }
  }
})

vi.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater
}))

import { Updater } from '../../src/main/updater'

function makeEnv(overrides: Partial<UpdaterEnv> = {}): UpdaterEnv {
  return {
    isPackaged: true,
    isPortable: () => false,
    isAppImage: () => false,
    getCurrentVersion: () => '1.0.0',
    platform: 'win32',
    ...overrides
  }
}

function makeUpdater(env: UpdaterEnv = makeEnv()) {
  const events: UpdaterStatusEvent[] = []
  const updater = new Updater(e => events.push(e), env)
  return { events, updater }
}

describe('Updater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listeners.clear()
    mockAutoUpdater.autoDownload = true
    mockAutoUpdater.autoInstallOnAppQuit = true
  })

  it('dev mode: manual check emits not-supported, auto check stays silent', async () => {
    const { events, updater } = makeUpdater(makeEnv({ isPackaged: false }))
    await updater.check(true)
    expect(events).toEqual([{ type: 'not-supported', message: expect.any(String) }])
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled()

    events.length = 0
    await updater.check(false)
    expect(events).toEqual([])
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('portable build: manual check emits not-supported', async () => {
    const { events, updater } = makeUpdater(makeEnv({ isPortable: () => true }))
    await updater.check(true)
    expect(events).toEqual([{ type: 'not-supported', message: expect.any(String) }])
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('linux without AppImage: manual check emits not-supported', async () => {
    const { events, updater } = makeUpdater(makeEnv({ platform: 'linux', isAppImage: () => false }))
    await updater.check(true)
    expect(events).toEqual([{ type: 'not-supported', message: expect.any(String) }])
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('linux with AppImage is supported', async () => {
    const { events, updater } = makeUpdater(makeEnv({ platform: 'linux', isAppImage: () => true }))
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: false,
      updateInfo: { version: '1.0.0', releaseDate: '2026-08-18T00:00:00.000Z' }
    })
    await updater.check(true)
    expect(events).toEqual([{ type: 'checking' }, { type: 'up-to-date', currentVersion: '1.0.0' }])
  })

  it('supported + newer version emits update-available with version and currentVersion', async () => {
    const { events, updater } = makeUpdater()
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '2.1.0', releaseDate: '2026-08-18T00:00:00.000Z' }
    })
    await updater.check(true)
    expect(events).toEqual([
      { type: 'checking' },
      {
        type: 'update-available',
        version: '2.1.0',
        currentVersion: '1.0.0',
        releaseNotes: undefined,
        releaseDate: '2026-08-18T00:00:00.000Z'
      }
    ])
  })

  it('passes through releaseNotes string and releaseDate when present', async () => {
    const { events, updater } = makeUpdater()
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: {
        version: '2.1.0',
        releaseDate: '2026-08-19T00:00:00.000Z',
        releaseNotes: '<h1>What\'s new</h1>'
      }
    })
    await updater.check(true)
    expect(events[1]).toMatchObject({
      type: 'update-available',
      releaseNotes: '<h1>What\'s new</h1>',
      releaseDate: '2026-08-19T00:00:00.000Z'
    })
  })

  it('takes the note of the first entry when releaseNotes is an array', async () => {
    const { events, updater } = makeUpdater()
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: {
        version: '2.1.0',
        releaseDate: '2026-08-19T00:00:00.000Z',
        releaseNotes: [
          { version: '2.1.0', note: '<p>latest</p>' },
          { version: '2.0.0', note: '<p>older</p>' }
        ]
      }
    })
    await updater.check(true)
    expect(events[1]).toMatchObject({ type: 'update-available', releaseNotes: '<p>latest</p>' })
  })

  it('supported + same version emits up-to-date', async () => {
    const { events, updater } = makeUpdater()
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: false,
      updateInfo: { version: '1.0.0', releaseDate: '2026-08-18T00:00:00.000Z' }
    })
    await updater.check(true)
    expect(events).toEqual([{ type: 'checking' }, { type: 'up-to-date', currentVersion: '1.0.0' }])
  })

  it('emits error when checkForUpdates rejects', async () => {
    const { events, updater } = makeUpdater()
    mockAutoUpdater.checkForUpdates.mockRejectedValue(new Error('network down'))
    await updater.check(true)
    expect(events).toEqual([{ type: 'checking' }, { type: 'error', message: 'network down' }])
  })

  it('forwards download-progress with a rounded percent', async () => {
    const { events } = makeUpdater()
    const emit = listeners.get('download-progress')!
    emit({ percent: 45.6, total: 100, transferred: 45.6, delta: 0, bytesPerSecond: 0 })
    expect(events).toEqual([
      { type: 'download-progress', percent: 46, version: undefined, restartWhenReady: false }
    ])
  })

  it('forwards update-downloaded as downloaded with the new version', async () => {
    const { events } = makeUpdater()
    const emit = listeners.get('update-downloaded')!
    emit({ version: '2.1.0', downloadedFile: '/tmp/update' })
    expect(events).toEqual([{ type: 'downloaded', version: '2.1.0' }])
  })

  it('forwards autoUpdater errors', async () => {
    const { events } = makeUpdater()
    const emit = listeners.get('error')!
    emit(new Error('boom'))
    expect(events).toEqual([{ type: 'error', message: 'boom' }])
  })

  it('enables background download and install-on-quit', () => {
    makeUpdater()
    expect(mockAutoUpdater.autoDownload).toBe(true)
    expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true)
  })

  it('install before any check runs a check instead of quitting', async () => {
    const { updater } = makeUpdater()
    updater.install()
    await vi.waitFor(() => expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1))
    expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('install with a known version and no download in flight starts the download', async () => {
    const { updater } = makeUpdater()
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '2.1.0', releaseDate: '2026-08-18T00:00:00.000Z' },
      downloadPromise: null
    })
    await updater.check(true)
    updater.install()
    await vi.waitFor(() => expect(mockAutoUpdater.downloadUpdate).toHaveBeenCalledTimes(1))
    expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('install during a background download defers the restart until it finishes', async () => {
    const { events, updater } = makeUpdater()
    let finishDownload!: () => void
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '2.1.0', releaseDate: '2026-08-18T00:00:00.000Z' },
      downloadPromise: new Promise<void>(resolve => { finishDownload = resolve })
    })
    await updater.check(true)

    updater.install()
    // The download is already running: no second download, no premature quit.
    expect(mockAutoUpdater.downloadUpdate).not.toHaveBeenCalled()
    expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled()
    expect(events.at(-1)).toEqual({
      type: 'download-progress',
      percent: 0,
      version: '2.1.0',
      restartWhenReady: true
    })

    listeners.get('update-downloaded')!({ version: '2.1.0', downloadedFile: '/tmp/update' })
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true)
    finishDownload()
  })

  it('cancelInstall drops a pending restart so the finished download waits for quit', async () => {
    const { events, updater } = makeUpdater()
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '2.1.0', releaseDate: '2026-08-18T00:00:00.000Z' },
      downloadPromise: new Promise<void>(() => {})
    })
    await updater.check(true)
    updater.install()
    updater.cancelInstall()
    expect(events.at(-1)).toEqual({
      type: 'download-progress',
      percent: 0,
      version: '2.1.0',
      restartWhenReady: false
    })

    listeners.get('update-downloaded')!({ version: '2.1.0', downloadedFile: '/tmp/update' })
    expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('a check that finds nothing clears the pending restart', async () => {
    const { updater } = makeUpdater()
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: false,
      updateInfo: { version: '1.0.0', releaseDate: '2026-08-18T00:00:00.000Z' }
    })
    await updater.check(true)
    updater.install()
    await updater.check(true)
    // A later release must not install itself just because a stale click is set.
    listeners.get('update-downloaded')!({ version: '2.0.0', downloadedFile: '/tmp/update' })
    expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('a download error clears the pending restart', async () => {
    const { updater } = makeUpdater()
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '2.1.0', releaseDate: '2026-08-18T00:00:00.000Z' },
      downloadPromise: new Promise<void>(() => {})
    })
    await updater.check(true)
    updater.install()
    listeners.get('error')!(new Error('network down'))
    listeners.get('update-downloaded')!({ version: '2.1.0', downloadedFile: '/tmp/update' })
    expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('install after update-downloaded quits and installs silently, then relaunches', async () => {
    const { updater } = makeUpdater()
    // Simulate a finished download before the user clicks restart.
    const emit = listeners.get('update-downloaded')!
    emit({ version: '2.1.0', downloadedFile: '/tmp/update' })
    updater.install()
    expect(mockAutoUpdater.downloadUpdate).not.toHaveBeenCalled()
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('a failed download rejects and surfaces as an error', async () => {
    const { events, updater } = makeUpdater()
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '2.1.0', releaseDate: '2026-08-18T00:00:00.000Z' },
      downloadPromise: null
    })
    await updater.check(true)
    mockAutoUpdater.downloadUpdate.mockRejectedValueOnce(new Error('disk full'))
    updater.install()
    await vi.waitFor(() => {
      expect(events).toContainEqual({ type: 'error', message: 'disk full' })
    })
  })

  it('reports an already-downloaded version instead of re-announcing it as available', async () => {
    const { events, updater } = makeUpdater()
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '2.1.0', releaseDate: '2026-08-18T00:00:00.000Z' }
    })
    await updater.check(true)
    expect(events.filter(e => e.type === 'update-available')).toHaveLength(1)

    // The background download finished; a later check for the same version must
    // not re-announce it as available, but the caller still needs an answer (a
    // silent return left the UI stuck on "Checking…").
    listeners.get('update-downloaded')!({ version: '2.1.0', downloadedFile: '/tmp/update' })
    events.length = 0
    await updater.check(true)
    expect(events).toEqual([{ type: 'checking' }, { type: 'downloaded', version: '2.1.0' }])
    listeners.get('update-downloaded')!({ version: '2.1.0', downloadedFile: '/tmp/update' })
    expect(events).toEqual([{ type: 'checking' }, { type: 'downloaded', version: '2.1.0' }])
  })

  it('replays the last status for a renderer that mounts late', async () => {
    const { updater } = makeUpdater()
    expect(updater.getStatus()).toBeNull()
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '2.1.0', releaseDate: '2026-08-18T00:00:00.000Z' }
    })
    await updater.check(false)
    expect(updater.getStatus()).toMatchObject({ type: 'update-available', version: '2.1.0' })
  })

  it('announces a different version after one was already downloaded', async () => {
    const { events, updater } = makeUpdater()
    listeners.get('update-downloaded')!({ version: '2.1.0', downloadedFile: '/tmp/update' })
    expect(events).toEqual([{ type: 'downloaded', version: '2.1.0' }])

    events.length = 0
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '2.2.0', releaseDate: '2026-08-20T00:00:00.000Z' }
    })
    await updater.check(true)
    expect(events).toEqual([
      { type: 'checking' },
      {
        type: 'update-available',
        version: '2.2.0',
        currentVersion: '1.0.0',
        releaseNotes: undefined,
        releaseDate: '2026-08-20T00:00:00.000Z'
      }
    ])
  })

  it('ignores a second check while one is in flight', async () => {
    const { events, updater } = makeUpdater()
    let resolveCheck!: (v: unknown) => void
    mockAutoUpdater.checkForUpdates.mockImplementation(
      () => new Promise(resolve => { resolveCheck = resolve })
    )
    const first = updater.check(true)
    await updater.check(true)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    resolveCheck({
      isUpdateAvailable: true,
      updateInfo: { version: '2.0.0', releaseDate: '2026-08-18T00:00:00.000Z' }
    })
    await first
    expect(events.filter(e => e.type === 'checking')).toHaveLength(1)
  })
})
