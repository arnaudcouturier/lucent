import { expect, it } from 'vitest'
import { createCore, setupChoices } from './core'
import { DEFAULT_ENV, createFakePlatform } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
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

it('offers profiles between Scan and Review and deploys the selected values', async () => {
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
  core.finish()
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState().selectedProfile).toBe('performance')
  expect(reopened.getState().activity).toMatchObject({ kind: 'deployment', drift: null })
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
  await core.continueSetup()
  await core.selectProfile('balanced')
  await core.review(false)
  await core.deploy()
  core.finish()
  expect(core.getState().error).toBeNull()
  expect(core.getState().deployment?.profile).toBe('balanced')
  expect(await platform.readText(`${ROOT}\\game\\OptiScaler.ini`)).toContain('Passes = 1\r\n')
  expect(await platform.listFiles(`${ROOT}\\game`)).not.toContain('reshade.ini')
})

it('keeps only the remaining choices on the Profile step for a tier without profiles', async () => {
  const platform = createFakePlatform(machine(profileMachine(), graphicsCard('Intel Arc A770', 0x8086)))
  const core = createCore(platform)
  await core.scan()
  expect(setupChoices(core.getState())).toEqual({ profiles: false, frameGeneration: false, hdr: false, reShade: false, startMenu: true, any: true })
  await core.continueSetup()
  expect(core.getState()).toMatchObject({ activity: { kind: 'profile' }, profiles: [], selectedProfile: null })
  await core.review()
  await core.deploy()
  core.finish()
  expect(core.getState().profiles).toEqual([])
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

it('plans the profile for the monitor XIV runs on, and never follows a later monitor change', async () => {
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
  const deployed = await platform.readText(config)
  expect(deployed).toMatch(/ForcePerfQuality\s*=\s*2/)

  machineState.monitors = [profileMonitor(2160)]
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState()).toMatchObject({ error: null, activity: { kind: 'deployment', drift: null } })
  expect(await platform.readText(config)).toBe(deployed)
})

it('keeps the deployed profile: there is no command to change it afterwards', async () => {
  const platform = createFakePlatform(profileMachine())
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  const config = `${ROOT}\\game\\OptiScaler.ini`
  const before = await platform.readText(config)
  await core.selectProfile('performance')
  expect(core.getState()).toMatchObject({ error: null, selectedProfile: 'fidelity', deployment: { profile: 'fidelity' } })
  expect(await platform.readText(config)).toBe(before)
})
