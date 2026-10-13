// The ⋯ menu in the title strip, shown once a deployment exists. Uninstall asks for confirmation first.
import { useEffect, useRef, useState } from 'react'
import { Ellipsis, LoaderCircle, Trash2 } from 'lucide-react'
import { useCore } from './useCore'
import { gameActionsAvailable } from '../core/gameAccess'

export function Menu() {
  const [state] = useCore()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    addEventListener('mousedown', onDown)
    addEventListener('keydown', onKey)
    return () => { removeEventListener('mousedown', onDown); removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="caption" aria-label="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ellipsis size={16} strokeWidth={1.75} />
      </button>
      {open && <div className="menu" role="menu">
        <button role="menuitem" className="is-danger" disabled={!gameActionsAvailable(state)} autoFocus onClick={() => { setOpen(false); setConfirming(true) }}>Uninstall…</button>
      </div>}
      {confirming && <UninstallDialog onClose={() => setConfirming(false)} />}
    </div>
  )
}

function UninstallDialog({ onClose }: { onClose: () => void }) {
  const [state, core] = useCore()
  const { busy } = state
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  const uninstall = async () => {
    await core.uninstall()
    onClose()
  }
  return (
    <dialog ref={ref} className="confirm" aria-labelledby="uninstall-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose() }}>
      <h2 id="uninstall-title">Uninstall from this game?</h2>
      <p>Lucent restores the files it backed up and removes everything it added, including the logs the mods wrote. Your own presets and shaders stay.</p>
      <footer className="confirm-actions">
        <button className="btn is-ghost" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="btn is-danger" disabled={!gameActionsAvailable(state)} onClick={() => void uninstall()}>
          {busy ? <LoaderCircle size={14} strokeWidth={1.75} className="spin" /> : <Trash2 size={14} strokeWidth={1.75} />}{busy ? 'Uninstalling…' : 'Uninstall'}
        </button>
      </footer>
    </dialog>
  )
}
