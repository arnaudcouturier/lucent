import { expect, it } from 'vitest'
import { createCore, setupChoices } from './core'
import { DEFAULT_ENV, createFakePlatform } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { dataPaths, readDeployment } from './deployment'
import { PROFILE_MANIFEST } from '../platform/contentFixture'
import { MANIFEST_URL } from './manifest'
import { planDeployment } from './planner'
import type { PerformanceProfile, TierRecipe } from '../shared/manifest'
import type { MonitorInfo } from './platform'

const ROOT = 'C:\\Games\\XIV'
const profileMachine = () => machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))

function fourProfileManifest() {
  const manifest = structuredClone(PROFILE_MANIFEST)
  for (const recipe of Object.values(manifest.versions[0].tiers) as TierRecipe[]) {
    if (!recipe.performanceProfiles) continue
    recipe.performanceProfilesV2 = (['ultra', 'fidelity', 'balanced', 'performance'] as const).map((id): PerformanceProfile => {
      const ultra = id === 'ultra'
      const performance = id === 'performance'
      const quality = id === 'ultra' || id === 'fidelity'
        ? { '1080p': '2', '1440p': '2', '4k+': '2' }
        : id === 'balanced' ? { '1080p': '2', '1440p': '1', '4k+': '1' }
          : { '1080p': '1', '1440p': '1', '4k+': '0' }
      const summary = Object.fromEntries(Object.entries(quality).map(([column, value]) => [column,
        `${ultra ? 'Two' : 'One'} Neural Rendering ${ultra ? 'passes' : 'pass'}, ${value === '2' ? 'Quality' : value === '1' ? 'Balanced' : 'Performance'} upscaling`])) as PerformanceProfile['summary']
      return {
        id, label: id[0].toUpperCase() + id.slice(1), description: ultra ? 'Two Neural Rendering passes for more detail.' : 'One Neural Rendering pass.', summary,
        ...(id === 'ultra' ? { gpuNamePatterns: ['RTX 4090|RTX 4080'] } : id === 'fidelity' ? { gpuNamePatterns: ['RTX 4070'] } : {}),
        settings: [
          { file: 'OptiScaler.ini', section: 'DlssNr', key: 'Passes', value: ultra ? '2' : '1' },
          { file: 'OptiScaler.ini', section: 'QualityOverrides', key: 'ForcePerfQuality', value: quality },
          { file: 'OptiScaler.ini', section: 'DlssNr', key: 'SpatialCompression', value: String(performance) },
          { file: 'OptiScaler.ini', section: 'DlssNr', key: 'ResidualFG', value: String(performance) },
        ],
      }
    })
    delete recipe.performanceProfiles
  }
  return manifest
}

function fourProfileMachine(manifest = fourProfileManifest()) {
  const content = fixtureContentHost()
  return machine(content, { remoteText: { ...content.remoteText, [MANIFEST_URL]: JSON.stringify(manifest) } }, graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))
}

const xivDisplayConfig = `${DEFAULT_ENV.Documents}\\My Games\\FINAL FANTASY XIV - A Realm Reborn\\FFXIV.cfg`
const profileMonitor = (height: number): MonitorInfo => ({
  deviceName: '\\\\.\\DISPLAY1', bounds: { left: 0, top: 0, right: 3840, bottom: height }, primary: true,
  refreshHz: 144, width: height * 16 / 9, height, hdrSupported: true, hdrOn: false, peakNits: 1000,
})
function screenProfileMachine(height: number) {
  return machine(fourProfileMachine(), {
    monitors: [profileMonitor(height)],
    files: { [xivDisplayConfig]: '<Display Settings>\r\nMainAdapter NVIDIA (\\\\.\\DISPLAY1)\r\nScreenMode 2\r\n' },
  })
}

it('offers profiles between Scan and Review and deploys the selected values with a last-written copy', async () => {
  const platform = createFakePlatform(profileMachine())
  const core = createCore(platform)
  await core.scan()
  await core.continueSetup()
  expect(core.getState().activity.kind).toBe('profile')
  expect(core.getState().profiles.map((p) => p.label)).toEqual(['Fidelity', 'Balanced', 'Performance'])
  await core.selectProfile('performance')
  await core.review(false)
  await core.deploy()
  expect(core.getState().error).toBeNull()
  expect(core.getState().deployment).toMatchObject({ profile: 'performance', includeReShade: false })
  const text = await platform.readText(`${ROOT}\\game\\OptiScaler.ini`)
  expect(text).toBe('; OptiScaler\r\n[DlssNr]\r\n; Neural Rendering passes\r\nPasses = 1\r\nSpatialCompression = true\r\nResidualFG = true\r\n\r\n[Logging]\r\nLogToFile = false\r\n')
  expect(core.getState().deployment?.ownedConfigs['OptiScaler.ini']).toBe(text)
  core.finish()
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState().selectedProfile).toBe('performance')
  expect(reopened.getState().activity).toMatchObject({ kind: 'deployment', drift: null })
})

