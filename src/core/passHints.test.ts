import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform } from '../platform/fake'
import { graphicsCard, MACHINES, machine } from '../platform/fixtures'
import { PASS_HINT_MANIFEST } from '../platform/contentFixture'
import { frameGenerationOptionsForGpu } from './frameGeneration'
import { collectDiagnostics } from './diagnostics'
import { readIni } from './ini'
import { planDeployment, type PlanSelection } from './planner'
import { settingChoiceSummary, shownSettingChoices } from './settingChoices'

const ROOT = 'D:\\SteamLibrary\\steamapps\\common\\FINAL FANTASY XIV Online'
const CONFIG = `${ROOT}\\game\\OptiScaler.ini`
const RTX_4090 = 'NVIDIA GeForce RTX 4090'

async function profileStep(gpu = RTX_4090) {
  const platform = createFakePlatform(machine(MACHINES.hints240Hdr, graphicsCard(gpu)))
  const core = createCore(platform)
  await core.scan()
  await core.continueSetup()
  expect(core.getState()).toMatchObject({ error: null, activity: { kind: 'profile' } })
  return { platform, core }
}
const dlssNr = async (platform: { readText(path: string): Promise<string> }) => {
  const ini = readIni(await platform.readText(CONFIG))
  return { Preset: ini.get('DlssNr', 'Preset'), Pass2Preset: ini.get('DlssNr', 'Pass2Preset'), Pass3Preset: ini.get('DlssNr', 'Pass3Preset') }
}
const HINTS = ['nr-hint-pass-1', 'nr-hint-pass-2', 'nr-hint-pass-3']

