// Tiny, inert content for tests and browser development. Never published or used by the real app.
import manifest from '../../manifest.json'
import type { ContentVersion, HdrOption, Manifest, MfgUnlock, NeuralRenderingControls, PerformanceProfile, SettingChoice, TierRecipe } from '../shared/manifest'

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
// The real Starter set rides along, so the browser machines and the gallery can show the Mods section.
export const TEST_MANIFEST: Manifest = { ...manifest, schemaVersion: 2, tiers: manifest.tiers as Manifest['tiers'], versions: [TEST_CONTENT], starterSet: manifest.starterSet as Manifest['starterSet'] }
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
const frameGenerationBackend = (gpu: 'rtx30' | 'rtx40') => ({ file: 'OptiScaler.ini', section: 'FrameGeneration', key: 'Backend', value: gpu })
const rtx30FrameGeneration = ['off', '2x'].map((id) => ({
  id: id as 'off' | '2x', gpuNamePatterns: ['\\bRTX\\s+30[0-9]{2}\\b'], settings: [frameGenerationSetting(id), frameGenerationBackend('rtx30')],
}))
const rtx40FrameGeneration = ['off', '2x', '3x', '4x', '5x', '6x', 'dynamic'].map((id) => ({
  id: id as 'off' | '2x' | '3x' | '4x' | '5x' | '6x' | 'dynamic',
  gpuNamePatterns: ['\\bRTX\\s+40[0-9]{2}\\b'], experimental: ['3x', '4x', '5x', '6x'].includes(id),
  // As in the published content, every mode writes the unlock key itself: the modes that need it turn it on.
  settings: [frameGenerationSetting(id), frameGenerationBackend('rtx40'),
    { file: 'OptiScaler.ini', section: 'DLSSG', key: 'AdaMfgUnlock', value: ['off', '2x'].includes(id) ? 'false' : 'true' }],
}))

const profileSetting = (key: string, value: string) => ({ file: 'OptiScaler.ini', section: 'DlssNr', key, value })
const upscalingSetting = (value: { '1080p': string; '1440p': string; '4k+': string }) => ({
  file: 'OptiScaler.ini', section: 'QualityOverrides', key: 'ForcePerfQuality', value,
})
const FRAME_GENERATION_PROFILES = [
  {
    id: 'ultra', label: 'Ultra', description: 'Two Neural Rendering passes with Quality upscaling.',
    summary: 'Two passes · Quality upscaling', gpuNamePatterns: ['\\bRTX\\s+(4080|4090)\\b'],
    settings: [profileSetting('Passes', '2'), profileSetting('SpatialCompression', 'false'), profileSetting('ResidualFG', 'false'),
      upscalingSetting({ '1080p': '2', '1440p': '2', '4k+': '2' })],
  },
  {
    id: 'fidelity', label: 'Fidelity', description: 'One Neural Rendering pass with Quality upscaling.',
    summary: 'One pass · Quality upscaling',
    settings: [profileSetting('Passes', '1'), profileSetting('SpatialCompression', 'false'), profileSetting('ResidualFG', 'false'),
      upscalingSetting({ '1080p': '2', '1440p': '2', '4k+': '2' })],
  },
  {
    id: 'balanced', label: 'Balanced', description: 'Quality upscaling at 1080p; Balanced at 1440p and above.',
    summary: {
      '1080p': 'One pass · Quality upscaling',
      '1440p': 'One pass · Balanced upscaling',
      '4k+': 'One pass · Balanced upscaling',
    },
    settings: [profileSetting('Passes', '1'), profileSetting('SpatialCompression', 'false'), profileSetting('ResidualFG', 'false'),
      upscalingSetting({ '1080p': '2', '1440p': '1', '4k+': '1' })],
  },
  {
    id: 'performance', label: 'Performance', description: 'Compression and residual frame generation for a higher frame rate.',
    summary: {
      '1080p': 'One pass · Compression and residual frames · Balanced upscaling',
      '1440p': 'One pass · Compression and residual frames · Balanced upscaling',
      '4k+': 'One pass · Compression and residual frames · Performance upscaling',
    },
    settings: [profileSetting('Passes', '1'), profileSetting('SpatialCompression', 'true'), profileSetting('ResidualFG', 'true'),
      upscalingSetting({ '1080p': '1', '1440p': '1', '4k+': '0' })],
  },
] satisfies PerformanceProfile[]

