# Changelog — v0.36.6

## 🚀 New Features & Enhancements

- **Image Preview in File Viewer**: Added raster image preview support (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.ico`, `.avif`) up to 10MB in the shared `FileContentView` (used by both the separate FileViewer window and the Files panel overlay). Features fit-to-container view, centered layout over a dark/light theme checkerboard pattern, and an "Open with OS app" escape button for fallback.

## 🎨 UI & Aesthetics

- **Modal & Settings Surface Styling**: Updated popup modal overlays and settings page background color to match dropdown menu surfaces.

## 🧹 Internal & Documentation Sync

- Added shared image module helpers (`imageMimeType`, `IMAGE_EXTENSIONS`) and main-process image data-URL reader (`readImageDataUrl`).
- Added IPC channels `FilesImage` and `FilesOpenSystem`.
- Updated reference documentation (`01-product-overview.md`, `05-ipc-contract.md`) and module `AGENTS.md` files.
- Bumped application version to 0.36.6.
