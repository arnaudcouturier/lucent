import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './ui/styles/tokens.css'
import './ui/styles/base.css'
import './ui/styles/app.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createCore } from './core/core'
import { App } from './ui/App'
import { UninstallWindow } from './ui/UninstallWindow'
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
    : (await import('./platform/browser')).createBrowserPlatform(params.get('machine'), params.has('uninstall'))
  const core = createCore(platform)
  // Settings → Apps starts Lucent with --uninstall: the small uninstall window instead of the main one.
  const uninstalling = await platform.headlessMode().catch(() => null) === 'uninstall'
  void (uninstalling ? core.openAppUninstall() : core.scan())
  root.render(
    <StrictMode>
      <CoreContext.Provider value={core}>
        {uninstalling ? <UninstallWindow /> : <App />}
      </CoreContext.Provider>
    </StrictMode>,
  )
}
