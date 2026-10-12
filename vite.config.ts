import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import pkg from './package.json' with { type: 'json' }

// Tauri expects a fixed dev port and serves the built files from dist/.
// Vite must not watch src-tauri: cargo's build output there is locked while it compiles.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  build: { target: 'chrome120', outDir: 'dist' },
  test: { include: ['src/**/*.test.ts'] },
})
