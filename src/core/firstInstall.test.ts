import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform } from '../platform/fake'
import { graphicsCard, MACHINES, machine } from '../platform/fixtures'
import { readDeployment } from './deployment'

const ROOT = 'D:\\SteamLibrary\\steamapps\\common\\FINAL FANTASY XIV Online'
const CONFIG = `${ROOT}\\game\\OptiScaler.ini`
const EXE = `${ROOT}\\game\\ffxiv_dx11.exe`
const SID = 'S-1-5-21-100-200-300-1001'
const PREFERENCES = `HKU\\${SID}\\Software\\Microsoft\\DirectX\\UserGpuPreferences`

const RTX_4090 = 'NVIDIA GeForce RTX 4090'
const RTX_3080 = 'NVIDIA GeForce RTX 3080'

/** The Profile step, as the player first sees it. */
async function profileStep(screen = MACHINES.choices240Hdr, gpu = RTX_4090, extra = {}) {
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

const ids = (options: { id: string }[]) => options.map((option) => option.id)
const config = (platform: FakePlatform) => platform.readText(CONFIG)

describe('the first-install choices', () => {
  it('offers every frame generation mode an RTX 4090 runs, defaulting to 2× at 240 Hz, and HDR on an HDR monitor', async () => {
    const { core } = await profileStep()
    const state = core.getState()
    expect(ids(state.frameGenerationOptions)).toEqual(['off', '2x', '3x', '4x', '5x', '6x', 'dynamic'])
    expect(state.frameGenerationOptions.filter((o) => o.experimental).map((o) => o.id)).toEqual(['3x', '4x', '5x', '6x'])
    expect(state.frameGenerationMode).toBe('2x')
    expect(ids(state.hdrOptions)).toEqual(['off', 'hdr', 'scene-hdr'])
    expect(state.hdrMode).toBe('hdr')
    expect(state.selectedProfile).toBe('ultra')
  })

  it('offers an RTX 3080 only Off and 2×, defaulting to Off at 60 Hz, and no HDR on an SDR monitor', async () => {
    const { core } = await profileStep(MACHINES.choices60Sdr, RTX_3080)
    const state = core.getState()
    expect(ids(state.frameGenerationOptions)).toEqual(['off', '2x'])
    expect(state.frameGenerationMode).toBe('off')
    expect(state.hdrOptions).toEqual([])
    expect(state.hdrMode).toBe('off')
  })

  it('writes the choices into the config files once, with the frame cap and peak brightness computed from XIV’s screen', async () => {
    const { core, platform } = await profileStep()
    core.selectFrameGenerationMode('4x')
    core.selectHdrMode('scene-hdr')
    await core.selectProfile('balanced')
    await install(core)

    const text = await config(platform)
    expect(text).toMatch(/\[FrameGeneration\]\r?\nMode\s*=\s*4x/)
    expect(text).toMatch(/Backend\s*=\s*rtx40/)
    expect(text).toMatch(/FfxivHDR\s*=\s*true/)
    expect(text).toMatch(/\[HDR\][^[]*Mode\s*=\s*1/)
    expect(text).toMatch(/FramerateLimit\s*=\s*224\.000000/)
    expect(text).toMatch(/FramerateTargetDMFG\s*=\s*224\.000000/)
    expect(text).toMatch(/DynamicTargetFPS\s*=\s*224\.000000/)
    expect(text).toMatch(/PeakNits\s*=\s*1000/)
    // Balanced at 4K: Balanced upscaling.
    expect(text).toMatch(/ForcePerfQuality\s*=\s*1/)
  })

  it('refuses a frame generation mode or HDR mode the card or monitor does not offer, and changes nothing after the step', async () => {
    const { core } = await profileStep(MACHINES.choices60Sdr, RTX_3080)
    core.selectFrameGenerationMode('6x')
    core.selectHdrMode('hdr')
    expect(core.getState()).toMatchObject({ frameGenerationMode: 'off', hdrMode: 'off' })

    core.selectFrameGenerationMode('2x')
    expect(core.getState().frameGenerationMode).toBe('2x')
    await install(core)
    core.finish()
    core.selectFrameGenerationMode('off')
    expect(core.getState().frameGenerationMode).toBe('2x')
  })

  it('stores the choices in the deployment record, and a reopened Lucent reads them back', async () => {
    const { core, platform } = await profileStep()
    core.selectFrameGenerationMode('dynamic')
    core.selectHdrMode('off')
    await core.selectProfile('performance')
    core.setIncludeReShade(false)
    await install(core)

    const record = (await readDeployment(platform, ROOT))!
    expect(record).toMatchObject({ profile: 'performance', frameGenerationMode: 'dynamic', hdrMode: 'off', includeReShade: false })
    const reopened = createCore(platform)
    await reopened.scan()
    expect(reopened.getState()).toMatchObject({ selectedProfile: 'performance', frameGenerationMode: 'dynamic', hdrMode: 'off', includeReShade: false })
  })

  it('carries the choices through an administrator relaunch, with Auto HDR set for the player rather than the administrator', async () => {
    const original = 'GpuPreference=2;'
    const { m, core, platform } = await profileStep(MACHINES.choices240Hdr, RTX_4090, {
      readOnlyDirectories: [`${ROOT}\\game`], registry: { [PREFERENCES]: { [EXE]: original } },
    })
    core.selectFrameGenerationMode('5x')
    core.selectHdrMode('scene-hdr')
    await core.review()
    await core.deploy()
    expect(platform.elevationRequests).toHaveLength(1)
    expect(JSON.parse(await platform.readText(platform.elevationRequests[0])).request).toMatchObject({ kind: 'deploy', frameGenerationMode: '5x', hdrMode: 'scene-hdr' })

    m.elevated = true
    m.userSid = 'S-1-5-21-999-999-999-500'
    const resumed = createCore(platform)
    await resumed.scan()
    expect(resumed.getState()).toMatchObject({ error: null, activity: { kind: 'done' }, frameGenerationMode: '5x', hdrMode: 'scene-hdr' })
    expect(await config(platform)).toMatch(/\[FrameGeneration\]\r?\nMode\s*=\s*5x/)
    expect(await platform.readUserGpuPreferences(SID, EXE)).toBe('GpuPreference=2;AutoHDREnable=2096;')
    expect(await platform.readUserGpuPreferences('S-1-5-21-999-999-999-500', EXE)).toBeNull()
  })

  it('stores Off for HDR when the monitor offers none, and writes it', async () => {
    const { core, platform } = await profileStep(MACHINES.choices60Sdr, RTX_3080)
    await install(core)
    expect((await readDeployment(platform, ROOT))?.hdrMode).toBe('off')
    expect(await config(platform)).toMatch(/FfxivHDR\s*=\s*false/)
    expect(await config(platform)).toMatch(/FramerateLimit\s*=\s*59\.000000/)
  })
})

describe('Windows Auto HDR', () => {
  const original = 'GpuPreference=2;AutoHDREnable=1;'
  const registry = { registry: { [PREFERENCES]: { [EXE]: original } } }

  it('is turned off for XIV when HDR is on, and Uninstall restores it', async () => {
    const { core, platform } = await profileStep(MACHINES.choices240Hdr, RTX_4090, registry)
    await install(core)
    expect(await platform.readUserGpuPreferences(SID, EXE)).toBe('GpuPreference=2;AutoHDREnable=0;')
    core.finish()

    await core.uninstall()
    expect(core.getState().error).toBeNull()
    expect(await platform.readUserGpuPreferences(SID, EXE)).toBe(original)
  })

  it('is turned off for Scene HDR as well, and added when XIV had no preference', async () => {
    const { core, platform } = await profileStep()
    core.selectHdrMode('scene-hdr')
    await install(core)
    expect(await platform.readUserGpuPreferences(SID, EXE)).toBe('AutoHDREnable=2096;')
    core.finish()
    await core.uninstall()
    expect(await platform.readUserGpuPreferences(SID, EXE)).toBeNull()
  })

  it('is left alone when HDR is off', async () => {
    const { core, platform } = await profileStep(MACHINES.choices240Hdr, RTX_4090, registry)
    core.selectHdrMode('off')
    await install(core)
    expect(await platform.readUserGpuPreferences(SID, EXE)).toBe(original)
    expect((await readDeployment(platform, ROOT))!.journal.some((entry) => entry.registry)).toBe(false)
  })

  it('is undone with the rest when the install fails', async () => {
    const { core, platform } = await profileStep(MACHINES.choices240Hdr, RTX_4090, registry)
    const write = platform.writeUserGpuPreferences.bind(platform)
    let failed = false
    platform.writeUserGpuPreferences = async (sid, exe, value) => {
      await write(sid, exe, value)
      if (!failed) { failed = true; throw new Error('registry hiccup') }
    }
    await core.review()
    await core.deploy()
    expect(core.getState().error).toMatch(/registry hiccup/)
    expect(await platform.readUserGpuPreferences(SID, EXE)).toBe(original)
    expect(await platform.listFiles(`${ROOT}\\game`)).not.toContain('winmm.dll')
  })

  it('is put back by recovery when the install was interrupted after it', async () => {
    const { core, platform } = await profileStep(MACHINES.choices240Hdr, RTX_4090, registry)
    const write = platform.writeUserGpuPreferences.bind(platform)
    let broken = true
    platform.writeUserGpuPreferences = async (sid, exe, value) => {
      await write(sid, exe, value)
      if (broken) throw new Error('registry hiccup')
    }
    await core.review()
    await core.deploy()
    expect(core.getState()).toMatchObject({ recoveryRequired: true })
    expect((await readDeployment(platform, ROOT))?.status).toBe('applying')

    broken = false
    const reopened = createCore(platform)
    await reopened.scan()
    expect(reopened.getState()).toMatchObject({ error: null, recoveryRequired: false, deployment: null })
    expect(await platform.readUserGpuPreferences(SID, EXE)).toBe(original)
    expect(await platform.listFiles(`${ROOT}\\game`)).not.toContain('winmm.dll')
  })
})
