import { defineConfig } from '@playwright/test'

// The dev app (`npm run dev`) exports ELECTRON_RENDERER_URL to every process it
// spawns, and a shell started from inside it inherits both variables. main loads
// the renderer from that URL when it is set, so a leaked value makes the suite
// render the vite dev server — the current checkout's src/ — and silently ignore
// the built out/. Strip them here so every spec exercises the build.
delete process.env['ELECTRON_RENDERER_URL']
delete process.env['NODE_ENV_ELECTRON_VITE']

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  workers: 1,
  retries: 0
})