describe('the Neural Rendering pass preset hints on the Graphics step', () => {
  it('offers the hints with the tier’s other choices, and records no pick until the player makes one', async () => {
    const { core } = await profileStep()
    expect(core.getState().settingChoiceGroups.map((choice) => choice.id)).toEqual(['ui-mode', 'dlssg-preset', 'preview-nr', ...HINTS])
    expect(core.getState().settingChoices).toEqual({})
  })

  it('shows a hint only while the passes picked reach it, and refuses a pick for one that is hidden', async () => {
    const { core } = await profileStep()
    const shown = () => shownSettingChoices(core.getState().settingChoiceGroups, core.getState().settingChoices,
      { gpuName: RTX_4090, frameGenerationMode: core.getState().frameGenerationMode, hdrMode: core.getState().hdrMode, passes: core.getState().neuralRendering!.passes })
      .map((item) => item.choice.id).filter((id) => id.startsWith('nr-hint-'))
    core.setNeuralRendering({ passes: 1 })
    expect(shown()).toEqual(['nr-hint-pass-1'])
    core.selectSettingChoice('nr-hint-pass-2', 'preset-2')
    expect(core.getState().settingChoices).toEqual({})
    core.setNeuralRendering({ passes: 2 })
    expect(shown()).toEqual(['nr-hint-pass-1', 'nr-hint-pass-2'])
    core.selectSettingChoice('nr-hint-pass-2', 'preset-2')
    expect(core.getState().settingChoices).toEqual({ 'nr-hint-pass-2': 'preset-2' })
    core.setNeuralRendering({ passes: 3 })
    expect(shown()).toEqual(HINTS)
  })

  it('installs the shipped hints when the player picks none: Preset 1, then Default for passes 2 and 3', async () => {
    const { core, platform } = await profileStep()
    await core.review()
    expect(core.getState().plan?.settingChoices).toMatchObject({ 'nr-hint-pass-1': 'preset-1', 'nr-hint-pass-2': 'default', 'nr-hint-pass-3': 'default' })
    await core.deploy()
    expect(core.getState().error).toBeNull()
    expect(await dlssNr(platform)).toEqual({ Preset: '1', Pass2Preset: '0', Pass3Preset: '0' })
  })

  it('writes the player’s picks, with Auto written as auto so a later pass inherits pass 1', async () => {
    const { core, platform } = await profileStep()
    core.setNeuralRendering({ passes: 3 })
    core.selectSettingChoice('nr-hint-pass-1', 'preset-3')
    core.selectSettingChoice('nr-hint-pass-2', 'preset-2')
    core.selectSettingChoice('nr-hint-pass-3', 'auto')
    await core.review()
    await core.deploy()
    expect(core.getState().error).toBeNull()
    expect(await dlssNr(platform)).toEqual({ Preset: '3', Pass2Preset: '2', Pass3Preset: 'auto' })
  })

  it('still writes a pick for a pass the player then dropped, and does not list it on Review or in the diagnostics', async () => {
    const { core, platform } = await profileStep()
    core.setNeuralRendering({ passes: 2 })
    core.selectSettingChoice('nr-hint-pass-2', 'preset-2')
    core.setNeuralRendering({ passes: 1 })
    await core.review()
    const plan = core.getState().plan!
    const context = { gpuName: RTX_4090, frameGenerationMode: plan.frameGenerationMode, hdrMode: plan.hdrMode, passes: plan.neuralRendering!.passes }
    expect(settingChoiceSummary(plan.recipe.settingChoices, plan.settingChoices, context).map(({ label }) => label)).toEqual(['UI mode', 'DLSS-G preset', 'Character preview Neural Rendering', 'Pass 1 preset hint'])
    await core.deploy()
    expect(await dlssNr(platform)).toMatchObject({ Pass2Preset: '2' })
    const text = (await collectDiagnostics(platform, core.getState(), '1.0.2', 'beta'))
    expect(text).toContain('Pass 1 preset hint Preset 1')
    expect(text).not.toContain('Pass 2 preset hint')
  })

  it('lists the hints of the passes the player kept on Review and in the diagnostics', async () => {
    const { core, platform } = await profileStep()
    core.setNeuralRendering({ passes: 3 })
    core.selectSettingChoice('nr-hint-pass-3', 'preset-1')
    await core.review()
    const plan = core.getState().plan!
    const context = { gpuName: RTX_4090, frameGenerationMode: plan.frameGenerationMode, hdrMode: plan.hdrMode, passes: plan.neuralRendering!.passes }
    expect(settingChoiceSummary(plan.recipe.settingChoices, plan.settingChoices, context).map(({ label, value }) => `${label}: ${value}`)).toEqual(expect.arrayContaining([
      'Pass 1 preset hint: Preset 1', 'Pass 2 preset hint: Default', 'Pass 3 preset hint: Preset 1',
    ]))
    await core.deploy()
    const text = (await collectDiagnostics(platform, core.getState(), '1.0.2', 'beta'))
    expect(text).toContain('Pass 3 preset hint Preset 1')
  })

  it('shows the stored picks again on Reset, and keeps the passes they belong to', async () => {
    const { core, platform } = await profileStep()
    core.setNeuralRendering({ passes: 2 })
    core.selectSettingChoice('nr-hint-pass-2', 'preset-3')
    await core.review()
    await core.deploy()
    core.finish()
    const reset = createCore(platform)
    await reset.scan()
    await reset.resetSetup()
    expect(reset.getState()).toMatchObject({ activity: { kind: 'profile' }, setupMode: 'reset', neuralRendering: { passes: 2 } })
    expect(reset.getState().settingChoices).toMatchObject({ 'nr-hint-pass-2': 'preset-3' })
    await reset.review()
    expect(reset.getState().plan?.settingChoices).toMatchObject({ 'nr-hint-pass-2': 'preset-3' })
  })
})

