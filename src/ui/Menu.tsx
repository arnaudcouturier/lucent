// The ⋯ menu in the title strip, shown once a deployment exists. Uninstall asks for confirmation first.
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import { Bug, ClipboardCopy, Ellipsis, History, LoaderCircle, Trash2, UsersRound } from 'lucide-react'
import { useCore } from './useCore'
import { gameActionsAvailable } from '../core/gameAccess'

export function Menu({ onOpenCredits, onOpenVersions, returnFocusRef }: { onOpenCredits: () => void; onOpenVersions: () => void; returnFocusRef: RefObject<HTMLButtonElement | null> }) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const focusLastOnOpen = useRef(false)
  const [state, core] = useCore()
  const disabled = state.busy || actionBusy

  const openMenu = (focusLast = false) => {
    focusLastOnOpen.current = focusLast
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        returnFocusRef.current?.focus()
      }
    }
    addEventListener('mousedown', onDown)
    addEventListener('keydown', onKey)
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('.menu button:not(:disabled)') ?? [])]
    if (focusLastOnOpen.current) items.at(-1)?.focus()
    else items[0]?.focus()
    focusLastOnOpen.current = false
    return () => { removeEventListener('mousedown', onDown); removeEventListener('keydown', onKey) }
  }, [open])

  const run = async (action: () => Promise<void>) => {
    setOpen(false)
    returnFocusRef.current?.focus()
    setActionBusy(true)
    try { await action() } catch { /* Core reports command failures through its observable state. */ }
    finally { setActionBusy(false) }
  }

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('.menu button:not(:disabled)') ?? [])]
    if (!items.length) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    let next = -1
    if (e.key === 'ArrowDown') next = (current + 1) % items.length
    else if (e.key === 'ArrowUp') next = (current - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      returnFocusRef.current?.focus()
      return
    } else if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    if (next >= 0) {
      e.preventDefault()
      items[next].focus()
    }
  }

  return (
    <div className="menu-wrap" ref={ref} data-no-drag>
      <button ref={returnFocusRef} className="caption" aria-label="More" aria-haspopup="menu" aria-expanded={open}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openMenu(e.key === 'ArrowUp') } }}
        onClick={() => { if (open) setOpen(false); else openMenu() }}>
        <Ellipsis size={16} strokeWidth={1.75} />
      </button>
      {open && <div className="menu" role="menu" aria-label="More actions" onKeyDown={onMenuKeyDown}>
        <button role="menuitem" tabIndex={-1} disabled={disabled} onClick={() => { setOpen(false); onOpenVersions() }}><History size={14} strokeWidth={1.75} />Versions…</button>
        <button role="menuitem" tabIndex={-1} disabled={disabled} onClick={() => void run(() => core.copyDiagnostics())}><ClipboardCopy size={14} strokeWidth={1.75} />Copy diagnostics</button>
        <button role="menuitem" tabIndex={-1} disabled={disabled} onClick={() => void run(() => core.reportBug())}><Bug size={14} strokeWidth={1.75} />Report a bug</button>
        <button role="menuitem" tabIndex={-1} onClick={() => { setOpen(false); onOpenCredits() }}><UsersRound size={14} strokeWidth={1.75} />Credits</button>
        <div role="separator" />
        <button role="menuitem" tabIndex={-1} className="is-danger" disabled={disabled || !gameActionsAvailable(state)} onClick={() => { setOpen(false); setConfirming(true) }}>Uninstall…</button>
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
