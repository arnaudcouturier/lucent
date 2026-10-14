import { expect, it } from 'vitest'
import { planDeployment } from './planner'
import { TEST_CONTENT, TEST_MANIFEST, OPTISCALER_HASH, HDR_FRAME_GENERATION_MANIFEST } from '../platform/contentFixture'
import { frameGenerationOptionsForGpu } from './frameGeneration'
import type { FrameGenerationOption, HdrOption } from '../shared/manifest'

it('plans the final file count and downloads once per hash, including optional ReShade', () => {
  const scan = { files: [], ownedFiles: [], cachedFiles: [OPTISCALER_HASH] }
  const plan = planDeployment(TEST_CONTENT, TEST_MANIFEST.tiers[1], true, scan)
  expect(plan.counts).toEqual({ added: 5, backedUp: 0, downloads: 4 })
  expect(plan.downloadSize).toBe(41)
  expect(plan.steps).toHaveLength(6)
  expect(planDeployment(TEST_CONTENT, TEST_MANIFEST.tiers[1], false, scan).counts).toEqual({ added: 1, backedUp: 0, downloads: 0 })
})

it('keeps screen-derived settings only for configs included in the selected plan', () => {
  const content = { ...TEST_CONTENT, tiers: { ...TEST_CONTENT.tiers, 'rtx-30-40': {
    ...TEST_CONTENT.tiers['rtx-30-40'],
    screenDerivedSettings: [{ file: 'ReShade.ini', section: 'FrameRate', key: 'Limit', value: 'frameCap' as const }],
  } } }
  const scan = { files: [], ownedFiles: [], cachedFiles: [] }
  expect(planDeployment(content, TEST_MANIFEST.tiers[1], false, scan).recipe.screenDerivedSettings).toEqual([])
  expect(planDeployment(content, TEST_MANIFEST.tiers[1], true, scan).recipe.screenDerivedSettings).toEqual(content.tiers['rtx-30-40'].screenDerivedSettings)
})

it('writes the screen-derived settings last, from the screen it is given, and only for included configs', () => {
  const content = { ...TEST_CONTENT, tiers: { ...TEST_CONTENT.tiers, 'rtx-30-40': {
    ...TEST_CONTENT.tiers['rtx-30-40'],
    screenDerivedSettings: [
      { file: 'ReShade.ini', section: 'FrameRate', key: 'Limit', value: 'frameCap' as const },
      { file: 'ReShade.ini', section: 'HDR', key: 'PeakNits', value: 'peakNits' as const },
    ],
  } } }
  const scan = { files: [], ownedFiles: [], cachedFiles: [] }
  const iniSteps = (plan: ReturnType<typeof planDeployment>) => plan.steps.filter((step) => step.kind === 'ini_set')
  const screen = { frameCap: 224, peakNits: 1000 }

  expect(iniSteps(planDeployment(content, TEST_MANIFEST.tiers[1], true, scan, null, true, { screen })).slice(-2)).toEqual([
    { kind: 'ini_set', file: 'ReShade.ini', section: 'FrameRate', key: 'Limit', value: '224.000000' },
    { kind: 'ini_set', file: 'ReShade.ini', section: 'HDR', key: 'PeakNits', value: '1000' },
  ])
  expect(iniSteps(planDeployment(content, TEST_MANIFEST.tiers[1], true, scan, null, true, { screen: { frameCap: 138, peakNits: null } })).slice(-1))
    .toEqual([{ kind: 'ini_set', file: 'ReShade.ini', section: 'HDR', key: 'PeakNits', value: '1100' }])
  expect(iniSteps(planDeployment(content, TEST_MANIFEST.tiers[1], false, scan, null, true, { screen }))).toEqual([])
  expect(iniSteps(planDeployment(content, TEST_MANIFEST.tiers[1], true, scan))).toEqual([])
})