/** Illustrative frame generation variants for tests and the gallery; these inert values are never published. */
export const FRAME_GENERATION_MANIFEST: Manifest = {
  ...PROFILE_MANIFEST,
  versions: PROFILE_MANIFEST.versions.map((content) => ({
    ...content,
    tiers: Object.fromEntries(Object.entries(content.tiers).map(([id, tier]) => [id, id.startsWith('rtx-')
      ? {
        ...tier,
        performanceProfilesV2: FRAME_GENERATION_PROFILES,
        ...(id === 'rtx-20-30-40' ? { frameGenerationOptions: [...rtx30FrameGeneration, ...rtx40FrameGeneration] } : {}),
      }
      : tier])),
  })),
}

const hdrSetting = (section: string, key: string, value: string) => ({ file: 'OptiScaler.ini', section, key, value })
export const HDR_OPTIONS: HdrOption[] = [
  { id: 'off', settings: [hdrSetting('HDR', 'FfxivHDR', 'false'), hdrSetting('HDR', 'Mode', '0')] },
  { id: 'hdr', settings: [hdrSetting('HDR', 'FfxivHDR', 'true'), hdrSetting('HDR', 'Mode', '0')] },
  { id: 'scene-hdr', experimental: true, settings: [hdrSetting('HDR', 'FfxivHDR', 'true'), hdrSetting('HDR', 'Mode', '1')] },
]
const peakNitsSetting = { file: 'OptiScaler.ini', section: 'HDR', key: 'PeakNits', value: 'peakNits' as const }
const frameCapSettings = [
  { file: 'OptiScaler.ini', section: 'Framerate', key: 'FramerateLimit', value: 'frameCap' as const },
  { file: 'OptiScaler.ini', section: 'DLSSG', key: 'FramerateTargetDMFG', value: 'frameCap' as const },
  { file: 'OptiScaler.ini', section: 'XeFG', key: 'DynamicTargetFPS', value: 'frameCap' as const },
]

