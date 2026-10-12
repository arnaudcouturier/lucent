// The window itself: caption buttons and dragging. These are UI chrome, not machine access, so they
// sit outside the Platform port. In a browser (dev mode) they do nothing.
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { MouseEvent } from 'react'

export const inTauri = isTauri()

export const minimizeWindow = () => (inTauri ? getCurrentWindow().minimize() : undefined)
export const closeWindow = () => (inTauri ? getCurrentWindow().close() : undefined)

const INTERACTIVE = 'button, a, input, select, textarea, label, [role="button"], [data-no-drag]'

/** onMouseDown for a drag region: drags the window, unless the press lands on a control. */
export function dragWindow(e: MouseEvent) {
  if (!inTauri || e.button !== 0 || (e.target as Element).closest(INTERACTIVE)) return
  e.preventDefault()
  void getCurrentWindow().startDragging()
}
