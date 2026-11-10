# Changelog — Meow Coding v0.50.23 → v0.51.0

## 🚀 New Features

### Updates you can actually see and drive
- An update that finished downloading in the background now announces itself in the app: a bottom-right toast ("vX is ready — Restart now / Later") plus an update pill in the status bar that walks through **Update available → Updating 42% → Restart to update**.
- The status bar pill opens the update dialog, so a dismissed notice is never lost. The OS notification is kept for the unfocused case.
- "Update & Restart" clicked while the background download is still running now schedules the restart for the moment the download finishes ("Restarting when ready…"), with **Keep working** to cancel it, instead of doing nothing.
- The update dialog shows the release notes, the download progress and a distinct state per phase; the Settings → Updates tab mirrors the same controls.

### Checks that keep up
- Update checks run at startup, **every 4 hours**, and after the machine wakes from sleep, so an app left open picks up new releases.
- A failed background check retries on its own after 5 minutes (at most twice per session) instead of staying silent until the next launch.

## 🐛 Bug Fixes
- Updates: clicking "Update & Restart" during a background download was a no-op — `downloadUpdate()` returned the in-flight promise, so nothing happened and nothing was reported.
- Updates: opening the app no longer silently misses an update — the renderer replays the last update status from main on mount, so a window that loads after the startup check still shows it.
- Updates: a manual check on a version that was already downloaded left the UI stuck on "Checking…"; it now reports the ready installer.
- Updates: a pending "restart when ready" is dropped when the download fails or when a later check finds nothing, so a future release cannot install itself behind the user's back.
- Updates: the Settings check button stays busy until the answer arrives instead of flipping back immediately.

## 🧹 Internal & Docs
- `Updater` tracks the download promise, the available version and `restartWhenReady`, keeps the last `UpdaterStatusEvent` for the new `updater:get-status` channel, and exposes `updater:cancel-install`.
- `MainApp.startUpdatePolling()` owns the check schedule and the retry; the `downloaded` OS notification is skipped while the window is focused.
- New `UpdateToast` component, status-bar update pill, and `download-progress` now carries `version` + `restartWhenReady`.
- Reference docs (product overview, architecture, IPC contract, UI guide, build/release) and the `AGENTS.md` files updated; `tests/unit/updater.test.ts` covers the deferred install, cancel, error and replay paths.
