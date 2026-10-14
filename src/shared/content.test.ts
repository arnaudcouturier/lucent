import { expect, it } from 'vitest'
import manifest from '../../manifest.json'
import { parseManifest, type Manifest } from './manifest'
import { HDR_FRAME_GENERATION_MANIFEST, PROFILE_MANIFEST } from '../platform/contentFixture'

it('retains content versions and validates recipe paths before deployment', () => {
  const version = {
    id: '2026.10.12', channel: 'stable', minAppVersion: '0.1.0', changelog: ['First content'],
    components: [{ name: 'Test component', upstream: 'Test author', licence: 'MIT', source: 'https://example.com/source' }],
    files: [{ sha256: 'a'.repeat(64), size: 12, release: 'content-2026.10.12' }],
    tiers: { other: { recipe: [{ kind: 'copy', file: 'a'.repeat(64), to: 'dxgi.dll' }], entryFiles: [{ path: 'dxgi.dll' }], ownedConfigs: [], shippedPresets: [], generatedFiles: [], overlay: null } },
  }
  const text = JSON.stringify({ ...manifest, schemaVersion: 2, versions: [version] })
  expect(parseManifest(text)).toMatchObject({ versions: [version] })
  version.tiers.other.recipe[0].to = '../ffxiv_dx11.exe'
  expect(() => parseManifest(JSON.stringify({ ...manifest, schemaVersion: 2, versions: [version] }))).toThrow(/path/i)
})

it('keeps the HDR gallery manifest valid across the NVIDIA and Radeon fixture tiers', () => {
  const parsed = parseManifest(JSON.stringify(HDR_FRAME_GENERATION_MANIFEST))
  const nvidia = parsed.versions[0].tiers['rtx-30-40']
  const radeon = parsed.versions[0].tiers.radeon

  expect(nvidia.hdrOptions?.map((option) => option.id)).toEqual(['off', 'hdr', 'scene-hdr'])
  expect(nvidia.performanceProfilesV2).toHaveLength(4)
  expect(nvidia.frameGenerationOptions?.find((option) => option.id === '2x')?.hdrSettings).toEqual([
    { file: 'OptiScaler.ini', section: 'FrameGeneration', key: 'Mode', value: 'xeFG2' },
  ])
  expect(radeon.ownedConfigs).toContainEqual({ path: 'OptiScaler.ini' })
  expect(radeon.hdrOptions).toHaveLength(3)
})

it.each(['../file', '..\\file', '/file', '\\file', 'C:\\file', 'file:stream', 'NUL.ini', 'COM1.dll', 'COM¹.dll', 'LPT².ini', 'folder./file', 'file ', 'folder//file'])('rejects a Windows path escape or alias: %s', (path) => {
  const content = {
    id: '2026.10.12', channel: 'stable', minAppVersion: '0.1.0', changelog: [], components: [],
    files: [{ sha256: 'a'.repeat(64), size: 1, release: 'content-2026.10.12' }],
    tiers: { other: { recipe: [{ kind: 'copy', file: 'a'.repeat(64), to: path }], entryFiles: [{ path: 'dxgi.dll' }], ownedConfigs: [], shippedPresets: [], generatedFiles: [], overlay: null } },
  }
  expect(() => parseManifest(JSON.stringify({ ...manifest, versions: [content] }))).toThrow(/path/i)
})

const profileContent = () => structuredClone(PROFILE_MANIFEST)
const nvidia = (m: Manifest) => m.versions[0].tiers['rtx-30-40']

it('retains known-broken game versions per content version and rejects malformed lists', () => {
  const m = { ...PROFILE_MANIFEST, versions: [{ ...PROFILE_MANIFEST.versions[0], knownBrokenGameVersions: ['2026.10.20.0000.0000'] }] }
  expect(parseManifest(JSON.stringify(m)).versions[0]).toMatchObject({ knownBrokenGameVersions: ['2026.10.20.0000.0000'] })
  for (const list of [null, '2026.10.20.0000.0000', [''], [123], ['bad\nversion']]) {
    expect(() => parseManifest(JSON.stringify({ ...m, versions: [{ ...m.versions[0], knownBrokenGameVersions: list }] }))).toThrow()
  }
})