/** Inert HDR choices for tests of the manifest schema; these values are never published. */
export const HDR_FRAME_GENERATION_MANIFEST: Manifest = {
  ...FRAME_GENERATION_MANIFEST,
  versions: FRAME_GENERATION_MANIFEST.versions.map((content) => ({
    ...content,
    tiers: Object.fromEntries(Object.entries(content.tiers).map(([id, tier]) => {
      // The sample Radeon/Other recipe has no OptiScaler config, so add the inert fixture config
      // to let the gallery exercise the cross-vendor HDR controls without shipping it as content.
      const needsConfig = !tier.ownedConfigs.some((config) => config.path.toLowerCase() === 'optiscaler.ini')
      const recipe = needsConfig
        ? [...tier.recipe, { kind: 'copy' as const, file: PROFILE_CONFIG_HASH, to: 'OptiScaler.ini' }]
        : tier.recipe
      const ownedConfigs = needsConfig ? [...tier.ownedConfigs, { path: 'OptiScaler.ini' }] : tier.ownedConfigs
      return [id, {
        ...tier,
        recipe,
        ownedConfigs,
        hdrOptions: HDR_OPTIONS,
        screenDerivedSettings: [...(tier.screenDerivedSettings ?? []), ...frameCapSettings, peakNitsSetting],
        frameGenerationOptions: tier.frameGenerationOptions?.map((option) => option.id === '2x'
          ? { ...option, hdrSettings: [hdrSetting('FrameGeneration', 'Mode', 'xeFG2')] }
          : option),
      }]
    })),
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

const nrKey = (section: string, key: string) => ({ file: 'OptiScaler.ini', section, key })
/** The Neural Rendering controls as the published content declares them; inert values for tests and the gallery. */
export const NEURAL_RENDERING_CONTROLS: NeuralRenderingControls = {
  presetKey: nrKey('QualityOverrides', 'ForcePerfQuality'),
  presets: [
    { id: 'dlaa', label: 'DLAA', ratio: 1, value: '5' },
    { id: 'ultra-quality', label: 'Ultra Quality', ratio: 1.3, value: '4' },
    { id: 'quality', label: 'Quality', ratio: 1.5, value: '2' },
    { id: 'balanced', label: 'Balanced', ratio: 1.7, value: '1' },
    { id: 'performance', label: 'Performance', ratio: 2, value: '0' },
    { id: 'ultra-performance', label: 'Ultra Performance', ratio: 3, value: '3' },
  ],
  passesKey: nrKey('DlssNr', 'Passes'),
  scaleKey: nrKey('DlssNr', 'WorkingScale'),
  spatialCompression: {
    key: nrKey('DlssNr', 'SpatialCompression'), label: 'Spatial compression',
    description: 'Saves performance by giving the edges of the screen less Neural Rendering detail. The centre is untouched.',
  },
  residualFg: {
    key: nrKey('DlssNr', 'ResidualFG'), label: 'Residual frame generation', experimental: true,
    description: 'Runs Neural Rendering on every second frame and lets NVIDIA frame generation fill the rest. Faster, but the image arrives one frame late, so motion blur and the HUD can look slightly off.',
    gpuNamePatterns: ['RTX\\s?40[0-9]{2}', 'RTX\\s?50[0-9]{2}'],
  },
  defaults: [
    { gpuNamePatterns: ['RTX\\s?4090', 'RTX\\s?4080', 'RTX\\s?5090', 'RTX\\s?5080'], preset: 'quality', passes: 2 },
    { gpuNamePatterns: ['RTX\\s?4070\\s?Ti', 'RTX\\s?5070\\s?Ti', 'RTX\\s?3090', 'RTX\\s?3080\\s?Ti'], preset: 'quality', passes: 1 },
    { preset: 'balanced', passes: 1 },
  ],
}
export const MFG_UNLOCK: MfgUnlock = {
  gpuNamePatterns: ['RTX\\s?40[0-9]{2}'], label: 'Unlock multi-frame generation',
  description: 'Adds 3× to 6× and Dynamic on RTX 40, which NVIDIA doesn’t officially support. It also works with 2×.',
  gates: ['3x', '4x', '5x', '6x', 'dynamic'], settings: [{ ...nrKey('DLSSG', 'AdaMfgUnlock'), value: 'true' }],
}

/** Inert Neural Rendering controls in place of profiles, for tests and the gallery; these values are never published. */
export const NEURAL_RENDERING_MANIFEST: Manifest = {
  ...HDR_FRAME_GENERATION_MANIFEST,
  versions: HDR_FRAME_GENERATION_MANIFEST.versions.map((content) => ({
    ...content,
    tiers: Object.fromEntries(Object.entries(content.tiers).map(([id, tier]) => {
      if (!id.startsWith('rtx-')) return [id, tier]
      const { performanceProfiles: _legacy, performanceProfilesV2: _profiles, ...rest } = tier
      return [id, { ...rest, neuralRenderingControls: NEURAL_RENDERING_CONTROLS, ...(id === 'rtx-20-30-40' ? { mfgUnlock: MFG_UNLOCK } : {}) }]
    })),
  })),
}

const dlssgCards = ['RTX\\s?40[0-9]{2}', 'RTX\\s?50[0-9]{2}']
const choiceKey = (section: string, key: string, value: string) => ({ file: 'OptiScaler.ini', section, key, value })
const recompositionBlock = {
  reason: 'Preset A and C turn UI recomposition off. Set UI mode to Off or UI-free to use them.',
  choice: { id: 'ui-mode', options: ['recomposition'] },
}
/** The UI mode and DLSS-G preset choices, as the content ships them for NVIDIA cards that run DLSS frame generation. */
export const SETTING_CHOICES = [
  {
    id: 'ui-mode', label: 'UI mode', gpuNamePatterns: dlssgCards, needsFrameGeneration: true, defaultOption: 'recomposition', unofferedOption: 'off',
    options: [
      { id: 'off', label: 'Off', description: 'Frame generation treats the interface like the rest of the frame.', settings: [choiceKey('HudLess', 'Mode', 'off')] },
      {
        id: 'recomposition', label: 'Recomposition', settings: [choiceKey('HudLess', 'Mode', 'recomposition')],
        description: 'Gives frame generation the scene and the interface as separate images, meant to keep the interface sharp in fast camera motion. Tested at 2× to 4× in SDR, where no visible difference was seen.',
      },
      {
        id: 'ui-free', label: 'UI-free', experimental: true, settings: [choiceKey('HudLess', 'Mode', 'ui_free')],
        description: 'Frame generation works on the scene alone and the interface is pasted back at the real frame rate. In some scenes it falls back to normal frame generation.',
        blockedWhen: [{ reason: 'UI-free isn’t supported with HDR yet.', hdr: true as const }],
      },
    ],
  },
  {
    id: 'dlssg-preset', label: 'DLSS-G preset', gpuNamePatterns: dlssgCards, needsFrameGeneration: true, defaultOption: 'auto',
    options: [
      { id: 'auto', label: 'Auto', description: 'The driver and NVIDIA’s runtime decide.', settings: [choiceKey('DLSSG', 'RenderPreset', '0')] },
      { id: 'a', label: 'Preset A', description: 'NVIDIA’s preset A. It turns UI recomposition off.', settings: [choiceKey('DLSSG', 'RenderPreset', '1')], blockedWhen: [recompositionBlock] },
      { id: 'b', label: 'Preset B', description: 'NVIDIA’s preset B. It asks for UI recomposition.', settings: [choiceKey('DLSSG', 'RenderPreset', '2')] },
      { id: 'c', label: 'Preset C', description: 'NVIDIA’s preset C. It turns UI recomposition off and NVIDIA’s FG Lite on.', settings: [choiceKey('DLSSG', 'RenderPreset', '3')], blockedWhen: [recompositionBlock] },
    ],
  },
] satisfies SettingChoice[]

const hintPlacement = { in: 'neural-rendering', group: 'Advanced Neural Rendering model hints (effect unverified)', note: 'Hints the Neural Rendering model receives for each pass.' } as const
const hintOptions = (key: string, pass: number, inherits: boolean) => [
  ...(inherits ? [{ id: 'auto', label: 'Auto (inherit pass 1)', description: `Pass ${pass} sends the same hint as pass 1.`, settings: [choiceKey('DlssNr', key, 'auto')] }] : []),
  { id: 'default', label: 'Default', description: `Pass ${pass} sends preset hint 0 to the model.`, settings: [choiceKey('DlssNr', key, '0')] },
  ...[1, 2, 3].map((n) => ({ id: `preset-${n}`, label: `Preset ${n}`, description: `Pass ${pass} sends preset hint ${n} to the model.`, settings: [choiceKey('DlssNr', key, String(n))] })),
]
/** The Neural Rendering model's per-pass preset hints: placed inside the Neural Rendering card, the second and third shown only with that many passes. */
export const PASS_HINT_CHOICES = [
  { id: 'nr-hint-pass-1', label: 'Pass 1 preset hint', placement: hintPlacement, defaultOption: 'preset-1', options: hintOptions('Preset', 1, false) },
  { id: 'nr-hint-pass-2', label: 'Pass 2 preset hint', minPasses: 2, placement: hintPlacement, defaultOption: 'default', options: hintOptions('Pass2Preset', 2, true) },
  { id: 'nr-hint-pass-3', label: 'Pass 3 preset hint', minPasses: 3, placement: hintPlacement, defaultOption: 'default', options: hintOptions('Pass3Preset', 3, true) },
] satisfies SettingChoice[]

/** The character preview's Neural Rendering: a plain block inside the Neural Rendering card, Off unless the player turns it on. */
export const PREVIEW_NR_CHOICE = {
  id: 'preview-nr', label: 'Character preview Neural Rendering', placement: { in: 'neural-rendering' }, defaultOption: 'off',
  options: [
    { id: 'off', label: 'Off', description: 'The character, equipment and glamour previews are drawn without the Neural Rendering model, so no video memory goes to it. This is the default, because the model takes a lot of video memory for each open preview window.', settings: [choiceKey('FFXIV', 'PreviewNR', 'false')] },
    { id: 'on', label: 'On', description: 'Runs the Neural Rendering model on each open preview window. It takes a lot of video memory for each open window (roughly 180 MB or more in the fork’s own tests) and some GPU time.', settings: [choiceKey('FFXIV', 'PreviewNR', 'true')] },
  ],
} satisfies SettingChoice
const withChoices = (choices: SettingChoice[]): Manifest => ({
  ...NEURAL_RENDERING_MANIFEST,
  versions: NEURAL_RENDERING_MANIFEST.versions.map((content) => ({
    ...content,
    tiers: Object.fromEntries(Object.entries(content.tiers).map(([id, tier]) => [id, id.startsWith('rtx-') ? { ...tier, settingChoices: choices } : tier])),
  })),
})
/** Inert content with the UI mode and DLSS-G preset choices on the NVIDIA tiers, for tests and the gallery; never published. */
export const SETTING_CHOICE_MANIFEST: Manifest = withChoices(SETTING_CHOICES)
/** The same with the character preview's Neural Rendering and the pass preset hints after them, for tests and the gallery; never published. */
export const PASS_HINT_MANIFEST: Manifest = withChoices([...SETTING_CHOICES, PREVIEW_NR_CHOICE, ...PASS_HINT_CHOICES])
