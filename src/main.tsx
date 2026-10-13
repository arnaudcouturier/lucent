import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './ui/styles/tokens.css'
import './ui/styles/base.css'
import './ui/styles/app.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createCore } from './core/core'
import type { Platform } from './core/platform'
import { App } from './ui/App'
import { inTauri } from './ui/shell'
import { CoreContext } from './ui/useCore'

if (!inTauri) document.documentElement.classList.add('is-browser')
const params = new URLSearchParams(location.search)
const root = createRoot(document.getElementById('root')!)

if (import.meta.env.DEV && params.has('gallery')) {
  const { Gallery } = await import('./gallery/Gallery')
  root.render(<Gallery />)
} else {
  const platform = inTauri
    ? (await import('./platform/tauri')).createTauriPlatform()
    : (await import('./platform/browser')).createBrowserPlatform(params.get('machine'))
  const headless = await platform.getHeadlessMode()
  if (headless) {
    // Started by a XIVLauncher add-on: the window stays hidden, and the process ends with the run.
    try { await (await import('./core/autoRepair')).runHeadless(platform, headless) }
    finally { await platform.exit() }
  } else renderApp(platform)
}

function renderApp(platform: Platform) {
  const core = createCore(platform)
  void core.scan()
  root.render(
    <StrictMode>
      <CoreContext.Provider value={core}>
        <App />
      </CoreContext.Provider>
    </StrictMode>,
  )
}
