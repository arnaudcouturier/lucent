// The small window Settings → Apps opens: it asks whether to restore the game folder, then removes Lucent.
import { useState } from 'react'
import { CircleCheck, LoaderCircle, Trash2, TriangleAlert, X } from 'lucide-react'
import { closeWindow, dragWindow } from './shell'
import { useCore, useGameRunningRefresh } from './useCore'

export function UninstallWindow() {
  const [{ busy, error, notice, gameRunning, appUninstalled }, core] = useCore()
  const [restore, setRestore] = useState(true)
  useGameRunningRefresh(core)
  // Leaving the game folder alone needs no process check; restoring it does.
  const blocked = restore && gameRunning !== false
  return (
    <div className="uninstall-window">
      <div className="titlebar" onMouseDown={dragWindow}>
        <button className="caption caption-close" aria-label="Close" onClick={closeWindow}>
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>
      <div className="uninstall-body">
        <header className="screen-head">
          <h1>{appUninstalled ? 'Lucent is uninstalled' : 'Uninstall Lucent'}</h1>
          <p>{appUninstalled ? 'Lucent has been removed from this PC.' : 'Removes Lucent, its Start menu shortcut, its XIVLauncher add-ons and its data from this PC.'}</p>
        </header>
        {!appUninstalled && <label className="card option-row">
          <input type="checkbox" checked={restore} disabled={busy} onChange={(e) => setRestore(e.target.checked)} />
          <span><strong>Restore the game folder</strong><small>{!restore ? 'Lucent’s files stay in the game folder, with no way to undo them later.' : gameRunning ? 'Close XIV first.' : 'Puts XIV back as it was before Lucent.'}</small></span>
        </label>}
        {error ? <p className="callout" role="alert"><TriangleAlert size={14} strokeWidth={1.75} /><span>{error}</span></p>
          : notice && <p className="callout is-notice" role="status"><CircleCheck size={14} strokeWidth={1.75} /><span>{notice}</span></p>}
        {!appUninstalled && <footer className="screen-actions">
          <button className="btn is-ghost" disabled={busy} onClick={closeWindow}>Cancel</button>
          <button className="btn is-danger" disabled={busy || blocked} onClick={() => void core.uninstallApp(restore)}>
            {busy ? <LoaderCircle size={14} strokeWidth={1.75} className="spin" /> : <Trash2 size={14} strokeWidth={1.75} />}{busy ? 'Uninstalling…' : 'Uninstall'}
          </button>
        </footer>}
      </div>
    </div>
  )
}
