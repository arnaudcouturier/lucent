// Tiny, inert content for tests and browser development. Never published or used by the real app.
import manifest from '../../manifest.json'
import type { ContentVersion, Manifest, TierRecipe } from '../shared/manifest'

export const OPTISCALER_HASH = 'f1a59411e0090ae0608b2e78d73533a7f6ba41442589345f46631822f2dbae02'
export const RESHADE_HASH = '2b2b1cc6036edf59fae14ea7237a88c38ca7f425b0467046493061c18dc3d3ce'
export const CONFIG_HASH = '07d92d17224a27b1d1f79cba3d4663393304babd5fcdc88f873d052b387e34c5'
export const PRESET_HASH = '7252e7ce008587e1180459d95c2536df954971d6c51e6ac753518a6fe15da563'
export const SHADER_HASH = 'c2385aa66c95026c8651547fc4244f9ffd9b066da3cc38f7b7128d594df8a4d6'
export const FIXTURE_ASSETS: Record<string, string> = {
  [OPTISCALER_HASH]: 'OptiScaler', [RESHADE_HASH]: 'ReShade', [CONFIG_HASH]: '[GENERAL]\nPresetPath=\n',
  [PRESET_HASH]: 'Preset', [SHADER_HASH]: 'Shader',
}

function recipe(other: boolean, radeon: boolean): TierRecipe {
  return {
    recipe: [
      ...(!other ? [{ kind: 'copy' as const, file: OPTISCALER_HASH, to: 'winmm.dll' }] : []),
      { kind: 'copy', file: RESHADE_HASH, to: 'ReShade.download', when: 'reshade' },
      { kind: 'rename', from: 'ReShade.download', to: other ? 'dxgi.dll' : 'ReShade64.dll', when: 'reshade' },
      { kind: 'copy', file: CONFIG_HASH, to: 'ReShade.ini', when: 'reshade' },
      { kind: 'copy', file: PRESET_HASH, to: 'reshade-presets/Example.ini', when: 'reshade' },
      { kind: 'copy', file: SHADER_HASH, to: 'reshade-shaders/Shaders/Example.fx', when: 'reshade' },
    ],
    entryFiles: [{ path: other ? 'dxgi.dll' : 'winmm.dll' }],
    ownedConfigs: [{ path: 'ReShade.ini', when: 'reshade' }],
    shippedPresets: [{ path: 'reshade-presets/Example.ini', when: 'reshade' }],
    generatedFiles: [{ path: 'OptiScaler.log' }, { path: 'ReShade.log', when: 'reshade' }],
    overlay: other ? null : radeon ? 'upscaling' : 'neural-rendering',
  }
}
export const TEST_CONTENT: ContentVersion = {
  id: '2026.10.12', channel: 'stable', minAppVersion: '0.1.0', changelog: ['Inert development content.'],
  components: [{ name: 'Test content', upstream: 'Lucent development fixture', licence: 'MIT', source: 'https://github.com/arnaudcouturier/lucent' }],
  files: Object.entries(FIXTURE_ASSETS).map(([sha256, content]) => ({ sha256, size: new TextEncoder().encode(content).length, release: 'content-2026.10.12' })),
  tiers: Object.fromEntries(manifest.tiers.map((t) => [t.id, recipe(t.id === 'other', t.id === 'radeon')])),
}
export const TEST_MANIFEST: Manifest = { ...manifest, schemaVersion: 2, tiers: manifest.tiers as Manifest['tiers'], versions: [TEST_CONTENT] }
export const fixtureUrl = (hash: string) => `https://github.com/arnaudcouturier/lucent/releases/download/content-2026.10.12/${hash}`
