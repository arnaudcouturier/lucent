import { describe, expect, it } from 'vitest'
import manifest from '../../manifest.json'
import { ManifestError, parseManifest } from './manifest'

describe('The shared manifest schema', () => {
  it('reads the published tier definitions', () => {
    const parsed = parseManifest(JSON.stringify(manifest))

    expect(parsed.schemaVersion).toBe(2)
    expect(parsed.tiers[0]).toMatchObject({
      id: 'rtx-50', label: 'RTX 50', status: 'community-verified',
      neuralRendering: true, requiresReShade: false,
    })
    expect(parsed.tiers.at(-1)).toMatchObject({ id: 'other', gpuMatch: 'any' })
  })

  it('reads the existing-setup signatures for every kind', () => {
    const parsed = parseManifest(JSON.stringify(manifest))

    expect(parsed.existingSetups.map((s) => s.id)).toEqual(['gshade', 'gposingway', 'reshade', 'optiscaler', 'dlss-swap'])
    expect(parsed.existingSetups.find((s) => s.id === 'reshade')).toMatchObject({ files: expect.arrayContaining(['dxgi.dll', 'ReShade.ini']) })
  })

  it('reads a manifest written before existing-setup signatures as having none', () => {
    const { existingSetups: _, ...older } = manifest

    expect(parseManifest(JSON.stringify(older)).existingSetups).toEqual([])
  })

  it('requires an app update for a newer schema before interpreting its tiers', () => {
    try {
      parseManifest('{"schemaVersion":3,"tiers":"a future format"}')
      expect.fail('A newer schema must not be interpreted')
    } catch (error) {
      expect(error).toBeInstanceOf(ManifestError)
      expect(error).toMatchObject({ kind: 'update-required', schemaVersion: 3 })
    }
  })

  it.each([
    ['bad JSON', '{'],
    ['null', 'null'],
    ['missing schema version', JSON.stringify({ tiers: manifest.tiers })],
    ['unsupported old schema', JSON.stringify({ ...manifest, schemaVersion: 0 })],
    ['non-integer schema', JSON.stringify({ ...manifest, schemaVersion: 1.5 })],
    ['empty tiers', JSON.stringify({ ...manifest, tiers: [] })],
    ['no fallback', JSON.stringify({ ...manifest, tiers: manifest.tiers.slice(0, -1) })],
    ['early fallback', JSON.stringify({ ...manifest, tiers: [manifest.tiers.at(-1), ...manifest.tiers] })],
    ['duplicate tier ids', JSON.stringify({ ...manifest, tiers: [manifest.tiers[0], ...manifest.tiers] })],
    ['missing tier capability', JSON.stringify({ ...manifest, tiers: [{ ...manifest.tiers[0], neuralRendering: undefined }, ...manifest.tiers.slice(1)] })],
    ['unknown tier status', JSON.stringify({ ...manifest, tiers: [{ ...manifest.tiers[0], status: 'beta' }, ...manifest.tiers.slice(1)] })],
    ['no GPU rules', JSON.stringify({ ...manifest, tiers: [{ ...manifest.tiers[0], gpuMatch: [] }, ...manifest.tiers.slice(1)] })],
    ['invalid PCI vendor id', JSON.stringify({ ...manifest, tiers: [{ ...manifest.tiers[0], gpuMatch: [{ vendorId: -1, deviceNamePatterns: ['RTX'] }] }, ...manifest.tiers.slice(1)] })],
    ['no name patterns', JSON.stringify({ ...manifest, tiers: [{ ...manifest.tiers[0], gpuMatch: [{ vendorId: 4318, deviceNamePatterns: [] }] }, ...manifest.tiers.slice(1)] })],
    ['invalid regex', JSON.stringify({ ...manifest, tiers: [{ ...manifest.tiers[0], gpuMatch: [{ vendorId: 4318, deviceNamePatterns: ['['] }] }, ...manifest.tiers.slice(1)] })],
    ['existing setup without markers', JSON.stringify({ ...manifest, existingSetups: [{ ...manifest.existingSetups[0], markers: [] }] })],
    ['duplicate existing setup ids', JSON.stringify({ ...manifest, existingSetups: [manifest.existingSetups[0], manifest.existingSetups[0]] })],
    ['existing-setup pattern escaping the game folder', JSON.stringify({ ...manifest, existingSetups: [{ ...manifest.existingSetups[0], files: ['../*.dll'] }] })],
    ['existing-setup pattern ending in a folder wildcard', JSON.stringify({ ...manifest, existingSetups: [{ ...manifest.existingSetups[0], presets: ['gshade-presets/**'] }] })],
    ['existing-setup pattern with a partial folder wildcard', JSON.stringify({ ...manifest, existingSetups: [{ ...manifest.existingSetups[0], kept: ['shaders**/*.fx'] }] })],
  ])('rejects an invalid manifest: %s', (_, text) => {
    expect(() => parseManifest(text)).toThrow(ManifestError)
    try {
      parseManifest(text)
    } catch (error) {
      expect(error).toMatchObject({ kind: 'invalid' })
    }
  })
})