describe('the character preview’s Neural Rendering on the Graphics step', () => {
  const previewNr = async (platform: { readText(path: string): Promise<string> }) => readIni(await platform.readText(CONFIG)).get('FFXIV', 'PreviewNR')

  it('is Off unless the player turns it on, and installs false', async () => {
    const { core, platform } = await profileStep()
    expect(core.getState().settingChoices).toEqual({})
    await core.review()
    expect(core.getState().plan?.settingChoices).toMatchObject({ 'preview-nr': 'off' })
    await core.deploy()
    expect(core.getState().error).toBeNull()
    expect(await previewNr(platform)).toBe('false')
  })

  it('installs true when the player picks On, and lists it on Review', async () => {
    const { core, platform } = await profileStep()
    core.selectSettingChoice('preview-nr', 'on')
    expect(core.getState().settingChoices).toEqual({ 'preview-nr': 'on' })
    await core.review()
    const plan = core.getState().plan!
    const context = { gpuName: RTX_4090, frameGenerationMode: plan.frameGenerationMode, hdrMode: plan.hdrMode, passes: plan.neuralRendering!.passes }
    expect(settingChoiceSummary(plan.recipe.settingChoices, plan.settingChoices, context)).toEqual(expect.arrayContaining([{ label: 'Character preview Neural Rendering', value: 'On' }]))
    await core.deploy()
    expect(await previewNr(platform)).toBe('true')
  })

  it('is offered whatever the passes or the frame generation, on an RTX 30 card too', async () => {
    for (const gpu of ['NVIDIA GeForce RTX 3080', RTX_4090]) {
      const { core } = await profileStep(gpu)
      for (const passes of [1, 2, 3] as const) {
        core.setNeuralRendering({ passes })
        const shown = shownSettingChoices(core.getState().settingChoiceGroups, core.getState().settingChoices,
          { gpuName: gpu, frameGenerationMode: core.getState().frameGenerationMode, hdrMode: core.getState().hdrMode, passes })
        expect(shown.map((item) => item.choice.id)).toContain('preview-nr')
      }
    }
  })

  it('shows the stored pick again on Reset', async () => {
    const { core, platform } = await profileStep()
    core.selectSettingChoice('preview-nr', 'on')
    await core.review()
    await core.deploy()
    core.finish()
    const reset = createCore(platform)
    await reset.scan()
    await reset.resetSetup()
    expect(reset.getState().settingChoices).toMatchObject({ 'preview-nr': 'on' })
    reset.selectSettingChoice('preview-nr', 'off')
    await reset.review()
    await reset.deploy()
    expect(await previewNr(platform)).toBe('false')
  })
})

describe('planning the pass preset hints', () => {
  const content = PASS_HINT_MANIFEST.versions[0]
  const tierId = 'rtx-20-30-40'
  const tier = PASS_HINT_MANIFEST.tiers.find((t) => t.id === tierId)!
  const plan = (selection: PlanSelection = {}) => planDeployment(content, tier, true, { files: [], ownedFiles: [], cachedFiles: [] }, null, true, {
    gpuName: RTX_4090, frameGenerationOptions: frameGenerationOptionsForGpu(content.tiers[tierId].frameGenerationOptions!, RTX_4090), frameGenerationMode: '2x', hdrMode: 'off', ...selection,
  })
  const values = (p: ReturnType<typeof plan>) => p.steps.flatMap((s) => s.kind === 'ini_set' ? [`${s.section}.${s.key}=${s.value}`] : [])

  it('writes Preset=1, Pass2Preset=0 and Pass3Preset=0 by default, whatever the passes', () => {
    for (const passes of [1, 2, 3] as const) {
      const p = plan({ neuralRendering: { preset: 'quality', scale: 100, passes, spatialCompression: false, residualFg: false } })
      expect(values(p)).toEqual(expect.arrayContaining(['DlssNr.Preset=1', 'DlssNr.Pass2Preset=0', 'DlssNr.Pass3Preset=0']))
    }
  })

  it('writes a pick for a hidden pass too, as frame generation Off still writes its picks', () => {
    const p = plan({ neuralRendering: { preset: 'quality', scale: 100, passes: 1, spatialCompression: false, residualFg: false }, settingChoices: { 'nr-hint-pass-3': 'auto' } })
    expect(values(p)).toContain('DlssNr.Pass3Preset=auto')
    expect(p.settingChoices['nr-hint-pass-3']).toBe('auto')
  })
})