it('plans the default HDR mode and keeps HDR-owned keys out of overlapping profile settings', () => {
  const base = TEST_CONTENT.tiers['rtx-30-40']
  const frameGenerationOptions: FrameGenerationOption[] = [{
    id: '2x', settings: [
      { file: 'OptiScaler.ini', section: 'FrameGeneration', key: 'Mode', value: '2x' },
      { file: 'OptiScaler.ini', section: 'XeFG', key: 'UnlockMFG', value: 'true' },
      { file: 'OptiScaler.ini', section: 'XeFG', key: 'MaxInterpolatedFrames', value: '3' },
      { file: 'OptiScaler.ini', section: 'XeFG', key: 'DynamicMFG', value: 'true' },
    ], hdrSettings: [
      { file: 'OptiScaler.ini', section: 'XeFG', key: 'UnlockMFG', value: 'false' },
      { file: 'OptiScaler.ini', section: 'XeFG', key: 'MaxInterpolatedFrames', value: '1' },
      { file: 'OptiScaler.ini', section: 'XeFG', key: 'DynamicMFG', value: 'false' },
    ],
  }]
  const hdrOptions: HdrOption[] = [
    { id: 'off', settings: [{ file: 'OptiScaler.ini', section: 'HDR', key: 'FfxivHDR', value: 'false' }] },
    { id: 'hdr', settings: [
      { file: 'OptiScaler.ini', section: 'HDR', key: 'FfxivHDR', value: 'true' },
      { file: 'OptiScaler.ini', section: 'HDR', key: 'Mode', value: '0' },
    ] },
    { id: 'scene-hdr', settings: [
      { file: 'OptiScaler.ini', section: 'HDR', key: 'FfxivHDR', value: 'true' },
      { file: 'OptiScaler.ini', section: 'HDR', key: 'Mode', value: '1' },
    ] },
  ]
  const content = { ...TEST_CONTENT, tiers: { ...TEST_CONTENT.tiers, 'rtx-30-40': {
    ...base,
    recipe: [...base.recipe, { kind: 'copy' as const, file: OPTISCALER_HASH, to: 'OptiScaler.ini' }],
    ownedConfigs: [...base.ownedConfigs, { path: 'OptiScaler.ini' }],
    performanceProfiles: [{ id: 'fidelity' as const, label: 'Fidelity', description: 'Test overlap.', settings: [
      { file: 'OptiScaler.ini', section: 'HDR', key: 'FfxivHDR', value: 'false' },
      { file: 'OptiScaler.ini', section: 'HDR', key: 'Mode', value: '99' },
    ] }],
    hdrOptions, frameGenerationOptions,
  } } }
  const plan = planDeployment(content, TEST_MANIFEST.tiers[1], true,
    { files: [], ownedFiles: [], cachedFiles: [] }, 'fidelity', true,
    { hdrOn: true, frameGenerationMode: '2x' })
  const iniSteps = plan.steps.filter((step) => step.kind === 'ini_set')
  const get = (section: string, key: string) => iniSteps.find((step) => step.kind === 'ini_set' && step.section === section && step.key === key)?.value
  expect(plan.recipe.hdrOptions?.find((option) => option.id === 'hdr')?.settings).toHaveLength(2)
  expect(get('HDR', 'FfxivHDR')).toBe('true')
  expect(get('HDR', 'Mode')).toBe('0')
  expect(get('XeFG', 'UnlockMFG')).toBe('false')
  expect(get('XeFG', 'MaxInterpolatedFrames')).toBe('1')
  expect(get('XeFG', 'DynamicMFG')).toBe('false')

  const disabledPlan = planDeployment(content, TEST_MANIFEST.tiers[1], true,
    { files: [], ownedFiles: [], cachedFiles: [] }, 'fidelity', false,
    { hdrOn: true, hdrMode: 'hdr', frameGenerationOptions, frameGenerationMode: '2x' })
  const disabledIni = disabledPlan.steps.filter((step) => step.kind === 'ini_set')
  const disabledValue = (section: string, key: string) => disabledIni.find((step) => step.kind === 'ini_set'
    && step.section === section && step.key === key)?.value
  expect(disabledValue('HDR', 'FfxivHDR')).toBe('true')
  expect(disabledValue('HDR', 'Mode')).toBe('0')
  expect(disabledValue('XeFG', 'UnlockMFG')).toBe('true')
  expect(disabledValue('XeFG', 'MaxInterpolatedFrames')).toBe('3')
  expect(disabledValue('XeFG', 'DynamicMFG')).toBe('true')
})

