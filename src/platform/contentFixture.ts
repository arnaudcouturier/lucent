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
const PROFILE_CONFIG_HASH = 'b3ef5c1edd86fa42913cf7d887e6730a3a7bd3584e59549be748b0284be5f7ed'
export const PROFILE_ASSETS = {
  ...FIXTURE_ASSETS,
  [PROFILE_CONFIG_HASH]: '; OptiScaler\r\n[DlssNr]\r\n; Neural Rendering passes\r\nPasses = 2\r\nSpatialCompression = false\r\nResidualFG = false\r\n\r\n[Logging]\r\nLogToFile = false\r\n',
}
// Illustrative values only: real content remains unpublished until its per-tier settings are tested.
export const PROFILE_MANIFEST: Manifest = {
  ...TEST_MANIFEST,
  versions: [{
    ...TEST_CONTENT,
    files: Object.entries(PROFILE_ASSETS).map(([sha256, text]) => ({ sha256, size: new TextEncoder().encode(text).length, release: 'content-2026.10.12' })),
    tiers: Object.fromEntries(Object.entries(TEST_CONTENT.tiers).map(([id, r]) => [id, id === 'other' || id === 'radeon' ? r : {
      ...r,
      recipe: [...r.recipe, { kind: 'copy', file: PROFILE_CONFIG_HASH, to: 'OptiScaler.ini' }, { kind: 'ini_set', file: 'OptiScaler.ini', section: 'Logging', key: 'LogToFile', value: 'false' }],
      ownedConfigs: [...r.ownedConfigs, { path: 'OptiScaler.ini' }],
      performanceProfiles: [
        { id: 'fidelity' as const, label: 'Fidelity', description: 'Two Neural Rendering passes for more detail.' },
        { id: 'balanced' as const, label: 'Balanced', description: 'One Neural Rendering pass, balancing detail and frame rate.' },
        { id: 'performance' as const, label: 'Performance', description: 'One pass with compression and residual frames for a higher frame rate.' },
      ].map((p) => ({ ...p, settings: [
        { file: 'OptiScaler.ini', section: 'DlssNr', key: 'Passes', value: p.id === 'fidelity' ? '2' : '1' },
        { file: 'OptiScaler.ini', section: 'DlssNr', key: 'SpatialCompression', value: String(p.id === 'performance') },
        { file: 'OptiScaler.ini', section: 'DlssNr', key: 'ResidualFG', value: String(p.id === 'performance') },
      ] })),
    }])),
  }],
}

const frameGenerationSetting = (mode: string) => ({ file: 'OptiScaler.ini', section: 'FrameGeneration', key: 'Mode', value: mode })
const rtx30FrameGeneration = ['off', '2x'].map((id) => ({
  id: id as 'off' | '2x', gpuNamePatterns: ['\\bRTX\\s+30[0-9]{2}\\b'], settings: [frameGenerationSetting(id)],
}))
const rtx40FrameGeneration = ['off', '2x', '3x', '4x', '5x', '6x', 'dynamic'].map((id) => ({
  id: id as 'off' | '2x' | '3x' | '4x' | '5x' | '6x' | 'dynamic',
  gpuNamePatterns: ['\\bRTX\\s+40[0-9]{2}\\b'], experimental: ['3x', '4x', '5x', '6x'].includes(id),
  settings: [frameGenerationSetting(id)],
}))

/** Illustrative mode variants for the Home gallery; these inert values are never published. */
export const FRAME_GENERATION_MANIFEST: Manifest = {
  ...PROFILE_MANIFEST,
  versions: PROFILE_MANIFEST.versions.map((content) => ({
    ...content,
    tiers: Object.fromEntries(Object.entries(content.tiers).map(([id, tier]) => [id, id === 'rtx-30-40'
      ? { ...tier, frameGenerationOptions: [...rtx30FrameGeneration, ...rtx40FrameGeneration] }
      : tier])),
  })),
}

export const fixtureUrl = (hash: string) => `https://github.com/arnaudcouturier/lucent/releases/download/content-2026.10.12/${hash}`
export const OPTISCALER_NEXT_HASH = '67519f2e14ad9d1f4715625d6bcc73a76bb785c816396d530495dee3ad1e7613'
const PROFILE_CONTENT = PROFILE_MANIFEST.versions[0]
/** The next content version: a new OptiScaler build, and the example shader dropped. */
export const NEXT_CONTENT: ContentVersion = {
  ...PROFILE_CONTENT, id: '2026.11.02', changelog: ['OptiScaler 2 with sharper Neural Rendering.', 'Drops the example shader.'],
  files: [
    ...PROFILE_CONTENT.files.filter((f) => f.sha256 !== OPTISCALER_HASH && f.sha256 !== SHADER_HASH),
    { sha256: OPTISCALER_NEXT_HASH, size: 12, release: 'content-2026.11.02' },
  ],
  tiers: Object.fromEntries(Object.entries(PROFILE_CONTENT.tiers).map(([id, r]) => [id, {
    ...r,
    recipe: r.recipe.filter((s) => !(s.kind === 'copy' && s.file === SHADER_HASH))
      .map((s) => s.kind === 'copy' && s.file === OPTISCALER_HASH ? { ...s, file: OPTISCALER_NEXT_HASH } : s),
  }])),
}
export const NEXT_MANIFEST: Manifest = { ...PROFILE_MANIFEST, versions: [PROFILE_CONTENT, NEXT_CONTENT] }
export const nextFixtureUrl = (hash: string) => `https://github.com/arnaudcouturier/lucent/releases/download/content-2026.11.02/${hash}`
/** A Beta content version, newer than the next Stable one: the same new OptiScaler build, published under its own release. */
export const BETA_CONTENT: ContentVersion = {
  ...NEXT_CONTENT, id: '2026.11.10', channel: 'beta', changelog: ['Beta: OptiScaler 2 with sharper Neural Rendering.'],
  files: NEXT_CONTENT.files.map((f) => f.sha256 === OPTISCALER_NEXT_HASH ? { ...f, release: 'content-2026.11.10' } : f),
}
export const BETA_MANIFEST: Manifest = { ...PROFILE_MANIFEST, versions: [PROFILE_CONTENT, BETA_CONTENT] }
export const betaFixtureUrl = (hash: string) => `https://github.com/arnaudcouturier/lucent/releases/download/content-2026.11.10/${hash}`