it('requires an ini_set step on a conditional config to share its condition', () => {
  const m = profileContent()
  nvidia(m).recipe.push({ kind: 'ini_set', file: 'ReShade.ini', section: 'GENERAL', key: 'PresetPath', value: '' })
  expect(() => parseManifest(JSON.stringify(m))).toThrow(/condition/)
  nvidia(m).recipe.at(-1)!.when = 'reshade'
  expect(() => parseManifest(JSON.stringify(m))).not.toThrow()
})

it.each(['label', 'description'] as const)('rejects a profile %s that is not a single line', (field) => {
  const m = profileContent()
  nvidia(m).performanceProfiles![0][field] = 'Two passes\nfor more detail.'
  expect(() => parseManifest(JSON.stringify(m))).toThrow(/single line/)
})

it('orders profiles Fidelity, Balanced, Performance whatever the manifest order', () => {
  const m = profileContent()
  nvidia(m).performanceProfiles!.reverse()
  expect(nvidia(parseManifest(JSON.stringify(m))).performanceProfiles!.map((p) => p.id)).toEqual(['fidelity', 'balanced', 'performance'])
})

it('accepts four resolution-aware profiles with recommended GPU patterns in the optional recipe field', () => {
  const m = profileContent()
  const recipe = nvidia(m) as unknown as Record<string, unknown>
  recipe.performanceProfilesV2 = [
    { id: 'ultra', label: 'Ultra', description: 'Two passes.', summary: { '1080p': 'Two passes, Quality upscaling', '1440p': 'Two passes, Quality upscaling', '4k+': 'Two passes, Quality upscaling' }, gpuNamePatterns: ['RTX 4090'], settings: [{ file: 'OptiScaler.ini', section: 'DlssNr', key: 'Passes', value: '2' }] },
    { id: 'fidelity', label: 'Fidelity', description: 'One pass.', settings: [{ file: 'OptiScaler.ini', section: 'QualityOverrides', key: 'ForcePerfQuality', value: { '1080p': '2', '1440p': '2', '4k+': '2' } }] },
    { id: 'balanced', label: 'Balanced', description: 'Balanced upscaling.', settings: [{ file: 'OptiScaler.ini', section: 'QualityOverrides', key: 'ForcePerfQuality', value: { '1080p': '2', '1440p': '1', '4k+': '1' } }] },
    { id: 'performance', label: 'Performance', description: 'The highest frame rate.', settings: [{ file: 'OptiScaler.ini', section: 'QualityOverrides', key: 'ForcePerfQuality', value: { '1080p': '1', '1440p': '1', '4k+': '0' } }] },
  ]
  const parsed = parseManifest(JSON.stringify(m))
  const profiles = (parsed.versions[0].tiers['rtx-30-40'] as unknown as { performanceProfilesV2: { id: string }[] }).performanceProfilesV2
  expect(parsed.schemaVersion).toBe(2)
  expect(profiles.map(({ id }) => id)).toEqual(['ultra', 'fidelity', 'balanced', 'performance'])
})

it('rejects incomplete resolution columns and malformed recommended GPU patterns', () => {
  const m = profileContent()
  const recipe = nvidia(m) as unknown as Record<string, unknown>
  recipe.performanceProfilesV2 = [
    { id: 'ultra', label: 'Ultra', description: 'Two passes.', gpuNamePatterns: ['['], settings: [{ file: 'OptiScaler.ini', section: 'DlssNr', key: 'Passes', value: '2' }] },
    ...(['fidelity', 'balanced', 'performance'] as const).map((id) => ({ id, label: id, description: 'Profile.', settings: [{ file: 'OptiScaler.ini', section: 'QualityOverrides', key: 'ForcePerfQuality', value: { '1080p': '2', '1440p': '2' } }] })),
  ]
  expect(() => parseManifest(JSON.stringify(m))).toThrow(/pattern/i)
  const first = (recipe.performanceProfilesV2 as Record<string, unknown>[])[0]
  first.gpuNamePatterns = ['RTX 4090']
  expect(() => parseManifest(JSON.stringify(m))).toThrow(/resolution/i)
})