it('counts originals once across rename, overwrite and delete, while protecting unowned files', () => {
  const content = { ...TEST_CONTENT, tiers: { ...TEST_CONTENT.tiers, 'rtx-30-40': {
    ...TEST_CONTENT.tiers['rtx-30-40'], ownedConfigs: [], shippedPresets: [], recipe: [
      { kind: 'rename' as const, from: 'old.dll', to: 'winmm.dll' },
      { kind: 'copy' as const, file: OPTISCALER_HASH, to: 'winmm.dll' },
      { kind: 'delete' as const, path: 'obsolete.ini' },
    ],
  } } }
  const plan = planDeployment(content, TEST_MANIFEST.tiers[1], false, { files: ['OLD.DLL', 'obsolete.ini', 'User.ini'], ownedFiles: ['old.dll', 'obsolete.ini'], cachedFiles: [] })
  expect(plan.counts).toEqual({ added: 1, backedUp: 2, downloads: 1 })
  expect(plan.filesToBackup).toEqual(['old.dll', 'obsolete.ini'])
  expect(plan.unclaimedPaths).toEqual([])
  expect(plan.expectedFiles).toEqual([{ path: 'winmm.dll', sha256: OPTISCALER_HASH }])
})

it('plans each first-install choice once, with the frame cap and peak brightness from the screen', () => {
  const content = HDR_FRAME_GENERATION_MANIFEST.versions[0]
  const tier = HDR_FRAME_GENERATION_MANIFEST.tiers.find((t) => t.id === 'rtx-30-40')!
  const scan = { files: [], ownedFiles: [], cachedFiles: [] }
  const values = (plan: ReturnType<typeof planDeployment>) => Object.fromEntries(plan.steps.flatMap((s) =>
    s.kind === 'ini_set' ? [[`${s.section}.${s.key}`, s.value]] : []))
  const options = (gpuName: string) => frameGenerationOptionsForGpu(content.tiers[tier.id].frameGenerationOptions!, gpuName)

  const plan = planDeployment(content, tier, true, scan, 'balanced', true, {
    gpuName: 'NVIDIA GeForce RTX 4090', frameGenerationOptions: options('NVIDIA GeForce RTX 4090'), frameGenerationMode: '4x',
    hdrMode: 'scene-hdr', hdrOn: false, outputHeight: 1440, screen: { frameCap: 138, peakNits: 800 },
  })
  expect(plan).toMatchObject({ profile: 'balanced', frameGenerationMode: '4x', hdrMode: 'scene-hdr' })
  expect(values(plan)).toMatchObject({
    'FrameGeneration.Mode': '4x', 'FrameGeneration.Backend': 'rtx40', 'HDR.FfxivHDR': 'true', 'HDR.Mode': '1',
    'Framerate.FramerateLimit': '138.000000', 'DLSSG.FramerateTargetDMFG': '138.000000', 'XeFG.DynamicTargetFPS': '138.000000', 'HDR.PeakNits': '800',
    'QualityOverrides.ForcePerfQuality': '1',
  })

  // HDR is a first-install choice. The monitor may report Windows HDR off at the
  // time of installation; the chosen HDR mode still needs the HDR frame-generation
  // provider so the deployed config is ready when Windows HDR is enabled.
  const hdrChoiceWithWindowsHdrOff = planDeployment(content, tier, true, scan, 'balanced', true, {
    gpuName: 'NVIDIA GeForce RTX 3080', frameGenerationOptions: options('NVIDIA GeForce RTX 3080'), frameGenerationMode: '2x',
    hdrMode: 'hdr', hdrOn: false, screen: { frameCap: 59, peakNits: null },
  })
  expect(hdrChoiceWithWindowsHdrOff.frameGenerationMode).toBe('2x')
  expect(values(hdrChoiceWithWindowsHdrOff)).toMatchObject({ 'HDR.FfxivHDR': 'true', 'FrameGeneration.Mode': 'xeFG2' })

  // The same tier gives an RTX 3080 no 4×: the plan writes no mode the card was not offered.
  const rtx30 = planDeployment(content, tier, true, scan, 'balanced', true, {
    gpuName: 'NVIDIA GeForce RTX 3080', frameGenerationOptions: options('NVIDIA GeForce RTX 3080'), frameGenerationMode: '4x', hdrMode: 'off', screen: { frameCap: 59, peakNits: null },
  })
  expect(rtx30.frameGenerationMode).toBeNull()
  expect(values(rtx30)).not.toHaveProperty(['FrameGeneration.Mode'])
  expect(values(rtx30)).toMatchObject({ 'HDR.FfxivHDR': 'false', 'Framerate.FramerateLimit': '59.000000', 'HDR.PeakNits': '1100' })
})
