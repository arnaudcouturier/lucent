// The keys the deployed tools answer to in game, read from their config files. A key a config leaves out (or sets
// to `auto`) is the tool's own default. Read from the game folder, the list shows a key the player changed in game;
// read from the configs Lucent wrote, it is what Lucent shipped.
import { readIni } from './ini'
import type { DeploymentRecord } from './deployment'
import { fileKey } from './planner'

export type KeyTool = 'OptiScaler' | 'ReShade'

export interface KeyBinding {
  tool: KeyTool
  action: string
  /** A few words on what the action reaches, when its name alone doesn't say. */
  hint?: string
  /** The keys pressed together, modifiers first, such as ['Shift', 'F2']; null when the action is unbound. */
  keys: string[] | null
  /** What Lucent wrote for this action, present only when the file now says something else. */
  shipped?: string[] | null
  /** Taught on the Done screen. */
  essential: boolean
}

/** The config texts to read keys from; null leaves that tool out (not deployed). An empty text means all defaults. */
export interface KeyConfigs { optiScaler: string | null; reShade: string | null }

/** Where Lucent's guide lives: keybinds, every setting it ships, and how to use it. */
export const GUIDE_URL = 'https://arnaudcouturier.github.io/lucent/guide.html'

const NAMED_KEYS: Record<number, string> = {
  0x08: 'Backspace', 0x09: 'Tab', 0x0d: 'Enter', 0x13: 'Pause', 0x14: 'Caps Lock', 0x1b: 'Esc', 0x20: 'Space',
  0x21: 'Page Up', 0x22: 'Page Down', 0x23: 'End', 0x24: 'Home', 0x25: '←', 0x26: '↑', 0x27: '→', 0x28: '↓',
  0x2c: 'Print Screen', 0x2d: 'Insert', 0x2e: 'Delete', 0x6a: 'Num *', 0x6b: 'Num +', 0x6d: 'Num -', 0x6e: 'Num .', 0x6f: 'Num /',
  0x90: 'Num Lock', 0x91: 'Scroll Lock', 0xba: ';', 0xbb: '=', 0xbc: ',', 0xbd: '-', 0xbe: '.', 0xbf: '/', 0xc0: '`',
  0xdb: '[', 0xdc: '\\', 0xdd: ']', 0xde: "'", 0xe2: '\\',
}

/** A Windows virtual-key code as the key's label on a US keyboard. */
export function keyName(code: number): string {
  if (NAMED_KEYS[code]) return NAMED_KEYS[code]
  if (code >= 0x30 && code <= 0x39 || code >= 0x41 && code <= 0x5a) return String.fromCharCode(code)
  if (code >= 0x60 && code <= 0x69) return `Num ${code - 0x60}`
  if (code >= 0x70 && code <= 0x87) return `F${code - 0x6f}`
  return `Key ${code}`
}

type Config = ReturnType<typeof readIni>

/** OptiScaler reads decimal or `0x` hex; `auto` or no value is its default, and -1 (or 0) leaves the action unbound. */
function optiScalerKey(config: Config, section: string, key: string, fallback: number | null): string[] | null {
  const value = config.get(section, key)?.trim()
  const code = !value || value.toLowerCase() === 'auto' ? fallback : /^0x[0-9a-f]+$/i.test(value) ? parseInt(value, 16) : /^-?\d+$/.test(value) ? parseInt(value, 10) : fallback
  return code && code > 0 ? [keyName(code)] : null
}

/** ReShade stores a shortcut as `key,ctrl,shift,alt`; a key of 0 is unbound. */
function reShadeKey(config: Config, key: string, fallback: number | null): string[] | null {
  const value = config.get('INPUT', key)
  const parts = value === undefined ? (fallback ? [fallback, 0, 0, 0] : null) : value.split(',').map((n) => parseInt(n.trim(), 10))
  if (!parts || !(parts[0] > 0)) return null
  return [...(parts[1] ? ['Ctrl'] : []), ...(parts[2] ? ['Shift'] : []), ...(parts[3] ? ['Alt'] : []), keyName(parts[0])]
}

const truthy = (value: string | undefined) => value?.trim().toLowerCase() === 'true'
type Overlay = DeploymentRecord['recipe']['overlay']

