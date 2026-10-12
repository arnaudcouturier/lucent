// PROTOTYPE: fake data only. Identifiers follow CONTEXT.md; on-screen copy may say "Install".

export type GpuKey = 'rtx4090' | 'rtx5080' | 'rtx2080' | 'rx7900'
export type TierStatus = 'Stable' | 'Experimental' | 'Community-verified'
export type ProfileKey = 'fidelity' | 'balanced' | 'performance'
export type Screen = 'scan' | 'profile' | 'review' | 'install' | 'done' | 'main'
export type MainScenario = 'healthy' | 'drift' | 'update' | 'disabled' | 'custom'

export const FIRST_RUN: Screen[] = ['scan', 'profile', 'review', 'install', 'done']
export const SCREENS: Screen[] = [...FIRST_RUN, 'main']

export const SCREEN_LABEL: Record<Screen, string> = {
  scan: 'Scan',
  profile: 'Profile',
  review: 'Review',
  install: 'Install',
  done: 'Done',
  main: 'Main',
}

export interface Gpu {
  key: GpuKey
  name: string
  short: string
  driver: string
  tier: string
  tierStatus: TierStatus
  neuralRendering: boolean
  reshadeRequired: boolean
}

export const GPUS: Record<GpuKey, Gpu> = {
  rtx4090: {
    key: 'rtx4090',
    name: 'NVIDIA GeForce RTX 4090',
    short: 'RTX 4090',
    driver: '591.44',
    tier: 'RTX 30/40',
    tierStatus: 'Stable',
    neuralRendering: true,
    reshadeRequired: false,
  },
  rtx5080: {
    key: 'rtx5080',
    name: 'NVIDIA GeForce RTX 5080',
    short: 'RTX 5080',
    driver: '591.44',
    tier: 'RTX 50',
    tierStatus: 'Community-verified',
    neuralRendering: true,
    reshadeRequired: false,
  },
  rtx2080: {
    key: 'rtx2080',
    name: 'NVIDIA GeForce RTX 2080 SUPER',
    short: 'RTX 2080 SUPER',
    driver: '591.44',
    tier: 'RTX 20',
    tierStatus: 'Experimental',
    neuralRendering: true,
    reshadeRequired: false,
  },
  rx7900: {
    key: 'rx7900',
    name: 'AMD Radeon RX 7900 XTX',
    short: 'RX 7900 XTX',
    driver: 'Adrenalin 26.9.1',
    tier: 'Radeon',
    tierStatus: 'Experimental',
    neuralRendering: false,
    reshadeRequired: true,
  },
}

export const GAME = {
  folder: 'C:\\Games\\Steam\\steamapps\\common\\FINAL FANTASY XIV Online',
  folderShort: '…\\steamapps\\common\\FINAL FANTASY XIV Online',
  source: 'Steam',
  version: '2026.09.30',
  patchVersion: '2026.10.14',
}

export const LAUNCHER = { name: 'XIVLauncher', note: 'Auto-repair available' }

export const CONTENT_VERSION = '2026.10.12'
export const NEXT_CONTENT_VERSION = '2026.10.19'
export const APP_VERSION = '1.0.0'

export const EXISTING_SETUP = {
  name: 'GShade leftovers',
  fileCount: 14,
  files: ['dxgi.dll', 'GShade.ini', 'gshade-shaders\\', 'gshade-addons\\'],
  presetsKept: 9,
}

export interface ProfileInfo {
  key: ProfileKey
  label: string
  neural: string
  radeon: string
  image: number // 1..3, for meters
  speed: number // 1..3
}

export const PROFILES: ProfileInfo[] = [
  {
    key: 'fidelity',
    label: 'Fidelity',
    neural: 'Two Neural Rendering passes. The richest image, the heaviest load.',
    radeon: 'FSR at native resolution. The sharpest image, no frame generation.',
    image: 3,
    speed: 1,
  },
  {
    key: 'balanced',
    label: 'Balanced',
    neural: 'One pass. The best trade-off for most cards.',
    radeon: 'FSR Quality with frame generation. The best trade-off.',
    image: 2,
    speed: 2,
  },
  {
    key: 'performance',
    label: 'Performance',
    neural: 'One lighter pass with frame generation. The highest frame rate.',
    radeon: 'FSR Performance with frame generation. The highest frame rate.',
    image: 1,
    speed: 3,
  },
]

export const profileLabel = (k: ProfileKey) => PROFILES.find((p) => p.key === k)!.label
export const profileText = (p: ProfileInfo, gpu: Gpu) => (gpu.neuralRendering ? p.neural : p.radeon)

export interface Component {
  name: string
  upstream: string
  mb: number
  reshade?: boolean
}

export function componentsFor(gpu: Gpu, includeReshade: boolean): Component[] {
  const list: Component[] = gpu.neuralRendering
    ? [
        { name: 'OptiScaler', upstream: 'SirenBrink · ROUND 5', mb: 214 },
        {
          name: 'Neural Rendering runtime',
          upstream: gpu.tier === 'RTX 50' ? 'NVIDIA' : 'ShortFuse',
          mb: gpu.tier === 'RTX 50' ? 194 : 158,
        },
      ]
    : [{ name: 'OptiScaler with FSR', upstream: 'SirenBrink · ROUND 5', mb: 56 }]
  list.push(
    { name: 'ReShade 6.6 with add-ons', upstream: 'crosire', mb: 7, reshade: true },
    { name: 'Shaders', upstream: 'iMMERSE, qUINT, SweetFX, Alive', mb: 31, reshade: true },
    { name: 'Presets', upstream: 'Alive, ipsuShade', mb: 2, reshade: true },
  )
  return list.filter((c) => includeReshade || !c.reshade)
}

export function reviewNumbers(gpu: Gpu, includeReshade: boolean, existing: boolean) {
  const components = componentsFor(gpu, includeReshade)
  const downloadMb = components.reduce((s, c) => s + c.mb, 0)
  const added = (gpu.neuralRendering ? 38 : 24) + (includeReshade ? 1248 : 0)
  const backedUp = 2 + (existing ? EXISTING_SETUP.fileCount : 0)
  return { downloadMb, added, backedUp, components }
}

export const DRIFT = { files: 3, patch: GAME.patchVersion }

export const CHANGELOG = {
  version: NEXT_CONTENT_VERSION,
  mb: 38,
  changes: [
    'OptiScaler moves to upstream ROUND 6.',
    'Performance profile: less shimmer on hair and foliage.',
    'Adds the METEOR and ZN_FX shaders, so every ipsuShade preset loads.',
    'Your ReShade keybinds and selected preset are kept.',
  ],
}

export const CUSTOM = { base: 'balanced' as ProfileKey, changed: '1 setting', where: 'the OptiScaler overlay' }

export const HOTKEYS = [
  { key: 'Insert', what: 'OptiScaler overlay', hint: 'Upscaling and Neural Rendering settings' },
  { key: 'Home', what: 'ReShade', hint: 'Pick a preset. None is active yet.' },
]

export const MENU = {
  actions1: ['Versions…'],
  toggles: ['Beta channel', 'XIVLauncher auto-repair'],
  actions2: ['Copy diagnostics', 'Report a bug', 'Credits'],
  danger: 'Uninstall…',
}

export const fmt = (n: number) => n.toLocaleString('en-US')
