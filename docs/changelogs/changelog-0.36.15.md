# Changelog — Meow Coding v0.36.14 → v0.36.15

## 🐛 Bug Fixes & Improvements

### Browser Bridge & Install Guide Dark Mode Styling
- **Dark Mode Support for Extension Popup**: Updated Chrome Extension popup styles (`src/browser-extension/popup.html`) with CSS custom properties and `@media (prefers-color-scheme: dark)` so the extension popup seamlessly aligns with system dark mode.
- **Status Pill & Inline Code Contrast**: Replaced hardcoded status pill text colors (`#16a34a`, `#ca8a04`, `#64748b`) with theme-aware CSS variables (`var(--green)`, `var(--yellow)`, `var(--text-dim)`) in `BrowserDialog.tsx`. Added theme styling for inline `code` tags within install guide step descriptions and information banners.

## 🧹 Internal & Docs
- Rebuilt browser extension distribution bundle (`out/browser-extension`).
- Bumped application version to `v0.36.15`.
