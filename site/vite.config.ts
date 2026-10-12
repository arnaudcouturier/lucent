import { defineConfig } from 'vite'

// A separate static build: Pages never receives the app or its dev gallery.
export default defineConfig({
  root: 'site',
  base: './', // Works at /lucent/ and when previewed at the origin root.
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true },
  build: { outDir: '../site-dist', emptyOutDir: true },
})