it('switches profile twice and reopens to a healthy deployment', async () => {
  const platform = createFakePlatform(profileMachine())
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  await core.selectProfile('performance')
  await core.selectProfile('balanced')
  expect(core.getState().error).toBeNull()
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState()).toMatchObject({ error: null, recoveryRequired: false, selectedProfile: 'balanced', activity: { kind: 'deployment', drift: null } })
  expect(await platform.readText(`${ROOT}\\game\\OptiScaler.ini`)).toBe('; OptiScaler\r\n[DlssNr]\r\n; Neural Rendering passes\r\nPasses = 1\r\nSpatialCompression = false\r\nResidualFG = false\r\n\r\n[Logging]\r\nLogToFile = false\r\n')
  await reopened.selectProfile('fidelity')
  expect(reopened.getState()).toMatchObject({ error: null, selectedProfile: 'fidelity' })
})

it('uses Windows path matching for profile configs and omits settings for excluded ReShade', async () => {
  const manifest = structuredClone(PROFILE_MANIFEST)
  for (const p of manifest.versions[0].tiers['rtx-30-40'].performanceProfiles!) {
    for (const setting of p.settings) setting.file = 'optiscaler.INI'
    p.settings.push({ file: 'reshade.INI', section: 'GENERAL', key: 'PerformanceMode', value: p.id === 'performance' ? '1' : '0' })
  }
  const platform = createFakePlatform(machine(profileMachine(), { remoteText: { [MANIFEST_URL]: JSON.stringify(manifest) } }))
  const core = createCore(platform)
  await core.scan()
  await core.review(false)
  await core.deploy()
  core.finish()
  await core.selectProfile('balanced')
  expect(core.getState().error).toBeNull()
  expect(core.getState().deployment?.profile).toBe('balanced')
  expect(core.getState().deployment?.ownedConfigs['OptiScaler.ini']).toContain('Passes = 1\r\n')
  expect(await platform.listFiles(`${ROOT}\\game`)).not.toContain('reshade.ini')
})

it('recovers a crashed profile change on reopening without undoing the deployment', async () => {
  const platform = createFakePlatform(profileMachine())
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  const original = await platform.readText(`${ROOT}\\game\\OptiScaler.ini`)
  const before = await readDeployment(platform, ROOT)
  const write = platform.writeText.bind(platform)
  let reachedCrash!: () => void
  const crashed = new Promise<void>((resolve) => { reachedCrash = resolve })
  platform.writeText = async (path, text) => {
    await write(path, text)
    if (path.endsWith('OptiScaler.ini')) { reachedCrash(); await new Promise<void>(() => {}) }
  }
  void core.selectProfile('performance')
  await crashed
  platform.crash()
  platform.writeText = write
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState().activity).toMatchObject({ kind: 'deployment', drift: null })
  expect(await platform.readText(`${ROOT}\\game\\OptiScaler.ini`)).toBe(original)
  expect(await platform.readText(`${ROOT}\\game\\winmm.dll`)).toBe('OptiScaler')
  expect(await readDeployment(platform, ROOT)).toEqual(before)
})

it('keeps a Disabled deployment inactive while changing its profile', async () => {
  const platform = createFakePlatform(profileMachine())
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  const record = (await readDeployment(platform, ROOT))!
  record.enabled = false
  await platform.renameFile(`${ROOT}\\game\\winmm.dll`, `${ROOT}\\game\\winmm.dll.disabled`)
  record.files['winmm.dll.disabled'] = record.files['winmm.dll']
  delete record.files['winmm.dll']
  await platform.writeText((await dataPaths(platform, ROOT)).record, JSON.stringify(record))
  const reopened = createCore(platform)
  await reopened.scan()
  await reopened.selectProfile('balanced')
  expect(reopened.getState().deployment).toMatchObject({ enabled: false, profile: 'balanced' })
  expect(reopened.getState().activity).toMatchObject({ kind: 'deployment', enabled: false })
  expect(await platform.listFiles(`${ROOT}\\game`)).toContain('winmm.dll.disabled')
  expect(await platform.listFiles(`${ROOT}\\game`)).not.toContain('winmm.dll')
})

