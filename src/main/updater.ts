import { autoUpdater } from 'electron-updater'
import type { UpdateInfo } from 'electron-updater'
import type { UpdaterStatusEvent } from '../shared/types'

// Production defaults (supplied by Task 5's caller): { isPackaged: app.isPackaged,
// isPortable: () => !!process.env.PORTABLE_EXECUTABLE_FILE,
// isAppImage: () => process.platform === 'linux' && !!process.env.APPIMAGE,
// getCurrentVersion: () => app.getVersion() }. platform defaults to process.platform.
export interface UpdaterEnv {
  isPackaged: boolean
  isPortable: () => boolean
  isAppImage: () => boolean
  getCurrentVersion: () => string
  platform?: NodeJS.Platform
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function releaseNotesText(notes: UpdateInfo['releaseNotes']): string | undefined {
  if (!notes) return undefined
  if (typeof notes === 'string') return notes
  return notes[0]?.note ?? undefined
}

export class Updater {
  private checking = false
  private downloaded = false
  private downloadedVersion: string | null = null

  constructor(
    private readonly onStatus: (e: UpdaterStatusEvent) => void,
    private readonly env: UpdaterEnv
  ) {
    // Background updates: the download starts as soon as a newer version is
    // found, and the installer runs silently on app quit. The user is only
    // asked to restart early (notification / dialog), never to run a setup UI.
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('download-progress', (progress) => {
      this.onStatus({ type: 'download-progress', percent: Math.round(progress.percent) })
    })
    autoUpdater.on('update-downloaded', (info) => {
      // A repeat check validates the cached installer and re-fires this event;
      // only a newly downloaded version may notify the user again.
      const alreadyPending = this.downloaded && this.downloadedVersion === info.version
      this.downloaded = true
      this.downloadedVersion = info.version
      if (!alreadyPending) this.onStatus({ type: 'downloaded', version: info.version })
    })
    autoUpdater.on('error', (err: Error, message?: string) => {
      this.onStatus({ type: 'error', message: message ?? err.message })
    })
  }

  isSupported(): boolean {
    return this.notSupportedReason() === null
  }

  async check(manual: boolean): Promise<void> {
    const reason = this.notSupportedReason()
    if (reason) {
      if (manual) this.onStatus({ type: 'not-supported', message: reason })
      return
    }
    if (this.checking) return
    this.checking = true
    try {
      if (manual) this.onStatus({ type: 'checking' })
      const result = await autoUpdater.checkForUpdates()
      const currentVersion = this.env.getCurrentVersion()
      const info = result?.updateInfo
      if (!info || info.version === currentVersion) {
        this.onStatus({ type: 'up-to-date', currentVersion })
        return
      }
      // With autoDownload the download starts inside checkForUpdates. A repeat
      // check for the same version must not re-announce it (and re-notify) as
      // available — electron-updater skips the duplicate download itself.
      if (this.downloaded && this.downloadedVersion === info.version) return
      this.onStatus({
        type: 'update-available',
        version: info.version,
        releaseNotes: releaseNotesText(info.releaseNotes),
        releaseDate: info.releaseDate,
        currentVersion
      })
    } catch (err) {
      this.onStatus({ type: 'error', message: errorMessage(err) })
    } finally {
      this.checking = false
    }
  }

  install(): void {
    if (this.downloaded) {
      // Silent install: no NSIS wizard, and relaunch the app afterwards.
      autoUpdater.quitAndInstall(true, true)
      return
    }
    void autoUpdater.downloadUpdate().catch((err) => {
      this.onStatus({ type: 'error', message: errorMessage(err) })
    })
  }

  private notSupportedReason(): string | null {
    if (!this.env.isPackaged) return 'Auto-update is only available in packaged builds.'
    if (this.env.isPortable()) return 'Auto-update is not supported for the portable build.'
    const platform = this.env.platform ?? process.platform
    if (platform === 'linux' && !this.env.isAppImage()) {
      return 'Auto-update is only supported for the Linux AppImage build.'
    }
    return null
  }
}
