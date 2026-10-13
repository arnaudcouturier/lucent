// The window itself: caption buttons, dragging and maximizing. These are UI chrome, not machine access, so they
// sit outside the Platform port. In a browser (dev mode) they do nothing.
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { MouseEvent } from 'react'

export const inTauri = isTauri()

export const minimizeWindow = () => (inTauri ? getCurrentWindow().minimize() : undefined)
export const toggleMaximizeWindow = () => (inTauri ? getCurrentWindow().toggleMaximize() : undefined)

/** Calls `listener` with whether the window is maximized now and after every resize. */
export function observeMaximized(listener: (maximized: boolean) => void): () => void {
  if (!inTauri) return () => {}
  const window = getCurrentWindow()
  let disposed = false
  let unlisten: (() => void) | undefined
  const check = () => void window.isMaximized().then((maximized) => { if (!disposed) listener(maximized) }).catch(() => {})
  void window.onResized(check).then((stop) => { if (disposed) stop(); else unlisten = stop })
  check()
  return () => { disposed = true; unlisten?.() }
}
export const closeWindow = () => (inTauri ? getCurrentWindow().close() : undefined)

/** Native focus covers minimize and Alt-Tab even when the WebView's DOM focus is stale. */
export function observeWindowFocus(listener: (focused: boolean) => void): () => void {
  if (!inTauri) return () => {}
  const window = getCurrentWindow()
  let disposed = false
  let revision = 0
  let unlisten: (() => void) | undefined
  void window.onFocusChanged(({ payload }) => {
    revision++
    if (!disposed) listener(payload)
  }).then(async (stop) => {
    if (disposed) { stop(); return }
    unlisten = stop
    const before = revision
    const focused = await window.isFocused()
    if (!disposed && before === revision) listener(focused)
  }).catch(() => {
    if (!disposed) listener(document.hasFocus())
  })
  return () => { disposed = true; unlisten?.() }
}

const INTERACTIVE = 'button, a, input, select, textarea, label, [role="button"], [data-no-drag]'

/** onMouseDown for a drag region: drags the window, or maximizes and restores it on a double-click, unless the press lands on a control. */
export function dragWindow(e: MouseEvent) {
  if (!inTauri || e.button !== 0 || (e.target as Element).closest(INTERACTIVE)) return
  e.preventDefault()
  void (e.detail === 2 ? getCurrentWindow().toggleMaximize() : getCurrentWindow().startDragging())
}