it('keeps only the remaining choices on the Profile step for a tier without profiles', async () => {
  const platform = createFakePlatform(machine(profileMachine(), graphicsCard('Intel Arc A770', 0x8086)))
  const core = createCore(platform)
  await core.scan()
  expect(setupChoices(core.getState())).toEqual({ profiles: false, reShade: false, startMenu: true, any: true })
  await core.continueSetup()
  expect(core.getState()).toMatchObject({ activity: { kind: 'profile' }, profiles: [], selectedProfile: null })
  await core.review()
  await core.deploy()
  core.finish()
  expect(core.getState().profiles).toEqual([])
})

it('restores earlier config writes when a later profile write fails, keeping the deployment and last-written copy', async () => {
  const manifest = structuredClone(PROFILE_MANIFEST)
  for (const p of manifest.versions[0].tiers['rtx-30-40'].performanceProfiles!) p.settings.push({ file: 'ReShade.ini', section: 'GENERAL', key: 'PerformanceMode', value: p.id === 'performance' ? '1' : '0' })
  const platform = createFakePlatform(machine(profileMachine(), { remoteText: { [MANIFEST_URL]: JSON.stringify(manifest) } }))
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  const before = await readDeployment(platform, ROOT)
  const original = await platform.readText(`${ROOT}\\game\\OptiScaler.ini`)
  const write = platform.writeText.bind(platform)
  let failed = false
  platform.writeText = async (path, text) => {
    if (!failed && path.endsWith('ReShade.ini')) { failed = true; throw new Error('Simulated write failure') }
    await write(path, text)
  }
  await core.selectProfile('performance')
  expect(core.getState().error).toMatch(/Simulated write failure/)
  expect(await platform.readText(`${ROOT}\\game\\OptiScaler.ini`)).toBe(original)
  expect(await readDeployment(platform, ROOT)).toEqual(before)
  expect(core.getState().selectedProfile).toBe('fidelity')
  expect(core.getState().activity.kind).toBe('deployment')
})

