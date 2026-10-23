// The small window Settings → Apps opens: it asks whether to restore the game folder, then removes Lucent.
import { useEffect, useState } from 'react'
import { CircleCheck, LoaderCircle, Trash2, TriangleAlert, X } from 'lucide-react'
import { closeWindow, dragWindow, interceptClose } from './shell'
import { useCore, useGameRunningRefresh } from './useCore'
import { FolderPath } from './Path'

export function UninstallWindow() {
  const [{ busy, error, notice, gameRunning, appUninstalled, appUninstallBackups, lucentOpenElsewhere }, core] = useCore()
  const [restore, setRestore] = useState(true)
  useGameRunningRefresh(core)
  // Like the game check: once a second, so Uninstall becomes available as soon as the other window closes.
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      await core.refreshLucentElsewhere()
      if (!stopped) timer = setTimeout(() => void refresh(), 1000)
    }
    timer = setTimeout(() => void refresh(), 1000)
    return () => { stopped = true; clearTimeout(timer) }
  }, [core])
  // Closing by Alt+F4 or the taskbar must finish the removal too, or the folder and exe stay with no Settings → Apps entry left.
  useEffect(() => appUninstalled ? interceptClose(() => void core.finishAppUninstall()) : undefined, [appUninstalled, core])
  // Leaving the game folder alone needs no process check; restoring it does.
  const blocked = restore && gameRunning !== false
  // Once uninstalled, closing is what removes the data folder and the exe: Lucent exits as it does.
  const close = appUninstalled ? () => void core.finishAppUninstall() : closeWindow
  const backups = appUninstallBackups && (!restore || appUninstallBackups.withRestore) ? appUninstallBackups.path : null
  return (
    <div className="uninstall-window">
      <div className="titlebar" onMouseDown={dragWindow}>
        <button className="caption caption-close" aria-label="Close" disabled={appUninstalled && busy} onClick={close}>
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>
      <div className="uninstall-body">
        <header className="screen-head">
          <h1>{appUninstalled ? 'Lucent is uninstalled' : 'Uninstall Lucent'}</h1>
          <p>{appUninstalled ? 'Lucent has been removed from this PC. Its folder goes when you close this window.' : 'Removes Lucent, its Start menu shortcut, its XIVLauncher add-ons and its data from this PC.'}</p>
          {!appUninstalled && backups && <p>That includes the copies of files Lucent replaced in your game folder, in <FolderPath path={backups} />. Move them elsewhere first to keep them.</p>}
        </header>
        {!appUninstalled && <label className="card option-row">
          <input type="checkbox" checked={restore} disabled={busy} onChange={(e) => setRestore(e.target.checked)} />
          <span><strong>Restore the game folder</strong><small>{!restore ? 'Lucent’s files stay in the game folder, with no way to undo them later.' : gameRunning ? 'Close XIV first.' : 'Puts XIV back as it was before Lucent.'}</small></span>
        </label>}
        {!appUninstalled && lucentOpenElsewhere && <p className="callout" role="status"><TriangleAlert size={14} strokeWidth={1.75} /><span>Lucent is open in another window. Close it first, then uninstall.</span></p>}
        {error ? <p className="callout" role="alert"><TriangleAlert size={14} strokeWidth={1.75} /><span>{error}</span></p>
          : notice && <p className="callout is-notice" role="status"><CircleCheck size={14} strokeWidth={1.75} /><span>{notice}</span></p>}
        <footer className="screen-actions">
          {appUninstalled ? <button className="btn is-primary" disabled={busy} onClick={close}>Close</button> : <>
            <button className="btn is-ghost" disabled={busy} onClick={closeWindow}>Cancel</button>
            <button className="btn is-danger" disabled={busy || blocked || lucentOpenElsewhere} onClick={() => void core.uninstallApp(restore)}>
              {busy ? <LoaderCircle size={14} strokeWidth={1.75} className="spin" /> : <Trash2 size={14} strokeWidth={1.75} />}{busy ? 'Uninstalling…' : 'Uninstall'}
            </button>
          </>}
        </footer>
      </div>
    </div>
  )
}
