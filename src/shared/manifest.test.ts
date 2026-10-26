import { describe, expect, it } from 'vitest'
import manifest from '../../manifest.json'
import { assertStableNeedsStableApp, ManifestError, parseManifest, type Manifest } from './manifest'

const screenDerivedManifest = (screenDerivedSettings: unknown): unknown => {
  const hash = 'a'.repeat(64)
  const tiers = Object.fromEntries(manifest.tiers.map((tier) => [tier.id, {
    recipe: [{ kind: 'copy', file: hash, to: 'winmm.dll' }],
    entryFiles: [{ path: 'winmm.dll' }], ownedConfigs: [{ path: 'OptiScaler.ini' }],
    shippedPresets: [], generatedFiles: [], overlay: null, screenDerivedSettings,
  }]))
  return {
    ...manifest,
    versions: [{
      id: '2026.10.13', channel: 'stable', minAppVersion: '0.1.0', changelog: ['Screen-derived settings.'],
      components: [{ name: 'Test', upstream: 'Test', licence: 'MIT', source: 'https://example.com' }],
      files: [{ sha256: hash, size: 0, release: 'content-2026.10.13' }], tiers,
    }],
  }
}

const configRuleManifest = (ownedConfigs: unknown): unknown => {
  const hash = 'a'.repeat(64)
  const tiers = Object.fromEntries(manifest.tiers.map((tier) => [tier.id, {
    recipe: [{ kind: 'copy', file: hash, to: 'winmm.dll' }],
    entryFiles: [{ path: 'winmm.dll' }], ownedConfigs, shippedPresets: [], generatedFiles: [], overlay: null,
  }]))
  return {
    ...manifest,
    versions: [{
      id: '2026.10.13', channel: 'stable', minAppVersion: '0.1.0', changelog: ['Config update rules.'],
      components: [{ name: 'Test', upstream: 'Test', licence: 'MIT', source: 'https://example.com' }],
      files: [{ sha256: hash, size: 0, release: 'content-2026.10.13' }], tiers,
    }],
  }
}

const frameGenerationManifest = (frameGenerationOptions: unknown): unknown => {
  const hash = 'a'.repeat(64)
  const tiers = Object.fromEntries(manifest.tiers.map((tier) => [tier.id, {
    recipe: [{ kind: 'copy', file: hash, to: 'winmm.dll' }],
    entryFiles: [{ path: 'winmm.dll' }], ownedConfigs: [{ path: 'OptiScaler.ini' }],
    shippedPresets: [], generatedFiles: [], overlay: null, frameGenerationOptions,
  }]))
  return {
    ...manifest,
    versions: [{
      id: '2026.10.13', channel: 'stable', minAppVersion: '0.1.0', changelog: ['Frame generation modes.'],
      components: [{ name: 'Test', upstream: 'Test', licence: 'MIT', source: 'https://example.com' }],
      files: [{ sha256: hash, size: 0, release: 'content-2026.10.13' }], tiers,
    }],
  }
}

const hdrOptions = [
  { id: 'off', settings: [{ file: 'OptiScaler.ini', section: 'HDR', key: 'FfxivHDR', value: 'false' }] },
  { id: 'hdr', settings: [
    { file: 'OptiScaler.ini', section: 'HDR', key: 'FfxivHDR', value: 'true' },
    { file: 'OptiScaler.ini', section: 'HDR', key: 'Mode', value: '0' },
  ] },
  { id: 'scene-hdr', experimental: true, settings: [
    { file: 'OptiScaler.ini', section: 'HDR', key: 'FfxivHDR', value: 'true' },
    { file: 'OptiScaler.ini', section: 'HDR', key: 'Mode', value: '1' },
  ] },
]

