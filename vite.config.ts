import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import pkg from './package.json' with { type: 'json' }

// Tauri expects a fixed dev port and serves the built files from dist/.
// Vite must not watch src-tauri: cargo's build output there is locked while it compiles.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // Tests pin the app version: they compare it with fixture releases, so a version bump must not change their outcome.
  define: { __APP_VERSION__: JSON.stringify(process.env.VITEST ? '0.2.0-beta.1' : pkg.version) },
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  build: { target: 'chrome120', outDir: 'dist' },
  test: { include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] },
})
