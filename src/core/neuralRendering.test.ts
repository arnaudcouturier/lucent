import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform } from '../platform/fake'
import { graphicsCard, MACHINES, machine, neuralRenderingContentHost } from '../platform/fixtures'
import { MFG_UNLOCK, NEURAL_RENDERING_CONTROLS, NEURAL_RENDERING_MANIFEST } from '../platform/contentFixture'
import { parseManifest } from '../shared/manifest'
import {
  defaultNeuralRendering, frameGenerationOptionsForUnlock, mfgUnlockFor, mfgUnlockSettings, neuralRenderingExtras, neuralRenderingSettings, neuralRenderingSummary,
  normalizeNeuralRendering, presetRenderResolution, residualFgAvailable, scaleCostPercent, scaleValue,
} from './neuralRendering'
import { frameGenerationOptionsForGpu } from './frameGeneration'
import { readDeployment } from './deployment'

const GAME = 'D:\\SteamLibrary\\steamapps\\common\\FINAL FANTASY XIV Online'
const controls = NEURAL_RENDERING_CONTROLS
const RTX_4090 = 'NVIDIA GeForce RTX 4090'

describe('defaults', () => {
  it.each([
    ['NVIDIA GeForce RTX 4090', 'quality', 2],
    ['NVIDIA GeForce RTX 5080', 'quality', 2],
    ['NVIDIA GeForce RTX 4070 Ti SUPER', 'quality', 1],
    ['NVIDIA GeForce RTX 3090', 'quality', 1],
    ['NVIDIA GeForce RTX 3060', 'balanced', 1],
    ['AMD Radeon RX 7900 XTX', 'balanced', 1],
  ])('gives the %s %s with %i passes, 100%% resolution and both toggles off', (gpu, preset, passes) => {
    expect(defaultNeuralRendering(controls, gpu)).toEqual({ preset, passes, scale: 100, spatialCompression: false, residualFg: false })
  })
})

describe('normalizing the picks', () => {
  it('keeps valid picks and replaces unknown ones with the default', () => {
    expect(normalizeNeuralRendering({ preset: 'dlaa', passes: 3, scale: 75 }, controls, RTX_4090, '2x')).toMatchObject({ preset: 'dlaa', passes: 3, scale: 75 })
    expect(normalizeNeuralRendering({ preset: 'nope' as never, passes: 9 as never, scale: 50 as never }, controls, RTX_4090, '2x'))
      .toMatchObject({ preset: 'quality', passes: 2, scale: 100 })
  })

  it('turns residual frame generation off unless the card has NVIDIA frame generation and frame generation is on', () => {
    const picks = { residualFg: true }
    expect(normalizeNeuralRendering(picks, controls, RTX_4090, '2x').residualFg).toBe(true)
    expect(normalizeNeuralRendering(picks, controls, RTX_4090, 'off').residualFg).toBe(false)
    expect(normalizeNeuralRendering(picks, controls, RTX_4090, null).residualFg).toBe(false)
    expect(normalizeNeuralRendering(picks, controls, 'NVIDIA GeForce RTX 3080', '2x').residualFg).toBe(false)
    expect(residualFgAvailable(controls, 'NVIDIA GeForce RTX 5090', '4x')).toBe(true)
  })
})

describe('what the picks write', () => {
  it('writes the preset, passes, resolution fraction and both toggles', () => {
    const settings = neuralRenderingSettings(controls, { preset: 'ultra-quality', passes: 3, scale: 125, spatialCompression: true, residualFg: false })
    expect(settings.map((s) => `${s.section}.${s.key}=${s.value}`)).toEqual([
      'QualityOverrides.ForcePerfQuality=4', 'DlssNr.Passes=3', 'DlssNr.WorkingScale=1.250000', 'DlssNr.SpatialCompression=true', 'DlssNr.ResidualFG=false',
    ])
  })

  it('maps every DLSS preset to OptiScaler’s own value', () => {
    expect(Object.fromEntries(controls.presets.map((p) => [p.id, p.value]))).toEqual({
      dlaa: '5', 'ultra-quality': '4', quality: '2', balanced: '1', performance: '0', 'ultra-performance': '3',
    })
  })

  it('describes the picks for Review and Done', () => {
    const picks = { preset: 'quality' as const, passes: 2 as const, scale: 100 as const, spatialCompression: true, residualFg: true }
    expect(neuralRenderingSummary(controls, picks)).toBe('Quality · 2 passes · 100%')
    expect(neuralRenderingSummary(controls, { ...picks, passes: 1, scale: 75 })).toBe('Quality · 1 pass · 75%')
    expect(neuralRenderingExtras(controls, picks)).toEqual(['Spatial compression', 'Residual frame generation'])
    expect(neuralRenderingExtras(controls, { ...picks, spatialCompression: false, residualFg: false })).toEqual([])
  })

  it('computes the render resolution and the cost of a resolution percentage', () => {
    expect(presetRenderResolution(1.5, 3840, 2160)).toEqual({ width: 2560, height: 1440 })
    expect(presetRenderResolution(1, 3840, 2160)).toEqual({ width: 3840, height: 2160 })
    expect([75, 100, 125].map((s) => scaleCostPercent(s as 75 | 100 | 125))).toEqual([56, 100, 156])
    expect(scaleValue(75)).toBe('0.750000')
  })
})