it('switches only profile keys, keeps user settings and comments, and saves the last-written profile values', async () => {
  const platform = createFakePlatform(profileMachine())
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  await platform.writeText(`${ROOT}\\game\\OptiScaler.ini`, '; My comment\r\n[DlssNr]\r\n; Neural Rendering passes\r\nPasses = 2\r\nSpatialCompression = false\r\nResidualFG = false\r\n\r\n[Logging]\r\nLogToFile = true\r\n')
  await platform.writeText(`${ROOT}\\game\\ReShade.ini`, '[GENERAL]\nPresetPath=My look.ini\n')
  await core.selectProfile('performance')
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${ROOT}\\game\\OptiScaler.ini`)).toBe('; My comment\r\n[DlssNr]\r\n; Neural Rendering passes\r\nPasses = 1\r\nSpatialCompression = true\r\nResidualFG = true\r\n\r\n[Logging]\r\nLogToFile = true\r\n')
  expect(await platform.readText(`${ROOT}\\game\\ReShade.ini`)).toBe('[GENERAL]\nPresetPath=My look.ini\n')
  const record = (await readDeployment(platform, ROOT))!
  expect(record.profile).toBe('performance')
  // The user's LogToFile change is not reclassified as a value Lucent wrote.
  expect(record.ownedConfigs['OptiScaler.ini']).toBe('; OptiScaler\r\n[DlssNr]\r\n; Neural Rendering passes\r\nPasses = 1\r\nSpatialCompression = true\r\nResidualFG = true\r\n\r\n[Logging]\r\nLogToFile = false\r\n')
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState().selectedProfile).toBe('performance')
})

it('applies the profile after the recipe without saving it into the deployed recipe', () => {
  const content = PROFILE_MANIFEST.versions[0]
  const tier = PROFILE_MANIFEST.tiers.find((t) => t.id === 'rtx-30-40')!
  const plan = planDeployment(content, tier, true, { files: [], cachedFiles: [], ownedFiles: [] }, 'performance')
  const performance = content.tiers[tier.id].performanceProfiles!.find((p) => p.id === 'performance')!
  expect(plan.steps.slice(-performance.settings.length)).toEqual(performance.settings.map((s) => ({ kind: 'ini_set', ...s })))
  expect(plan.recipe.recipe).toEqual(content.tiers[tier.id].recipe)
})

it('preselects the first matching GPU recommendation and exposes all four profiles', async () => {
  const platform = createFakePlatform(fourProfileMachine())
  const core = createCore(platform)
  await core.scan()
  expect(core.getState()).toMatchObject({ selectedProfile: 'ultra', recommendedProfile: 'ultra' })
  await core.continueSetup()
  expect(core.getState().profiles.map(({ id }) => id)).toEqual(['ultra', 'fidelity', 'balanced', 'performance'])
})

it('moves an existing legacy Fidelity deployment to Ultra on its first four-profile content update', async () => {
  const machineState = profileMachine()
  const platform = createFakePlatform(machineState)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  expect(core.getState().deployment?.profile).toBe('fidelity')
  await core.setEnabled(false)
  const config = `${ROOT}\\game\\OptiScaler.ini`
  await platform.writeText(config, (await platform.readText(config))
    .replace('Passes = 2', 'Passes = 3').replace('LogToFile = false', 'LogToFile = true'))

  const target = { ...fourProfileManifest().versions[0], id: '2026.11.02' }
  const update = structuredClone(PROFILE_MANIFEST)
  update.versions = [...PROFILE_MANIFEST.versions, target]
  machineState.remoteText![MANIFEST_URL] = JSON.stringify(update)
  await core.scan()
  await core.applyVersion(target.id)

  expect(core.getState()).toMatchObject({ error: null, deployment: { contentVersion: target.id, profile: 'ultra', enabled: false }, selectedProfile: 'ultra' })
  expect(await platform.readText(config)).toContain('Passes = 3\r\n')
  expect(await platform.readText(config)).toContain('LogToFile = true\r\n')
  expect(await platform.listFiles(`${ROOT}\\game`)).toContain('winmm.dll.disabled')
  expect(core.getState().customProfile).toMatchObject({ basedOn: 'ultra', changed: [{ key: 'Passes', value: '3' }] })
})

it.each([[1080, '2'], [1440, '1'], [2160, '1']] as const)(
  'plans Balanced upscaling at output height %s using its matching column', (outputHeight, value) => {
    const manifest = fourProfileManifest()
    const content = manifest.versions[0]
    const tier = manifest.tiers.find((item) => item.id === 'rtx-30-40')!
    const plan = planDeployment(content, tier, false, { files: [], cachedFiles: [], ownedFiles: [] }, 'balanced', true, { outputHeight })
    expect(plan.steps).toContainEqual({ kind: 'ini_set', file: 'OptiScaler.ini', section: 'QualityOverrides', key: 'ForcePerfQuality', value })
  },
)

it('rewrites mapped profile values on resolution changes but keeps player edits Custom across later changes', async () => {
  const machineState = screenProfileMachine(1080)
  const platform = createFakePlatform(machineState)
  const core = createCore(platform)
  await core.scan()
  await core.continueSetup()
  await core.selectProfile('balanced')
  await core.review()
  await core.deploy()
  core.finish()
  const config = `${ROOT}\\game\\OptiScaler.ini`
  expect(await platform.readText(config)).toMatch(/ForcePerfQuality\s*=\s*2/)

  machineState.monitors = [profileMonitor(1440)]
  const at1440 = createCore(platform)
  await at1440.scan()
  expect(await platform.readText(config)).toMatch(/ForcePerfQuality\s*=\s*1/)
  expect(at1440.getState().customProfile).toBeNull()

  await platform.writeText(config, (await platform.readText(config)).replace(/ForcePerfQuality\s*=\s*1/, 'ForcePerfQuality = 0'))
  machineState.monitors = [profileMonitor(2160)]
  const at4k = createCore(platform)
  await at4k.scan()
  expect(await platform.readText(config)).toMatch(/ForcePerfQuality\s*=\s*0/)
  expect(at4k.getState().customProfile).toMatchObject({ basedOn: 'balanced', changed: [{ key: 'ForcePerfQuality', value: '0' }] })
})

it('keeps unrelated user config changes through a profile switch, and they are not drift', async () => {
  const platform = createFakePlatform(profileMachine())
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  const config = `${ROOT}\\game\\OptiScaler.ini`
  await platform.writeText(config, (await platform.readText(config)).replace('LogToFile = false', 'LogToFile = true'))
  await core.selectProfile('performance')
  expect(core.getState().error).toBeNull()
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState().activity).toMatchObject({ kind: 'deployment', drift: null })
  expect(await platform.readText(config)).toContain('LogToFile = true')
})

it('returns to Healthy when a profile switch overwrites the only keys the user changed', async () => {
  const platform = createFakePlatform(profileMachine())
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  const config = `${ROOT}\\game\\OptiScaler.ini`
  await platform.writeText(config, (await platform.readText(config)).replace('Passes = 2', 'Passes = 1'))
  await core.selectProfile('balanced')
  await core.selectProfile('fidelity')
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState().activity).toMatchObject({ kind: 'deployment', drift: null })
})
