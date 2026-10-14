// The keys the deployed tools answer to in game, read from their config files in the game folder. A key a config
// leaves out (or sets to `auto`) is the tool's own default. The configs are the player's, so the list shows a key they
// changed in game.
import { readIni } from './ini'
import type { DeploymentRecord } from './deployment'

export type KeyTool = 'OptiScaler' | 'ReShade'

export interface KeyBinding {
  tool: KeyTool
  action: string
  /** A few words on what the action reaches, when its name alone doesn't say. */
  hint?: string
  /** The keys pressed together, modifiers first, such as ['Shift', 'F2']; null when the action is unbound. */
  keys: string[] | null
  /** Taught on the Done screen. */
  essential: boolean
}

/** The config texts to read keys from; null leaves that tool out (not deployed). An empty text means all defaults. */
export interface KeyConfigs { optiScaler: string | null; reShade: string | null }

/** Where Lucent's guide lives: keybinds, every setting it ships, and how to use it. */
export const GUIDE_URL = 'https://arnaudcouturier.github.io/lucent/guide.html'

const NAMED_KEYS: Record<number, string> = {
  0x08: 'Backspace', 0x09: 'Tab', 0x0d: 'Enter', 0x13: 'Pause', 0x14: 'Caps Lock', 0x1b: 'Esc', 0x20: 'Space',
  0x10: 'Shift', 0x11: 'Ctrl', 0x12: 'Alt',
  0x21: 'Page Up', 0x22: 'Page Down', 0x23: 'End', 0x24: 'Home', 0x25: '←', 0x26: '↑', 0x27: '→', 0x28: '↓',
  0x2c: 'Print Screen', 0x2d: 'Insert', 0x2e: 'Delete', 0x6a: 'Num *', 0x6b: 'Num +', 0x6d: 'Num -', 0x6e: 'Num .', 0x6f: 'Num /',
  0x90: 'Num Lock', 0x91: 'Scroll Lock', 0xba: ';', 0xbb: '=', 0xbc: ',', 0xbd: '-', 0xbe: '.', 0xbf: '/', 0xc0: '`',
  0xdb: '[', 0xdc: '\\', 0xdd: ']', 0xde: "'", 0xe2: '\\',
}

/** A Windows virtual-key code as Windows names it, or as a US keyboard labels it when no OS name is available. */
export function keyName(code: number, windowsNames: Readonly<Record<number, string>> = {}): string {
  const windowsName = windowsNames[code]?.trim()
  if (windowsName) return windowsName
  if (NAMED_KEYS[code]) return NAMED_KEYS[code]
  if (code >= 0x30 && code <= 0x39 || code >= 0x41 && code <= 0x5a) return String.fromCharCode(code)
  if (code >= 0x60 && code <= 0x69) return `Num ${code - 0x60}`
  if (code >= 0x70 && code <= 0x87) return `F${code - 0x6f}`
  return `Key ${code}`
}

type Config = ReturnType<typeof readIni>

/** OptiScaler reads decimal or `0x` hex; `auto` or no value is its default, and -1 (or 0) leaves the action unbound. */
function optiScalerCode(config: Config, section: string, key: string, fallback: number | null): number | null {
  const value = config.get(section, key)?.trim()
  const code = !value || value.toLowerCase() === 'auto' ? fallback : /^0x[0-9a-f]+$/i.test(value) ? parseInt(value, 16) : /^-?\d+$/.test(value) ? parseInt(value, 10) : fallback
  return code && code > 0 ? code : null
}

/** ReShade stores a shortcut as `key,ctrl,shift,alt`; a key of 0 is unbound. */
function reShadeCodes(config: Config, key: string, fallback: number | null): number[] | null {
  const value = config.get('INPUT', key)
  const parts = value === undefined ? (fallback ? [fallback, 0, 0, 0] : null) : value.split(',').map((n) => parseInt(n.trim(), 10))
  if (!parts || !(parts[0] > 0)) return null
  return [...(parts[1] ? [0x11] : []), ...(parts[2] ? [0x10] : []), ...(parts[3] ? [0x12] : []), parts[0]]
}

const truthy = (value: string | undefined) => value?.trim().toLowerCase() === 'true'
type Overlay = DeploymentRecord['recipe']['overlay']

interface BindingCodes {
  tool: KeyTool
  action: string
  hint?: string
  virtualKeys: number[] | null
  essential: boolean
  includeWhenUnbound: boolean
}