describe('multi-frame unlock', () => {
  const options = frameGenerationOptionsForGpu(NEURAL_RENDERING_MANIFEST.versions[0].tiers['rtx-20-30-40'].frameGenerationOptions!, RTX_4090)

  it('is offered to RTX 40 cards only', () => {
    const recipe = NEURAL_RENDERING_MANIFEST.versions[0].tiers['rtx-20-30-40']
    expect(mfgUnlockFor(recipe, RTX_4090)).toBe(MFG_UNLOCK)
    expect(mfgUnlockFor(recipe, 'NVIDIA GeForce RTX 3080')).toBeNull()
    expect(mfgUnlockFor(recipe, 'NVIDIA GeForce RTX 5090')).toBeNull()
  })

  it('hides 3× to 6× and Dynamic until it is on, while 2× is always there', () => {
    expect(frameGenerationOptionsForUnlock(options, MFG_UNLOCK, false).map((o) => o.id)).toEqual(['off', '2x'])
    expect(frameGenerationOptionsForUnlock(options, MFG_UNLOCK, true).map((o) => o.id)).toEqual(['off', '2x', '3x', '4x', '5x', '6x', 'dynamic'])
    expect(frameGenerationOptionsForUnlock(options, null, false)).toHaveLength(7)
    expect(mfgUnlockSettings(MFG_UNLOCK, false)).toEqual([])
    expect(mfgUnlockSettings(MFG_UNLOCK, true).map((s) => `${s.key}=${s.value}`)).toEqual(['AdaMfgUnlock=true'])
  })
})

describe('the manifest', () => {
  const published = () => JSON.parse(JSON.stringify(NEURAL_RENDERING_MANIFEST))

  it('accepts controls and the unlock', () => {
    expect(parseManifest(JSON.stringify(NEURAL_RENDERING_MANIFEST)).versions[0].tiers['rtx-20-30-40'].neuralRenderingControls?.presets).toHaveLength(6)
  })

  it.each([
    ['a missing preset', (c: Record<string, unknown>) => { (c.presets as unknown[]).pop() }, /all six/],
    ['an unknown preset id', (c: Record<string, unknown>) => { (c.presets as { id: string }[])[0].id = 'super-quality' }, /Unknown Neural Rendering preset/],
    ['a last default that names cards', (c: Record<string, unknown>) => { (c.defaults as { gpuNamePatterns?: string[] }[]).at(-1)!.gpuNamePatterns = ['RTX'] }, /every card/],
    ['a broken GPU pattern', (c: Record<string, unknown>) => { (c.residualFg as { gpuNamePatterns: string[] }).gpuNamePatterns = ['('] }, /Invalid/],
    ['passes outside 1 to 3', (c: Record<string, unknown>) => { (c.defaults as { passes: number }[])[0].passes = 4 }, /1, 2 or 3/],
    ['a config the tier does not own', (c: Record<string, unknown>) => { (c.scaleKey as { file: string }).file = 'Other.ini' }, /owned config/],
  ])('rejects %s', (_name, mutate, message) => {
    const manifest = published()
    mutate(manifest.versions[0].tiers['rtx-20-30-40'].neuralRenderingControls)
    expect(() => parseManifest(JSON.stringify(manifest))).toThrow(message)
  })

  it('rejects a tier that offers both profiles and controls, and an unlock that gates 2×', () => {
    const both = published()
    both.versions[0].tiers['rtx-20-30-40'].performanceProfiles = []
    both.versions[0].tiers['rtx-20-30-40'].performanceProfilesV2 = [{ id: 'ultra', label: 'U', description: 'd', settings: [{ file: 'OptiScaler.ini', section: 'a', key: 'b', value: 'c' }] }]
    expect(() => parseManifest(JSON.stringify(both))).toThrow()
    const gated = published()
    gated.versions[0].tiers['rtx-20-30-40'].mfgUnlock.gates = ['2x']
    expect(() => parseManifest(JSON.stringify(gated))).toThrow(/gates 3× to 6×/)
  })
})

async function openProfileStep(gpu = RTX_4090) {
  const platform = createFakePlatform(machine(MACHINES.screen144Hdr, neuralRenderingContentHost(), graphicsCard(gpu)))
  const core = createCore(platform)
  await core.scan()
  await core.continueSetup()
  return { core, platform }
}
const ini = async (platform: ReturnType<typeof createFakePlatform>) => platform.readText(`${GAME}\\game\\OptiScaler.ini`)

