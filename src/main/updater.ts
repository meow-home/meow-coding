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
  private availableVersion: string | null = null
  private availableNotes: string | undefined
  private availableDate: string | undefined
  private percent = 0
  private downloadInFlight = false
  // The user asked to restart before the background download finished: the
  // installer then runs the moment `update-downloaded` arrives.
  private restartWhenReady = false
  private status: UpdaterStatusEvent | null = null

  constructor(
    private readonly onStatus: (e: UpdaterStatusEvent) => void,
    private readonly env: UpdaterEnv
  ) {
    // Background updates: the download starts as soon as a newer version is
    // found, and the installer runs silently on app quit. The user is only
    // asked to restart early (notification / dialog), never to run a setup UI.
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.disableWebInstaller = true
    autoUpdater.on('download-progress', (progress) => {
      this.percent = Math.round(progress.percent)
      this.emit({
        type: 'download-progress',
        percent: this.percent,
        version: this.availableVersion ?? undefined,
        restartWhenReady: this.restartWhenReady
      })
    })
    autoUpdater.on('update-downloaded', (info) => {
      // A repeat check validates the cached installer and re-fires this event;
      // only a newly downloaded version may notify the user again.
      const alreadyPending = this.downloaded && this.downloadedVersion === info.version
      this.downloaded = true
      this.downloadedVersion = info.version
      this.downloadInFlight = false
      if (!alreadyPending) this.emit({ type: 'downloaded', version: info.version })
      if (this.restartWhenReady) this.installNow()
    })
    autoUpdater.on('error', (err: Error, message?: string) => {
      this.downloadInFlight = false
      this.restartWhenReady = false
      this.emit({ type: 'error', message: message ?? err.message })
    })
  }

  isSupported(): boolean {
    return this.notSupportedReason() === null
  }

  /** Last status emitted, so a renderer that mounts late can replay it. */
  getStatus(): UpdaterStatusEvent | null {
    return this.status
  }

  async check(manual: boolean): Promise<void> {
    const reason = this.notSupportedReason()
    if (reason) {
      if (manual) this.emit({ type: 'not-supported', message: reason })
      return
    }
    if (this.checking) return
    this.checking = true
    try {
      if (manual) this.emit({ type: 'checking' })
      const result = await autoUpdater.checkForUpdates()
      const currentVersion = this.env.getCurrentVersion()
      const info = result?.updateInfo
      if (!info || info.version === currentVersion) {
        // Nothing to install: drop a pending restart so a future release is not
        // installed behind the user's back.
        this.restartWhenReady = false
        this.emit({ type: 'up-to-date', currentVersion })
        return
      }
      this.availableVersion = info.version
      this.availableNotes = releaseNotesText(info.releaseNotes)
      this.availableDate = info.releaseDate
      // With autoDownload the download starts inside checkForUpdates; tracking
      // its promise is what tells a later install() click whether a restart can
      // be deferred instead of silently doing nothing.
      if (result?.downloadPromise) {
        this.downloadInFlight = true
        void result.downloadPromise
          .catch(() => {})
          .finally(() => {
            this.downloadInFlight = false
          })
      }
      // A repeat check for the same version must not re-announce it as
      // available — electron-updater skips the duplicate download itself. The
      // caller still needs an answer though, so report the ready installer
      // instead of returning silently (which left the UI on "Checking…").
      if (this.downloaded && this.downloadedVersion === info.version) {
        this.emit({ type: 'downloaded', version: info.version })
        return
      }
      this.emit({
        type: 'update-available',
        version: info.version,
        releaseNotes: this.availableNotes,
        releaseDate: this.availableDate,
        currentVersion
      })
    } catch (err) {
      this.restartWhenReady = false
      this.emit({ type: 'error', message: errorMessage(err) })
    } finally {
      this.checking = false
    }
  }

  /**
   * Restart now when the installer is ready; otherwise keep working while the
   * background download finishes and restart as soon as it does.
   */
  install(): void {
    if (this.downloaded) {
      this.installNow()
      return
    }
    this.restartWhenReady = true
    this.emit({
      type: 'download-progress',
      percent: this.percent,
      version: this.availableVersion ?? undefined,
      restartWhenReady: true
    })
    if (this.downloadInFlight) return
    if (!this.availableVersion) {
      // Nothing was checked yet (e.g. the auto check is disabled in this build).
      void this.check(true)
      return
    }
    this.downloadInFlight = true
    void autoUpdater
      .downloadUpdate()
      .catch((err) => {
        this.restartWhenReady = false
        this.emit({ type: 'error', message: errorMessage(err) })
      })
      .finally(() => {
        this.downloadInFlight = false
      })
  }

  /** Drop a pending "restart when ready" so the app keeps running. */
  cancelInstall(): void {
    if (!this.restartWhenReady) return
    this.restartWhenReady = false
    this.emit({
      type: 'download-progress',
      percent: this.percent,
      version: this.availableVersion ?? undefined,
      restartWhenReady: false
    })
  }

  private installNow(): void {
    this.restartWhenReady = false
    // Silent install: no NSIS wizard, and relaunch the app afterwards.
    autoUpdater.quitAndInstall(true, true)
  }

  private emit(e: UpdaterStatusEvent): void {
    this.status = e
    this.onStatus(e)
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
