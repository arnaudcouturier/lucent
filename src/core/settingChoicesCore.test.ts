import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform } from '../platform/fake'
import { graphicsCard, MACHINES, machine } from '../platform/fixtures'
import { dataPaths, readDeployment } from './deployment'

const ROOT = 'D:\\SteamLibrary\\steamapps\\common\\FINAL FANTASY XIV Online'
const CONFIG = `${ROOT}\\game\\OptiScaler.ini`
const RTX_4090 = 'NVIDIA GeForce RTX 4090'
const RTX_3080 = 'NVIDIA GeForce RTX 3080'

async function profileStep(screen = MACHINES.settings240Hdr, gpu = RTX_4090, extra = {}) {
  const m = machine(screen, graphicsCard(gpu), extra)
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.continueSetup()
  expect(core.getState()).toMatchObject({ error: null, activity: { kind: 'profile' } })
  return { m, platform, core }
}
async function install(core: ReturnType<typeof createCore>) {
  await core.review()
  await core.deploy()
  expect(core.getState().error).toBeNull()
}
const config = (platform: { readText(path: string): Promise<string> }) => platform.readText(CONFIG)

describe('the UI mode and DLSS-G preset choices on the Profile step', () => {
  it('offers the tier’s choices and keeps the player’s picks empty until they pick', async () => {
    const { core } = await profileStep()
    const state = core.getState()
    expect(state.settingChoiceGroups.map((choice) => choice.id)).toEqual(['ui-mode', 'dlssg-preset'])
    expect(state.settingChoices).toEqual({})
  })

  it('takes a pick the choice allows, and refuses one that is blocked, unknown or not shown', async () => {
    const { core } = await profileStep()
    core.selectSettingChoice('dlssg-preset', 'b')
    expect(core.getState().settingChoices).toEqual({ 'dlssg-preset': 'b' })
    // Preset C is blocked while the UI mode is Recomposition, which it is by default.
    core.selectSettingChoice('dlssg-preset', 'c')
    expect(core.getState().settingChoices).toEqual({ 'dlssg-preset': 'b' })
    core.selectSettingChoice('dlssg-preset', 'nope')
    core.selectSettingChoice('no-such-choice', 'a')
    expect(core.getState().settingChoices).toEqual({ 'dlssg-preset': 'b' })
    core.selectSettingChoice('ui-mode', 'off')
    core.selectSettingChoice('dlssg-preset', 'c')
    expect(core.getState().settingChoices).toEqual({ 'dlssg-preset': 'c', 'ui-mode': 'off' })
    // HDR is on by default on this panel, so UI-free is blocked until HDR is Off.
    core.selectSettingChoice('ui-mode', 'ui-free')
    expect(core.getState().settingChoices['ui-mode']).toBe('off')
    core.selectHdrMode('off')
    core.selectSettingChoice('ui-mode', 'ui-free')
    expect(core.getState().settingChoices['ui-mode']).toBe('ui-free')
    // Frame generation Off hides the choices, so nothing more is taken.
    core.selectFrameGenerationMode('off')
    core.selectSettingChoice('dlssg-preset', 'a')
    expect(core.getState().settingChoices['dlssg-preset']).toBe('c')
  })

  it('writes the defaults, Recomposition and Auto, when the player picks nothing', async () => {
    const { core, platform } = await profileStep()
    await install(core)
    const text = await config(platform)
    expect(text).toMatch(/\[HudLess\]\r?\nMode\s*=\s*recomposition/)
    expect(text).toMatch(/\[DLSSG\][^[]*RenderPreset\s*=\s*0/)
    expect(await readDeployment(platform, ROOT)).toMatchObject({ settingChoices: { 'ui-mode': 'recomposition', 'dlssg-preset': 'auto' } })
  })

  it('writes the picks into the config once, and records them', async () => {
    const { core, platform } = await profileStep()
    core.selectSettingChoice('ui-mode', 'off')
    core.selectSettingChoice('dlssg-preset', 'c')
    await install(core)
    const text = await config(platform)
    expect(text).toMatch(/\[HudLess\]\r?\nMode\s*=\s*off/)
    expect(text).toMatch(/\[DLSSG\][^[]*RenderPreset\s*=\s*3/)
    expect(await readDeployment(platform, ROOT)).toMatchObject({ settingChoices: { 'ui-mode': 'off', 'dlssg-preset': 'c' } })
    expect(core.getState().settingChoices).toEqual({ 'ui-mode': 'off', 'dlssg-preset': 'c' })
  })

  it('writes the default for a pick that became blocked, as the Review shows it', async () => {
    const { core, platform } = await profileStep()
    core.selectSettingChoice('ui-mode', 'off')
    core.selectSettingChoice('dlssg-preset', 'c')
    core.selectSettingChoice('ui-mode', 'recomposition')
    await install(core)
    expect(await config(platform)).toMatch(/\[DLSSG\][^[]*RenderPreset\s*=\s*0/)
    expect(await readDeployment(platform, ROOT)).toMatchObject({ settingChoices: { 'ui-mode': 'recomposition', 'dlssg-preset': 'auto' } })
  })

  it('writes UI mode Off and no preset for an RTX 30 card, which has no DLSS frame generation', async () => {
    const { core, platform } = await profileStep(MACHINES.settings60Sdr, RTX_3080)
    expect(core.getState().settingChoices).toEqual({})
    await install(core)
    const text = await config(platform)
    expect(text).toMatch(/\[HudLess\]\r?\nMode\s*=\s*off/)
    expect(text).not.toMatch(/RenderPreset/)
    expect(await readDeployment(platform, ROOT)).toMatchObject({ settingChoices: { 'ui-mode': 'off' } })
  })

  it('shows the stored picks again on Reset, and writes the new ones', async () => {
    const { core, platform } = await profileStep()
    core.selectSettingChoice('ui-mode', 'off')
    core.selectSettingChoice('dlssg-preset', 'b')
    await install(core)
    core.finish()
    const reset = createCore(platform)
    await reset.scan()
    expect(reset.getState().settingChoices).toEqual({ 'ui-mode': 'off', 'dlssg-preset': 'b' })
    await reset.resetSetup()
    expect(reset.getState()).toMatchObject({ activity: { kind: 'profile' }, setupMode: 'reset', settingChoices: { 'ui-mode': 'off', 'dlssg-preset': 'b' } })
    expect(reset.getState().settingChoiceGroups.map((choice) => choice.id)).toEqual(['ui-mode', 'dlssg-preset'])
    reset.selectSettingChoice('ui-mode', 'recomposition')
    reset.selectSettingChoice('dlssg-preset', 'auto')
    await reset.review()
    await reset.deploy()
    expect(reset.getState().error).toBeNull()
    expect(await config(platform)).toMatch(/\[HudLess\]\r?\nMode\s*=\s*recomposition/)
    expect(await readDeployment(platform, ROOT)).toMatchObject({ settingChoices: { 'ui-mode': 'recomposition', 'dlssg-preset': 'auto' } })
  })

  it('refuses a deployment record whose setting choices are damaged, and reads one that predates them', async () => {
    const { core, platform } = await profileStep()
    await install(core)
    const { record } = await dataPaths(platform, ROOT)
    const stored = JSON.parse(await platform.readText(record))
    for (const bad of [{ 'Ui Mode': 'off' }, { 'ui-mode': 3 }, { 'ui-mode': 'Off' }, ['off'], 'off', Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`choice-${i}`, 'x']))]) {
      await platform.writeText(record, JSON.stringify({ ...stored, settingChoices: bad }))
      await expect(readDeployment(platform, ROOT)).rejects.toThrow(/setting choices are damaged/)
    }
    await platform.writeText(record, JSON.stringify({ ...stored, settingChoices: undefined }))
    await expect(readDeployment(platform, ROOT)).resolves.toMatchObject({ status: 'complete' })
  })

  it('refuses an administrator request with damaged setting choices', async () => {
    const { m, core, platform } = await profileStep(MACHINES.settings240Hdr, RTX_4090, { readOnlyDirectories: [`${ROOT}\\game`] })
    await core.review()
    await core.deploy()
    const path = platform.elevationRequests[0]
    const stored = JSON.parse(await platform.readText(path))
    await platform.writeText(path, JSON.stringify({ ...stored, request: { ...stored.request, settingChoices: { 'ui-mode': { nested: true } } } }))
    m.elevated = true
    const resumed = createCore(platform)
    await resumed.scan()
    expect(resumed.getState().error).toMatch(/administrator resume request is invalid/)
    expect(await platform.listFiles(`${ROOT}\\game`)).not.toContain('OptiScaler.ini')
  })

  it('carries the picks through an administrator relaunch', async () => {
    const { m, core, platform } = await profileStep(MACHINES.settings240Hdr, RTX_4090, { readOnlyDirectories: [`${ROOT}\\game`] })
    core.selectSettingChoice('ui-mode', 'off')
    core.selectSettingChoice('dlssg-preset', 'a')
    await core.review()
    await core.deploy()
    expect(platform.elevationRequests).toHaveLength(1)
    expect(JSON.parse(await platform.readText(platform.elevationRequests[0])).request).toMatchObject({ kind: 'deploy', settingChoices: { 'ui-mode': 'off', 'dlssg-preset': 'a' } })

    m.elevated = true
    const resumed = createCore(platform)
    await resumed.scan()
    expect(resumed.getState()).toMatchObject({ error: null, activity: { kind: 'done' }, settingChoices: { 'ui-mode': 'off', 'dlssg-preset': 'a' } })
    const text = await config(platform)
    expect(text).toMatch(/\[HudLess\]\r?\nMode\s*=\s*off/)
    expect(text).toMatch(/\[DLSSG\][^[]*RenderPreset\s*=\s*1/)
  })
})
