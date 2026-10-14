import { expect, it } from 'vitest'
import { profileOwnedElsewhereSettingKeys, profileResolutionSettingsForHeight, profileSettingsForHeight, profileSummaryForHeight, recommendedProfile, resolutionColumnForHeight, selectProfileForUpdate } from './profileValues'
import type { PerformanceProfile, TierRecipe } from '../shared/manifest'

const profile = (id: PerformanceProfile['id'], value: PerformanceProfile['settings'][number]['value'], gpuNamePatterns?: string[]): PerformanceProfile => ({
  id, label: id, description: `${id} profile`, ...(gpuNamePatterns ? { gpuNamePatterns } : {}),
  settings: [{ file: 'OptiScaler.ini', section: 'QualityOverrides', key: 'ForcePerfQuality', value }],
})
const v2Profiles = [
  profile('ultra', '2', ['RTX 4090|RTX 4080']),
  profile('fidelity', '2'),
  profile('balanced', { '1080p': '2', '1440p': '1', '4k+': '1' }),
  profile('performance', { '1080p': '1', '1440p': '1', '4k+': '0' }),
]
const recipe = (overrides: Partial<TierRecipe> = {}) => ({
  recipe: [], entryFiles: [], ownedConfigs: [], shippedPresets: [], generatedFiles: [], overlay: null, ...overrides,
}) as TierRecipe

it.each([[1299, '1080p'], [1300, '1440p'], [1999, '1440p'], [2000, '4k+']] as const)(
  'selects the %s output-height column at height %s', (height, column) => {
    expect(resolutionColumnForHeight(height)).toBe(column)
  },
)

it('resolves only the selected profile setting column for XIV output height', () => {
  const balanced = v2Profiles.find(({ id }) => id === 'balanced')!
  expect(profileSettingsForHeight(balanced, 1080)).toEqual([{ file: 'OptiScaler.ini', section: 'QualityOverrides', key: 'ForcePerfQuality', value: '2' }])
  expect(profileSettingsForHeight(balanced, 1440)[0].value).toBe('1')
  expect(profileSettingsForHeight(balanced, 2160)[0].value).toBe('1')
})

it('resolves a content-authored Home summary using the same output-height column', () => {
  const balanced = { ...v2Profiles.find(({ id }) => id === 'balanced')!, summary: { '1080p': 'Quality upscaling', '1440p': 'Balanced upscaling', '4k+': 'Balanced upscaling' } }
  expect(profileSummaryForHeight(balanced, 1080)).toBe('Quality upscaling')
  expect(profileSummaryForHeight(balanced, 1440)).toBe('Balanced upscaling')
  expect(profileSummaryForHeight(balanced, 2160)).toBe('Balanced upscaling')
})

it('updates resolution values only while the disk still matches Lucent’s last-written baseline', () => {
  const balanced = v2Profiles.find(({ id }) => id === 'balanced')!
  const disk = new Map([['QualityOverrides|ForcePerfQuality', '2'], ['QualityOverrides|PlayerTuned', '9']])
  const baseline = new Map(disk)
  const read = (values: Map<string, string>) => (_file: string, section: string, key: string) => values.get(`${section}|${key}`)
  const at1440 = profileResolutionSettingsForHeight(balanced, 1440, read(disk), read(baseline))
  expect(at1440).toEqual([{ file: 'OptiScaler.ini', section: 'QualityOverrides', key: 'ForcePerfQuality', value: '1' }])

  // Lucent writes that managed value and advances its baseline; the later player edit then remains protected.
  disk.set('QualityOverrides|ForcePerfQuality', '1')
  baseline.set('QualityOverrides|ForcePerfQuality', '1')
  disk.set('QualityOverrides|ForcePerfQuality', '0')
  expect(profileResolutionSettingsForHeight(balanced, 2160, read(disk), read(baseline))).toEqual([])
})

it('does not change settings owned by another feature during resolution sync', () => {
  const balanced = v2Profiles.find(({ id }) => id === 'balanced')!
  const read = () => () => '2'
  expect(profileResolutionSettingsForHeight(balanced, 1440, read(), read(), (_file, _section, key) => key === 'ForcePerfQuality')).toEqual([])
})

it('keeps frame-generation, screen-derived, and HDR keys out of profile ownership', () => {
  const owned = profileOwnedElsewhereSettingKeys(recipe({
    frameGenerationOptions: [{ id: 'off', settings: [{ file: 'OptiScaler.ini', section: 'DlssNr', key: 'Enabled', value: 'false' }] }],
    screenDerivedSettings: [{ file: 'OptiScaler.ini', section: 'FrameGen', key: 'FramerateLimit', value: 'frameCap' }],
    hdrOptions: [{ id: 'hdr', settings: [{ file: 'OptiScaler.ini', section: 'HDR', key: 'FfxivHDR', value: 'true' }] }],
  }))
  expect(owned).toEqual(new Set(['optiscaler.ini|dlssnr|enabled', 'optiscaler.ini|framegen|frameratelimit', 'optiscaler.ini|hdr|ffxivhdr']))
})

it('chooses the first GPU recommendation and falls back to Balanced', () => {
  expect(recommendedProfile(v2Profiles, 'NVIDIA GeForce RTX 4090')?.id).toBe('ultra')
  expect(recommendedProfile(v2Profiles, 'NVIDIA GeForce RTX 4070')?.id).toBe('balanced')
})

it('moves legacy two-pass Fidelity to Ultra only on the first update to four-profile content', () => {
  const legacy = recipe({ performanceProfiles: [
    { id: 'fidelity', label: 'Fidelity', description: 'Two passes.', settings: [{ file: 'OptiScaler.ini', section: 'DlssNr', key: 'Passes', value: '2' }] },
    { id: 'balanced', label: 'Balanced', description: 'One pass.', settings: [{ file: 'OptiScaler.ini', section: 'DlssNr', key: 'Passes', value: '1' }] },
    { id: 'performance', label: 'Performance', description: 'One pass.', settings: [{ file: 'OptiScaler.ini', section: 'DlssNr', key: 'Passes', value: '1' }] },
  ] })
  const four = recipe({ performanceProfilesV2: v2Profiles })
  expect(selectProfileForUpdate(four, legacy, 'fidelity', 'RTX 4090')).toBe('ultra')
  expect(selectProfileForUpdate(four, four, 'fidelity', 'RTX 4090')).toBe('fidelity')
  expect(selectProfileForUpdate(four, legacy, 'balanced', 'RTX 4090')).toBe('balanced')
  expect(selectProfileForUpdate(four, legacy, null, 'RTX 4090')).toBe('ultra')
})