describe('the Profile step', () => {
  it('offers the controls instead of profiles, with the card’s defaults', async () => {
    const { core } = await openProfileStep()
    expect(core.getState()).toMatchObject({
      activity: { kind: 'profile' }, profiles: [], selectedProfile: null,
      neuralRendering: { preset: 'quality', passes: 2, scale: 100, spatialCompression: false, residualFg: false }, mfgUnlocked: false,
    })
    expect(core.getState().neuralRenderingControls).toEqual(NEURAL_RENDERING_CONTROLS)
  })

  it('writes the picks into OptiScaler.ini and keeps them for Reset', async () => {
    const { core, platform } = await openProfileStep()
    core.setNeuralRendering({ preset: 'dlaa', scale: 75, passes: 3, spatialCompression: true })
    await core.review()
    expect(core.getState().plan?.neuralRendering).toEqual({ preset: 'dlaa', passes: 3, scale: 75, spatialCompression: true, residualFg: false })
    await core.deploy()
    core.finish()
    const text = await ini(platform)
    expect(text).toMatch(/ForcePerfQuality\s*=\s*5/)
    expect(text).toMatch(/Passes\s*=\s*3/)
    expect(text).toMatch(/WorkingScale\s*=\s*0\.75/)
    expect(text).toMatch(/SpatialCompression\s*=\s*true/)
    expect(text).toMatch(/ResidualFG\s*=\s*false/)
    expect((await readDeployment(platform, GAME))?.neuralRendering).toEqual({ preset: 'dlaa', passes: 3, scale: 75, spatialCompression: true, residualFg: false })
    expect(core.getState().neuralRendering).toMatchObject({ preset: 'dlaa', scale: 75 })
  })

  it('offers the stored picks again in Reset and rewrites the config with the new ones', async () => {
    const { core, platform } = await openProfileStep()
    core.setMfgUnlocked(true)
    core.selectFrameGenerationMode('3x')
    core.setNeuralRendering({ preset: 'performance', passes: 1, scale: 125, residualFg: true })
    await core.review()
    await core.deploy()
    core.finish()
    await core.resetSetup()
    expect(core.getState()).toMatchObject({
      activity: { kind: 'profile' }, mfgUnlocked: true, frameGenerationMode: '3x',
      neuralRendering: { preset: 'performance', passes: 1, scale: 125, residualFg: true },
    })
    core.setNeuralRendering({ preset: 'quality', scale: 100, residualFg: false })
    core.setMfgUnlocked(false)
    expect(core.getState().frameGenerationMode).toBe('2x')
    await core.review()
    await core.deploy()
    const text = await ini(platform)
    expect(text).toMatch(/ForcePerfQuality\s*=\s*2/)
    expect(text).toMatch(/WorkingScale\s*=\s*1\.0/)
    expect(text).toMatch(/ResidualFG\s*=\s*false/)
    expect(text).toMatch(/AdaMfgUnlock\s*=\s*false/)
    expect((await readDeployment(platform, GAME))).toMatchObject({ mfgUnlocked: false, neuralRendering: { preset: 'quality', scale: 100 } })
  })

  it('drops residual frame generation when frame generation is turned off', async () => {
    const { core } = await openProfileStep()
    core.setNeuralRendering({ residualFg: true })
    expect(core.getState().neuralRendering?.residualFg).toBe(true)
    core.selectFrameGenerationMode('off')
    expect(core.getState().neuralRendering?.residualFg).toBe(false)
    core.setNeuralRendering({ residualFg: true })
    expect(core.getState().neuralRendering?.residualFg).toBe(false)
  })

  it('gates 3× to 6× and Dynamic behind the unlock, and falls back to 2× when it is turned off', async () => {
    const { core, platform } = await openProfileStep()
    expect(core.getState().frameGenerationOptions.map((o) => o.id)).toEqual(['off', '2x'])
    core.setMfgUnlocked(true)
    expect(core.getState().frameGenerationOptions.map((o) => o.id)).toContain('4x')
    core.selectFrameGenerationMode('4x')
    core.setMfgUnlocked(false)
    expect(core.getState()).toMatchObject({ mfgUnlocked: false, frameGenerationMode: '2x' })
    core.setMfgUnlocked(true)
    await core.review()
    expect(core.getState().plan).toMatchObject({ frameGenerationMode: '2x', mfgUnlocked: true })
    await core.deploy()
    expect(await ini(platform)).toMatch(/AdaMfgUnlock\s*=\s*true/)
    expect((await readDeployment(platform, GAME))?.mfgUnlocked).toBe(true)
  })

  it('does not offer the unlock on an RTX 30 card, and leaves AdaMfgUnlock off', async () => {
    const { core, platform } = await openProfileStep('NVIDIA GeForce RTX 3080')
    expect(core.getState().mfgUnlock).toBeNull()
    core.setMfgUnlocked(true)
    expect(core.getState().mfgUnlocked).toBe(false)
    await core.review()
    await core.deploy()
    expect(await ini(platform)).not.toMatch(/AdaMfgUnlock\s*=\s*true/)
  })
})