const hdrManifest = (options: unknown): unknown => {
  const hash = 'a'.repeat(64)
  const tiers = Object.fromEntries(manifest.tiers.map((tier) => [tier.id, {
    recipe: [{ kind: 'copy', file: hash, to: 'winmm.dll' }],
    entryFiles: [{ path: 'winmm.dll' }], ownedConfigs: [{ path: 'OptiScaler.ini' }],
    shippedPresets: [], generatedFiles: [], overlay: null, hdrOptions: options,
  }]))
  return {
    ...manifest,
    versions: [{
      id: '2026.10.13', channel: 'stable', minAppVersion: '0.1.0', changelog: ['HDR modes.'],
      components: [{ name: 'Test', upstream: 'Test', licence: 'MIT', source: 'https://example.com' }],
      files: [{ sha256: hash, size: 0, release: 'content-2026.10.13' }], tiers,
    }],
  }
}

describe('The shared manifest schema', () => {
  it('reads each config file’s update rule, and leaves it absent when the content gives none', () => {
    const parsed = parseManifest(JSON.stringify(configRuleManifest([
      { path: 'OptiScaler.ini', update: 'addMissingKeys' }, { path: 'ReShade.ini', update: 'replace', when: 'reshade' }, { path: 'Other.ini' }, { path: 'Kept.ini', update: 'keep' },
    ])))
    expect(parsed.versions[0].tiers.other.ownedConfigs).toEqual([
      { path: 'OptiScaler.ini', update: 'addMissingKeys' }, { path: 'ReShade.ini', update: 'replace', when: 'reshade' }, { path: 'Other.ini' }, { path: 'Kept.ini', update: 'keep' },
    ])
  })

  it('rejects an unknown config update rule', () => {
    expect(() => parseManifest(JSON.stringify(configRuleManifest([{ path: 'OptiScaler.ini', update: 'merge' }])))).toThrow(ManifestError)
  })

  it('reads the keys an update sets in a config, with an optional ifPath, and drops an empty list', () => {
    const setKeys = [
      { section: 'GENERAL', key: 'NoDebugInfo', value: '0' },
      { section: 'GENERAL', key: 'PresetPath', value: '.\\reshade-presets\\New.ini', ifPath: '.\\reshade-presets\\Old.ini' },
    ]
    const parsed = parseManifest(JSON.stringify(configRuleManifest([{ path: 'ReShade.ini', update: 'keep', when: 'reshade', setKeys }, { path: 'Other.ini', setKeys: [] }])))
    expect(parsed.versions[0].tiers.other.ownedConfigs).toEqual([{ path: 'ReShade.ini', update: 'keep', when: 'reshade', setKeys }, { path: 'Other.ini' }])
  })

  it.each([
    ['a value that is not a string', [{ section: 'GENERAL', key: 'NoDebugInfo', value: 0 }]],
    ['a multi-line value', [{ section: 'GENERAL', key: 'NoDebugInfo', value: '0\n1' }]],
    ['a bad key', [{ section: 'GENERAL', key: 'No=Debug', value: '0' }]],
    ['a bad section', [{ section: '[GENERAL]', key: 'NoDebugInfo', value: '0' }]],
    ['an empty ifPath', [{ section: 'GENERAL', key: 'PresetPath', value: 'x', ifPath: ' ' }]],
    ['the same key twice', [{ section: 'GENERAL', key: 'NoDebugInfo', value: '0' }, { section: 'general', key: 'nodebuginfo', value: '1' }]],
    ['a list that is not an array', { section: 'GENERAL', key: 'NoDebugInfo', value: '0' }],
  ])('rejects setKeys with %s', (_, setKeys) => {
    expect(() => parseManifest(JSON.stringify(configRuleManifest([{ path: 'ReShade.ini', setKeys }])))).toThrow(ManifestError)
  })

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

  it('reads an arbitrary INI target for the frame-cap screen-derived value', () => {
    const input = screenDerivedManifest([{ file: 'OptiScaler.ini', section: 'Framerate', key: 'FramerateLimit', value: 'frameCap' }])
    const parsed: Manifest = parseManifest(JSON.stringify(input))

    expect(parsed.versions[0].tiers['rtx-20-30-40'].screenDerivedSettings).toEqual([
      { file: 'OptiScaler.ini', section: 'Framerate', key: 'FramerateLimit', value: 'frameCap' },
    ])
  })

  it('accepts peak nits as a screen-derived value', () => {
    const parsed = parseManifest(JSON.stringify(screenDerivedManifest([
      { file: 'OptiScaler.ini', section: 'HDR', key: 'PeakNits', value: 'peakNits' },
    ])))
    expect(parsed.versions[0].tiers['rtx-20-30-40'].screenDerivedSettings?.[0].value).toBe('peakNits')
  })

  it('reads GPU-specific frame-generation variants and HDR overrides as optional recipe data', () => {
    const options = [
      { id: 'off', settings: [{ file: 'OptiScaler.ini', section: 'FrameGen', key: 'Enabled', value: 'false' }] },
      { id: '2x', gpuNamePatterns: ['RTX 30'], experimental: true,
        settings: [{ file: 'OptiScaler.ini', section: 'FrameGen', key: 'InterpolationCount', value: '1' }],
        hdrSettings: [{ file: 'OptiScaler.ini', section: 'FrameGen', key: 'InterpolationCount', value: '2' }] },
    ]
    const input = frameGenerationManifest(options)
    const parsed: Manifest = parseManifest(JSON.stringify(input))

    expect(parsed.versions[0].tiers['rtx-20-30-40'].frameGenerationOptions).toEqual(options)
  })

  it('keeps an older recipe without frame-generation options valid', () => {
    const input = frameGenerationManifest(undefined) as Manifest
    for (const recipe of Object.values(input.versions[0].tiers)) delete recipe.frameGenerationOptions

    expect(parseManifest(JSON.stringify(input)).versions[0].tiers['rtx-20-30-40'].frameGenerationOptions).toBeUndefined()
  })

  it('rejects HDR frame-generation overrides without a normal-mode value to restore', () => {
    const options = [
      { id: '2x', settings: [{ file: 'OptiScaler.ini', section: 'XeFG', key: 'UnlockMFG', value: 'true' }],
        hdrSettings: [{ file: 'OptiScaler.ini', section: 'XeFG', key: 'DynamicMFG', value: 'false' }] },
    ]
    expect(() => parseManifest(JSON.stringify(frameGenerationManifest(options)))).toThrow(/must override keys declared/)
  })

  it('reads all three HDR modes and the experimental Scene HDR marker', () => {
    const parsed = parseManifest(JSON.stringify(hdrManifest(hdrOptions)))
    expect(parsed.versions[0].tiers['rtx-20-30-40'].hdrOptions).toEqual(hdrOptions)
    expect(parseManifest(JSON.stringify(manifest)).versions[0].tiers['rtx-20-30-40'].hdrOptions).toBeUndefined()
  })

  it.each([
    ['missing mode', hdrOptions.slice(0, 2)],
    ['duplicate mode', [hdrOptions[0], hdrOptions[0], hdrOptions[2]]],
    ['empty settings', [{ ...hdrOptions[0], settings: [] }, ...hdrOptions.slice(1)]],
    ['unowned config', [{ ...hdrOptions[0], settings: [{ ...hdrOptions[0].settings[0], file: 'Other.ini' }] }, ...hdrOptions.slice(1)]],
  ])('rejects HDR options with %s', (_, options) => {
    expect(() => parseManifest(JSON.stringify(hdrManifest(options)))).toThrow(ManifestError)
  })

  it.each([
    ['unknown derived value', [{ file: 'OptiScaler.ini', section: 'Framerate', key: 'FramerateLimit', value: 'monitorSize' }]],
    ['unowned config', [{ file: 'Other.ini', section: 'Framerate', key: 'FramerateLimit', value: 'frameCap' }]],
    ['unsafe target key', [{ file: 'OptiScaler.ini', section: 'Framerate', key: 'Limit\nInjected', value: 'frameCap' }]],
    ['duplicate target', [
      { file: 'OptiScaler.ini', section: 'Framerate', key: 'FramerateLimit', value: 'frameCap' },
      { file: 'OptiScaler.ini', section: 'framerate', key: 'frameratelimit', value: 'frameCap' },
    ]],
  ])('rejects a screen-derived setting with %s', (_, settings) => {
    expect(() => parseManifest(JSON.stringify(screenDerivedManifest(settings)))).toThrow(ManifestError)
  })

  it.each([
    ['unknown id', [{ id: '7x', settings: [{ file: 'OptiScaler.ini', section: 'FrameGen', key: 'Count', value: '7' }] }]],
    ['invalid GPU regex', [{ id: '2x', gpuNamePatterns: ['['], settings: [{ file: 'OptiScaler.ini', section: 'FrameGen', key: 'Count', value: '1' }] }]],
    ['empty GPU patterns', [{ id: '2x', gpuNamePatterns: [], settings: [{ file: 'OptiScaler.ini', section: 'FrameGen', key: 'Count', value: '1' }] }]],
    ['empty settings', [{ id: 'off', settings: [] }]],
    ['unowned settings file', [{ id: 'off', settings: [{ file: 'Other.ini', section: 'FrameGen', key: 'Enabled', value: 'false' }] }]],
    ['duplicate variant', [
      { id: '2x', gpuNamePatterns: ['RTX 40'], settings: [{ file: 'OptiScaler.ini', section: 'FrameGen', key: 'Count', value: '1' }] },
      { id: '2x', gpuNamePatterns: ['rtx 40'], settings: [{ file: 'OptiScaler.ini', section: 'FrameGen', key: 'Count', value: '2' }] },
    ]],
  ])('rejects an invalid frame-generation option: %s', (_, options) => {
    expect(() => parseManifest(JSON.stringify(frameGenerationManifest(options)))).toThrow(ManifestError)
  })

  describe('a content version’s channel and the app it needs', () => {
    const needing = (channel: string, minAppVersion: string) => {
      const m = configRuleManifest([{ path: 'OptiScaler.ini' }]) as { versions: Record<string, unknown>[] }
      m.versions[0] = { ...m.versions[0], channel, minAppVersion }
      return JSON.stringify(m)
    }

    // The app parses the live manifest from main, so a rule here would turn one wrong hand-edit into an invalid
    // manifest for every player. The publish tool and the test over manifest.json below check it instead.
    it('is not enforced when the app reads the manifest, which has to stay readable', () => {
      expect(parseManifest(needing('stable', '0.3.0-beta.8')).versions[0]).toMatchObject({ channel: 'stable', minAppVersion: '0.3.0-beta.8' })
    })

    it('is refused by the publish check for a Stable version that needs a beta app', () => {
      expect(() => assertStableNeedsStableApp('stable', '0.3.0-beta.8')).toThrow(/Stable content version cannot require a beta app \(0\.3\.0-beta\.8\)/)
    })

    it.each([['stable', '0.3.0'], ['stable', '0.1.0'], ['beta', '0.3.0-beta.8'], ['beta', '0.3.0']])('is satisfied by a %s version that needs app %s', (channel, minAppVersion) => {
      expect(() => assertStableNeedsStableApp(channel, minAppVersion)).not.toThrow()
    })

    it('holds for every version in manifest.json, so a bad promotion fails here before it is pushed', () => {
      for (const version of manifest.versions) {
        expect(() => assertStableNeedsStableApp(version.channel, version.minAppVersion), `Content ${version.id} is Stable but needs app ${version.minAppVersion}, which no Stable player has. Keep it on Beta until a Stable app ships.`).not.toThrow()
      }
    })
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
