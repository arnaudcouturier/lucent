import { describe, expect, it } from 'vitest'
import { blocksReload } from './shell'

const key = (key: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}) =>
  ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers })

describe('blocksReload', () => {
  const reloads = [
    ['F5', key('F5')],
    ['Ctrl+F5', key('F5', { ctrlKey: true })],
    ['Shift+F5', key('F5', { shiftKey: true })],
    ['Ctrl+R', key('r', { ctrlKey: true })],
    ['Ctrl+Shift+R, which reports a capital R', key('R', { ctrlKey: true, shiftKey: true })],
    ['Cmd+R', key('r', { metaKey: true })],
  ] as const

  it.each(reloads)('stops %s while the core is busy, so Recovery never meets a live batch', (_, event) => {
    expect(blocksReload(event, true)).toBe(true)
  })

  it.each(reloads)('lets %s through when the core is idle, which the maintainer relies on', (_, event) => {
    expect(blocksReload(event, false)).toBe(false)
  })

  it('leaves every other key alone, busy or not', () => {
    for (const event of [key('r'), key('R', { shiftKey: true }), key('F4'), key('F6'), key('Enter'), key('f', { ctrlKey: true }), key('p', { ctrlKey: true }), key('r', { altKey: true })]) {
      expect(blocksReload(event, true)).toBe(false)
    }
  })
})
