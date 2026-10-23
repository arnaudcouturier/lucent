import { describe, expect, it } from 'vitest'
import { focusHeld, focusLost, returnFocus } from './focus'

const control = (state: { isConnected?: boolean; disabled?: boolean } = {}) => {
  const calls: unknown[] = []
  return { isConnected: true, disabled: false, ...state, focus: (options?: unknown) => { calls.push(options) }, calls }
}

describe('returnFocus', () => {
  it('puts focus back on the control that opened a dialog', () => {
    const opener = control()
    returnFocus(opener)
    expect(opener.calls).toHaveLength(1)
  })

  it('leaves focus alone when the opener left with its screen, is disabled, or was never recorded', () => {
    const gone = control({ isConnected: false })
    const disabled = control({ disabled: true })
    returnFocus(gone)
    returnFocus(disabled)
    returnFocus(null)
    expect(gone.calls).toEqual([])
    expect(disabled.calls).toEqual([])
  })
})

describe('focusLost', () => {
  const body = {} as Element
  it('is true when the control that had focus left the page and focus fell to the body', () => {
    expect(focusLost(true, body, body)).toBe(true)
    expect(focusLost(true, null, body)).toBe(true)
  })

  it('is false while a control holds focus, so the rail’s arrow-key navigation is never interrupted', () => {
    expect(focusLost(true, {} as Element, body)).toBe(false)
  })

  it('is false at launch, before any control has held focus, so the first screen leaves Tab where it was', () => {
    expect(focusLost(false, body, body)).toBe(false)
    expect(focusHeld()).toBe(false)
  })
})
