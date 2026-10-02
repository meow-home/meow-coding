# Changelog — Meow Coding v0.50.0 → v0.50.1

## 🚀 Improvements

### Updates download and install in the background
- Meow now downloads a new version as soon as it is found — no click needed — and installs it silently when you quit the app, so the setup wizard never opens again.
- A native notification tells you the version is ready: it will be applied on quit, or click it to restart and apply it right away.
- The update dialog only opens when you ask for a check yourself; a background download no longer interrupts with a modal, and it can be dismissed while downloading.
- The Settings → Updates tab explains the flow and keeps "Restart Now" as the shortcut to apply the update early.

## 🐛 Bug Fixes
- Updater: re-checking an already downloaded version no longer re-announces it or fires a duplicate "update ready" notification.

## 🧹 Internal & Docs
- `updater.ts` enables `autoDownload` + `autoInstallOnAppQuit` and installs via `quitAndInstall(true, true)`; new unit tests cover the background flow and the duplicate-announce guard.
- Updated the auto-update sections in `docs/reference/01`, `02`, `09`, `10` and the affected `AGENTS.md` files.