/** Every action of the deployed tools with its key, unbound ones included where the tool always offers them. */
function readBindings(configs: KeyConfigs, overlay: Overlay): KeyBinding[] {
  const bindings: KeyBinding[] = []
  if (configs.optiScaler !== null && overlay) {
    // Defaults from OptiScaler's Config.h: the menu on Insert, frame generation on End, the FPS overlay on
    // Page Up and its style on Page Down, Neural Rendering unbound.
    const config = readIni(configs.optiScaler)
    const tool = 'OptiScaler'
    bindings.push({ tool, action: 'Menu', hint: overlay === 'neural-rendering' ? 'Neural Rendering, upscaling and frame generation' : 'FSR upscaling and frame generation', keys: optiScalerKey(config, 'Menu', 'ShortcutKey', 0x2d), essential: true })
    if (overlay === 'neural-rendering') bindings.push({ tool, action: 'Neural Rendering on or off', keys: optiScalerKey(config, 'DlssNr', 'ToggleKey', null), essential: true })
    bindings.push({ tool, action: 'Frame generation on or off', keys: optiScalerKey(config, 'Menu', 'FGShortcutKey', 0x23), essential: truthy(config.get('FrameGen', 'Enabled')) })
    bindings.push({ tool, action: 'FPS overlay', keys: optiScalerKey(config, 'Menu', 'FpsShortcutKey', 0x21), essential: false })
    bindings.push({ tool, action: 'FPS overlay style', keys: optiScalerKey(config, 'Menu', 'FpsCycleShortcutKey', 0x22), essential: false })
  }
  if (configs.reShade !== null) {
    // ReShade's own defaults: the overlay on Home, screenshots on Print Screen, everything else unbound.
    const config = readIni(configs.reShade)
    const tool = 'ReShade'
    bindings.push({ tool, action: 'Menu', hint: 'Choose a preset', keys: reShadeKey(config, 'KeyOverlay', 0x24), essential: true })
    bindings.push({ tool, action: 'Effects on or off', keys: reShadeKey(config, 'KeyEffects', null), essential: true })
    bindings.push({ tool, action: 'Screenshot', keys: reShadeKey(config, 'KeyScreenshot', 0x2c), essential: false })
    for (const [action, key] of [['Next preset', 'KeyNextPreset'], ['Previous preset', 'KeyPreviousPreset'], ['Reload effects', 'KeyReload'], ['FPS counter', 'KeyFPS'], ['Frame time', 'KeyFrametime']]) {
      const keys = reShadeKey(config, key, null)
      if (keys) bindings.push({ tool, action, keys, essential: false })
    }
  }
  return bindings
}

/** The configs Lucent last wrote for this deployment, as `KeyConfigs`. */
function shippedConfigs(record: Pick<DeploymentRecord, 'recipe' | 'ownedConfigs' | 'includeReShade'>): KeyConfigs {
  const text = (name: string) => Object.entries(record.ownedConfigs).find(([path]) => fileKey(path) === fileKey(name))?.[1] ?? ''
  return { optiScaler: record.recipe.overlay ? text('OptiScaler.ini') : null, reShade: record.includeReShade ? text('ReShade.ini') : null }
}

/** The keys a fresh deployment teaches on the Done screen: what Lucent shipped, bound and essential. */
export function deploymentHotkeys(record: Pick<DeploymentRecord, 'recipe' | 'ownedConfigs' | 'includeReShade'>): KeyBinding[] {
  return readBindings(shippedConfigs(record), record.recipe.overlay).filter((b) => b.essential && b.keys)
}

/**
 * Every key as the game folder's configs say now (a missing file means the tool's defaults), each marked with
 * what Lucent shipped when the player has changed it since.
 */
export function liveKeyBindings(record: Pick<DeploymentRecord, 'recipe' | 'ownedConfigs' | 'includeReShade'>, onDisk: KeyConfigs): KeyBinding[] {
  const shipped = shippedConfigs(record)
  const configs = { optiScaler: shipped.optiScaler === null ? null : onDisk.optiScaler ?? '', reShade: shipped.reShade === null ? null : onDisk.reShade ?? '' }
  const original = readBindings(shipped, record.recipe.overlay)
  return readBindings(configs, record.recipe.overlay).map((binding) => {
    const before = original.find((b) => b.tool === binding.tool && b.action === binding.action)
    const same = (before?.keys ?? null)?.join('+') === (binding.keys ?? null)?.join('+')
    return same ? binding : { ...binding, shipped: before?.keys ?? null }
  })
}