/** One source for each action's config key, default, and screen visibility; labels and OS lookups derive from it. */
function bindingCodes(configs: KeyConfigs, overlay: Overlay): BindingCodes[] {
  const bindings: BindingCodes[] = []
  if (configs.optiScaler !== null && overlay) {
    // Defaults from OptiScaler's Config.h: the menu on Insert, frame generation on End, the FPS overlay on
    // Page Up and its style on Page Down, Neural Rendering unbound.
    const config = readIni(configs.optiScaler)
    const actions = [
      { action: 'Menu', section: 'Menu', key: 'ShortcutKey', fallback: 0x2d, hint: overlay === 'neural-rendering' ? 'Neural Rendering, upscaling and frame generation' : 'FSR upscaling and frame generation', essential: true },
      ...(overlay === 'neural-rendering' ? [{ action: 'Neural Rendering on or off', section: 'DlssNr', key: 'ToggleKey', fallback: null, essential: true }] : []),
      { action: 'Frame generation on or off', section: 'Menu', key: 'FGShortcutKey', fallback: 0x23, essential: truthy(config.get('FrameGen', 'Enabled')) },
      { action: 'FPS overlay', section: 'Menu', key: 'FpsShortcutKey', fallback: 0x21, essential: true },
      { action: 'FPS overlay style', section: 'Menu', key: 'FpsCycleShortcutKey', fallback: 0x22, essential: false },
    ]
    for (const { action, section, key, fallback, hint, essential } of actions) {
      const code = optiScalerCode(config, section, key, fallback)
      bindings.push({ tool: 'OptiScaler', action, hint, virtualKeys: code ? [code] : null, essential, includeWhenUnbound: true })
    }
  }
  if (configs.reShade !== null) {
    // ReShade's own defaults: the overlay on Home, screenshots on Print Screen, everything else unbound.
    const config = readIni(configs.reShade)
    const actions = [
      { action: 'Menu', key: 'KeyOverlay', fallback: 0x24, hint: 'Choose a preset', essential: true, includeWhenUnbound: true },
      { action: 'Effects on or off', key: 'KeyEffects', fallback: null, essential: true, includeWhenUnbound: true },
      { action: 'Screenshot', key: 'KeyScreenshot', fallback: 0x2c, essential: false, includeWhenUnbound: true },
      { action: 'Next preset', key: 'KeyNextPreset', fallback: null, essential: false, includeWhenUnbound: false },
      { action: 'Previous preset', key: 'KeyPreviousPreset', fallback: null, essential: false, includeWhenUnbound: false },
      { action: 'Reload effects', key: 'KeyReload', fallback: null, essential: false, includeWhenUnbound: false },
      { action: 'FPS counter', key: 'KeyFPS', fallback: null, essential: false, includeWhenUnbound: false },
      { action: 'Frame time', key: 'KeyFrametime', fallback: null, essential: false, includeWhenUnbound: false },
    ]
    for (const { action, key, fallback, hint, essential, includeWhenUnbound } of actions) {
      bindings.push({ tool: 'ReShade', action, hint, virtualKeys: reShadeCodes(config, key, fallback), essential, includeWhenUnbound })
    }
  }
  return bindings
}

/** Every visible action with names for its virtual keys. */
function readBindings(configs: KeyConfigs, overlay: Overlay, names: Readonly<Record<number, string>>): KeyBinding[] {
  return bindingCodes(configs, overlay)
    .filter((binding) => binding.includeWhenUnbound || binding.virtualKeys !== null)
    .map(({ virtualKeys, includeWhenUnbound: _includeWhenUnbound, hint, ...binding }) => ({
      ...binding,
      ...(hint === undefined ? {} : { hint }),
      keys: virtualKeys?.map((code) => keyName(code, names)) ?? null,
    }))
}

type KeyRecord = Pick<DeploymentRecord, 'recipe' | 'includeReShade'>

/** The configs of the tools this deployment has; a file that can't be read leaves its tool on the defaults. */
function deployedConfigs(record: KeyRecord, onDisk: KeyConfigs): KeyConfigs {
  return { optiScaler: record.recipe.overlay ? onDisk.optiScaler ?? '' : null, reShade: record.includeReShade ? onDisk.reShade ?? '' : null }
}

/** The keys a fresh deployment teaches on the Done screen: bound and essential, as the configs it just wrote say. */
export function deploymentHotkeys(record: KeyRecord, onDisk: KeyConfigs, names: Readonly<Record<number, string>> = {}): KeyBinding[] {
  return readBindings(deployedConfigs(record, onDisk), record.recipe.overlay, names).filter((b) => b.essential && b.keys)
}

/** Every key as the game folder's configs say now (a missing file means the tool's defaults). */
export function liveKeyBindings(record: KeyRecord, onDisk: KeyConfigs, names: Readonly<Record<number, string>> = {}): KeyBinding[] {
  return readBindings(deployedConfigs(record, onDisk), record.recipe.overlay, names)
}

/** The virtual keys whose names are needed to show these configs' bindings. */
export function liveKeyCodes(record: KeyRecord, onDisk: KeyConfigs): number[] {
  return [...new Set(bindingCodes(deployedConfigs(record, onDisk), record.recipe.overlay).flatMap(({ virtualKeys }) => virtualKeys ?? []))]
}
