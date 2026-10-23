// Where keyboard focus goes when something leaves the page: a dialog closing, or a screen being swapped for the next.

/** Whether any control has held focus since launch. At launch none has, so the first screen leaves Tab where it was. */
let held = false
if (typeof document !== 'undefined') document.addEventListener('focusin', () => { held = true }, { capture: true, once: true })
export const focusHeld = () => held

/** Whether focus has fallen to the page itself, as it does when the control that held it is removed. */
export const focusLost = (everHeld: boolean, active: Element | null, body: Element) => everHeld && (!active || active === body)

/** Puts focus back on the control that opened a dialog, unless it left with its screen or is disabled now. */
export function returnFocus(opener: { isConnected: boolean; disabled?: boolean; focus(): void } | null) {
  if (opener?.isConnected && !opener.disabled) opener.focus()
}
