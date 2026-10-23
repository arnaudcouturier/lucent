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
import { UninstallWindow } from './ui/UninstallWindow'
import { blocksReload, inTauri } from './ui/shell'
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
  const mode = await platform.headlessMode().catch(() => null)
  if (mode === 'check' || mode === 'repair') {
    // Started by a XIVLauncher add-on: the window stays hidden, and the process ends with the run.
    try { await (await import('./core/autoRepair')).runHeadless(platform, mode) }
    finally { await platform.exit() }
  } else renderApp(platform, mode === 'uninstall')
}

function renderApp(platform: Platform, uninstalling: boolean) {
  const core = createCore(platform)
  // The webview's reload keys stay available when nothing runs (the maintainer relies on them), but not mid-operation:
  // the reloaded context would release the lease while the old one is still writing, and Recovery would meet a live batch.
  addEventListener('keydown', (e) => { if (blocksReload(e, core.getState().busy)) e.preventDefault() }, true)
  // The webview's right-click menu has a Reload entry too; it stays when idle, like the keys.
  addEventListener('contextmenu', (e) => { if (core.getState().busy) e.preventDefault() }, true)
  // A reloaded webview (F5) orphaned the old context's operation leases in this process; drop them so
  // Scan can recover any half-applied install instead of reporting the lock held until restart.
  void (async () => {
    await platform.resetOperationLocks().catch(() => {})
    // Settings → Apps starts Lucent with --uninstall: the small uninstall window instead of the main one.
    await (uninstalling ? core.openAppUninstall() : core.scan())
  })()
  root.render(
    <StrictMode>
      <CoreContext.Provider value={core}>
        {uninstalling ? <UninstallWindow /> : <App />}
      </CoreContext.Provider>
    </StrictMode>,
  )
}
