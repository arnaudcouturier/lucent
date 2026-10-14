import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { manifestPlaceholders } from './manifest-pages.ts'

const page = (name: string) => fileURLToPath(new URL(`./${name}`, import.meta.url))
const MANIFEST = fileURLToPath(new URL('../manifest.json', import.meta.url))

/** Fills the pages' `<!-- lucent:… -->` placeholders from manifest.json, so they list exactly what Lucent installs. */
function manifestContent(): Plugin {
  return {
    name: 'lucent-manifest-content',
    configureServer(server) { server.watcher.add(MANIFEST) },
    transformIndexHtml(html) {
      for (const [placeholder, content] of Object.entries(manifestPlaceholders(MANIFEST))) html = html.split(placeholder).join(content)
      return html
    },
  }
}

// A separate static build: Pages never receives the app or its dev gallery.
export default defineConfig({
  root: 'site',
  base: './', // Works at /lucent/ and when previewed at the origin root.
  plugins: [manifestContent()],
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true },
  build: {
    outDir: '../site-dist',
    emptyOutDir: true,
    rollupOptions: { input: { index: page('index.html'), guide: page('guide.html'), files: page('files.html') } },
  },
})
