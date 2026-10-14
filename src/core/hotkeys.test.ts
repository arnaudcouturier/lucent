import { describe, expect, it } from 'vitest'
import { deploymentHotkeys, deploymentKeyCodes, keyName, liveKeyBindings, type KeyBinding } from './hotkeys'
import type { DeploymentRecord } from './deployment'
import { createFakePlatform } from '../platform/fake'

// Excerpts in the shape of the shipped content's configs.
const OPTISCALER = `[FrameGen]
Enabled = true

[Menu]
; Integer value - Default (auto) is 0x2D which equals VK_INSERT/Insert key
ShortcutKey = auto
FGShortcutKey = auto

[DlssNr]
ToggleKey = 0xDC
Enabled = true
`
const RESHADE = `[INPUT]
KeyEffects=114,0,1,0
KeyNextPreset=0,0,0,0
KeyOverlay=113,0,1,0
KeyScreenshot=44,0,0,0
`

const record = (overlay: 'neural-rendering' | 'upscaling' | null, configs: Record<string, string>, includeReShade = true) =>
  ({ recipe: { overlay } as DeploymentRecord['recipe'], ownedConfigs: configs, includeReShade })
const shown = (bindings: KeyBinding[]) => bindings.map((b) => `${b.tool} ${b.action}: ${b.keys?.join('+') ?? 'not set'}${b.shipped !== undefined ? ` (was ${b.shipped?.join('+') ?? 'not set'})` : ''}`)
const SHIPPED = record('neural-rendering', { 'OptiScaler.ini': OPTISCALER, 'ReShade.ini': RESHADE })

describe('The Done screen teaches the keys Lucent shipped', () => {
  it('reads OptiScaler and ReShade binds, modifiers included', () => {
    expect(shown(deploymentHotkeys(SHIPPED))).toEqual([
      'OptiScaler Menu: Insert', 'OptiScaler Neural Rendering on or off: \\', 'OptiScaler Frame generation on or off: End',
      'ReShade Menu: Shift+F2', 'ReShade Effects on or off: Shift+F3',
    ])
  })

  it('leaves out an unbound Neural Rendering toggle and frame generation that is off', () => {
    const config = OPTISCALER.replace('ToggleKey = 0xDC', 'ToggleKey = auto').replace('Enabled = true\n\n[Menu]', 'Enabled = false\n\n[Menu]')
    expect(shown(deploymentHotkeys(record('neural-rendering', { 'OptiScaler.ini': config }, false)))).toEqual(['OptiScaler Menu: Insert'])
  })

  it('falls back to each tool’s defaults when a config is missing', () => {
    expect(shown(deploymentHotkeys(record('upscaling', {})))).toEqual(['OptiScaler Menu: Insert', 'ReShade Menu: Home'])
    expect(shown(deploymentHotkeys(record(null, {})))).toEqual(['ReShade Menu: Home'])
  })
})

describe('The Keys screen reads the game folder’s configs as they are now', () => {
  it('lists every action, unbound ones included, and ReShade’s optional ones only once bound', () => {
    expect(shown(liveKeyBindings(SHIPPED, { optiScaler: OPTISCALER, reShade: RESHADE }))).toEqual([
      'OptiScaler Menu: Insert', 'OptiScaler Neural Rendering on or off: \\', 'OptiScaler Frame generation on or off: End',
      'OptiScaler FPS overlay: Page Up', 'OptiScaler FPS overlay style: Page Down',
      'ReShade Menu: Shift+F2', 'ReShade Effects on or off: Shift+F3', 'ReShade Screenshot: Print Screen',
    ])
  })

  it('shows a key changed in game, with what Lucent had set', () => {
    const optiScaler = OPTISCALER.replace('ShortcutKey = auto', 'ShortcutKey = 0x24').replace('ToggleKey = 0xDC', 'ToggleKey = -1')
    const reShade = RESHADE.replace('KeyOverlay=113,0,1,0', 'KeyOverlay=36,1,0,1').replace('KeyNextPreset=0,0,0,0', 'KeyNextPreset=34,0,1,0')
    expect(shown(liveKeyBindings(SHIPPED, { optiScaler, reShade })).filter((line) => line.includes('(was'))).toEqual([
      'OptiScaler Menu: Home (was Insert)', 'OptiScaler Neural Rendering on or off: not set (was \\)',
      'ReShade Menu: Ctrl+Alt+Home (was Shift+F2)', 'ReShade Next preset: Shift+Page Down (was not set)',
    ])
  })

  it('reads a missing file as the tool’s defaults and leaves out a tool that isn’t deployed', () => {
    const keys = shown(liveKeyBindings(record('neural-rendering', { 'OptiScaler.ini': OPTISCALER }, false), { optiScaler: null, reShade: RESHADE }))
    expect(keys[0]).toBe('OptiScaler Menu: Insert')
    expect(keys.some((line) => line.startsWith('ReShade'))).toBe(false)
  })

  it('names keys as a US keyboard labels them', () => {
    expect([0x2d, 0xdc, 0x23, 0x71, 0x41, 0x37, 0x63, 0x21].map((code) => keyName(code))).toEqual(['Insert', '\\', 'End', 'F2', 'A', '7', 'Num 3', 'Page Up'])
  })
})

describe('Keyboard layout names', () => {
  it('keeps the US fallback when the fake platform has no Windows names', async () => {
    const fake = createFakePlatform()
    const names = await fake.getKeyNames(deploymentKeyCodes(SHIPPED))
    expect(names).toEqual({})
    expect(shown(deploymentHotkeys(SHIPPED, names))[1]).toBe(`OptiScaler Neural Rendering on or off: ${String.fromCharCode(0x5c)}`)
    expect(keyName(0xdc, names)).toBe(String.fromCharCode(0x5c))
  })

  it('uses Windows names for keys and ReShade modifiers on the active layout', () => {
    const names = { 0x2d: 'Inser', 0xdc: '*', 0x23: 'Fin', 0x10: 'Maj', 0x71: 'F2', 0x72: 'F3' }
    expect(shown(deploymentHotkeys(SHIPPED, names))).toEqual([
      'OptiScaler Menu: Inser', 'OptiScaler Neural Rendering on or off: *', 'OptiScaler Frame generation on or off: Fin',
      'ReShade Menu: Maj+F2', 'ReShade Effects on or off: Maj+F3',
    ])
  })
})
