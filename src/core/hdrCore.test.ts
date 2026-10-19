import { expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform, type Machine } from '../platform/fake'
import { FRAME_GENERATION_MANIFEST, PROFILE_ASSETS, fixtureUrl } from '../platform/contentFixture'
import { graphicsCard, MACHINES, machine } from '../platform/fixtures'
import { MANIFEST_URL } from './manifest'
import { dataPaths, readDeployment } from './deployment'
import type { ContentVersion, HdrOption, IniSetting, Manifest } from '../shared/manifest'

const ROOT = 'D:\\SteamLibrary\\steamapps\\common\\FINAL FANTASY XIV Online'
const GAME = `${ROOT}\\game`
const EXE = `${GAME}\\ffxiv_dx11.exe`
const TEST_SID = 'S-1-5-21-101-202-303-1004'
const GPU_PREFERENCES = `HKU\\${TEST_SID}\\Software\\Microsoft\\DirectX\\UserGpuPreferences`
const XIV_CONFIG = 'C:\\Users\\Player\\Documents\\My Games\\FINAL FANTASY XIV - A Realm Reborn\\FFXIV.cfg'

const setting = (section: string, key: string, value: string): IniSetting => ({ file: 'OptiScaler.ini', section, key, value })

const hdrOptions: HdrOption[] = [
  { id: 'off', settings: [setting('HDR', 'FfxivHDR', 'false'), setting('HDR', 'Mode', '0')] },
  { id: 'hdr', settings: [setting('HDR', 'FfxivHDR', 'true'), setting('HDR', 'Mode', '0')] },
  { id: 'scene-hdr', experimental: true, settings: [setting('HDR', 'FfxivHDR', 'true'), setting('HDR', 'Mode', '1')] },
]

const HDR_MANIFEST: Manifest = {
  ...FRAME_GENERATION_MANIFEST,
  versions: FRAME_GENERATION_MANIFEST.versions.map((content) => ({
    ...content,
    tiers: Object.fromEntries(Object.entries(content.tiers).map(([id, recipe]) => [id, id === 'rtx-20-30-40' ? {
      ...recipe,
      hdrOptions,
      screenDerivedSettings: [
        { file: 'OptiScaler.ini', section: 'HDR', key: 'PeakNits', value: 'peakNits' },
        { file: 'OptiScaler.ini', section: 'FrameRate', key: 'FrameRateLimit', value: 'frameCap' },
      ],
      frameGenerationOptions: recipe.frameGenerationOptions?.map((option) => option.id === '2x' ? {
        ...option,
        settings: [setting('FrameGeneration', 'Mode', 'fsr2')],
        hdrSettings: [setting('FrameGeneration', 'Mode', 'xeFG2')],
      } : option),
    } : recipe])),
  })),
}

function hdrMachine(screen: Machine = MACHINES.screen144Hdr, extra: Machine = {}, gpuName = 'NVIDIA GeForce RTX 4080') {
  const host = {
    remoteText: {
      ...Object.fromEntries(Object.entries(PROFILE_ASSETS).map(([hash, content]) => [fixtureUrl(hash), content])),
      [MANIFEST_URL]: JSON.stringify(HDR_MANIFEST),
    },
  }
  return machine(screen, host, graphicsCard(gpuName), { userSid: TEST_SID }, extra)
}

async function deployed(screen: Machine = MACHINES.screen144Hdr, extra: Machine = {}, gpuName?: string) {
  const m = hdrMachine(screen, extra, gpuName)
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  expect(core.getState().error).toBeNull()
  return { core, platform, m }
}

async function reopen(platform: FakePlatform) {
  const core = createCore(platform)
  await core.scan()
  return core
}

async function config(platform: FakePlatform) {
  return platform.readText(`${GAME}\\OptiScaler.ini`)
}

async function gpuPreferences(platform: FakePlatform) {
  return platform.readUserGpuPreferences(TEST_SID, EXE)
}

/** A deployment that turned Windows Auto HDR off for XIV, as its journal records it; the registry holds the disabled value. */
async function journalAutoHdrOff(platform: FakePlatform, before: string, after: string) {
  const record = (await readDeployment(platform, ROOT))!
  record.journal.push({ registry: { kind: 'user-gpu-preferences', userSid: TEST_SID, name: EXE, before, after }, before: {}, after: {} })
  await platform.writeText((await dataPaths(platform, ROOT)).record, JSON.stringify(record))
  await platform.writeUserGpuPreferences(TEST_SID, EXE, after)
}

function publishNextContent(m: Machine) {
  const current = HDR_MANIFEST.versions[0]
  const newer: ContentVersion = { ...current, id: '2026.10.20', changelog: ['Inert HDR content update.'] }
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...HDR_MANIFEST, versions: [current, newer] })
}

it('deploys HDR Off on an SDR monitor, with the frame cap and peak brightness it reports', async () => {
  const { platform } = await deployed(MACHINES.screen60Sdr)

  expect(await config(platform)).toMatch(/FfxivHDR\s*=\s*false/i)
  expect(await config(platform)).toMatch(/PeakNits\s*=\s*1100/i)
  expect(await config(platform)).toMatch(/FrameRateLimit\s*=\s*59\.000000/i)
})

it('deploys XeFG frame generation when the HDR choice is on', async () => {
  const { platform: hdr } = await deployed()
  expect(await config(hdr)).toMatch(/FrameGeneration\]\r?\nMode\s*=\s*xeFG2/i)

  const [monitor] = MACHINES.screen144Hdr.monitors!
  const { platform: sdr } = await deployed({ ...MACHINES.screen144Hdr, monitors: [{ ...monitor, hdrOn: false }] })
  expect(await config(sdr)).toMatch(/FrameGeneration\]\r?\nMode\s*=\s*xeFG2/i)
})

it('uses the chosen HDR provider on RTX 30 when Windows HDR is off', async () => {
  const monitor = MACHINES.screen144Hdr.monitors![0]
  const { platform } = await deployed({ ...MACHINES.screen144Hdr, monitors: [{ ...monitor, hdrOn: false }] }, {}, 'NVIDIA GeForce RTX 3080')

  expect(await config(platform)).toMatch(/FfxivHDR\s*=\s*true/i)
  expect(await config(platform)).toMatch(/FrameGeneration\]\r?\nMode\s*=\s*xeFG2/i)
})

it('keeps a player’s HDR Off through a content update', async () => {
  const { platform, m } = await deployed()
  const off = (text: string) => text.replace(/FfxivHDR\s*=\s*true/i, 'FfxivHDR=false').replace(/Mode\s*=\s*xeFG2/i, 'Mode=fsr2')
  await platform.writeText(`${GAME}\\OptiScaler.ini`, off(await config(platform)))

  publishNextContent(m)
  const update = await reopen(platform)
  await update.update()

  expect(update.getState()).toMatchObject({ error: null, deployment: { contentVersion: '2026.10.20' } })
  expect(await config(platform)).toMatch(/FfxivHDR\s*=\s*false/i)
  expect(await config(platform)).toMatch(/FrameGeneration\]\r?\nMode\s*=\s*fsr2/i)
})

it('keeps an unmatched, unlit on-disk HDR combination through an update', async () => {
  const { platform, m } = await deployed()
  const before = await config(platform)
  await platform.writeText(`${GAME}\\OptiScaler.ini`, before.replace(/FfxivHDR=true/i, 'FfxivHDR=false').replace(/Mode=0/i, 'Mode=77'))

  publishNextContent(m)
  const custom = await reopen(platform)
  expect(custom.getState().error).toBeNull()
  expect(await config(platform)).toMatch(/FfxivHDR=false/i)
  expect(await config(platform)).toMatch(/Mode=77/i)

  await custom.update()

  expect(custom.getState()).toMatchObject({ error: null, deployment: { contentVersion: '2026.10.20', frameGenerationMode: '2x' } })
  expect(await config(platform)).toMatch(/FfxivHDR=false/i)
  expect(await config(platform)).toMatch(/Mode=77/i)
})

it('turns the per-game Auto HDR off when it deploys, then leaves it alone when it reopens and launches', async () => {
  const original = 'GpuPreference=2;AutoHDREnable=1;'
  const disabled = 'GpuPreference=2;AutoHDREnable=0;'
  const { core, platform } = await deployed(MACHINES.screen144Hdr, { registry: { [GPU_PREFERENCES]: { [EXE]: original } } })
  expect(await gpuPreferences(platform)).toBe(disabled)

  await core.launchGame()
  const reopened = await reopen(platform)
  await reopened.launchGame()

  expect(reopened.getState().error).toBeNull()
  expect(await gpuPreferences(platform)).toBe(disabled)
})

it('restores the per-game Auto HDR value on deployment uninstall', async () => {
  const original = 'GpuPreference=2;AutoHDREnable=1;'
  const { platform } = await deployed(MACHINES.screen144Hdr, { registry: { [GPU_PREFERENCES]: { [EXE]: original } } })
  await journalAutoHdrOff(platform, original, 'GpuPreference=2;AutoHDREnable=0;')
  const reopened = await reopen(platform)

  await reopened.uninstall()

  expect(reopened.getState()).toMatchObject({ error: null, deployment: null, activity: { kind: 'scan' } })
  expect(await gpuPreferences(platform)).toBe(original)
})

it('Reset follows the new HDR choice and restores Auto HDR when Off is selected', async () => {
  const original = 'GpuPreference=2;AutoHDREnable=1;'
  const { core, platform } = await deployed(MACHINES.screen144Hdr, { registry: { [GPU_PREFERENCES]: { [EXE]: original } } })
  await core.resetSetup()
  core.selectHdrMode('off')
  await core.review()
  await core.deploy()

  expect(core.getState()).toMatchObject({ error: null, deployment: { hdrMode: 'off' } })
  expect(await config(platform)).toMatch(/FfxivHDR\s*=\s*false/i)
  expect(await gpuPreferences(platform)).toBe(original)
})

it('rolls Auto HDR back with the files when Reset Off fails partway through', async () => {
  const original = 'GpuPreference=2;AutoHDREnable=1;'
  const disabled = 'GpuPreference=2;AutoHDREnable=0;'
  const { core, platform } = await deployed(MACHINES.screen144Hdr, { registry: { [GPU_PREFERENCES]: { [EXE]: original } } })
  expect(await gpuPreferences(platform)).toBe(disabled)

  let gameMutations = 0
  const originalCopyFile = platform.copyFile.bind(platform)
  platform.copyFile = async (from, to, replace, stagingDirectory) => {
    if (to.toLowerCase().startsWith(`${GAME.toLowerCase()}\\`)) {
      gameMutations++
      if (gameMutations === 2) throw new Error('injected Reset failure')
    }
    await originalCopyFile(from, to, replace, stagingDirectory)
  }
  const originalWriteText = platform.writeText.bind(platform)
  platform.writeText = async (path, text, stagingDirectory) => {
    if (path.toLowerCase().startsWith(`${GAME.toLowerCase()}\\`)) {
      gameMutations++
      if (gameMutations === 2) throw new Error('injected Reset failure')
    }
    await originalWriteText(path, text, stagingDirectory)
  }

  await core.resetSetup()
  core.selectHdrMode('off')
  await core.review()
  await core.deploy()

  expect(gameMutations).toBeGreaterThanOrEqual(2)
  expect(core.getState().error).toMatch(/injected Reset failure/i)
  expect(await gpuPreferences(platform)).toBe(disabled)
})

it('Reset recomputes screen-derived values from the current monitor', async () => {
  const { core, platform, m } = await deployed()
  const monitor = m.monitors![0]
  m.monitors![0] = { ...monitor, refreshHz: 60, peakNits: 700 }
  await platform.writeText(XIV_CONFIG, (await platform.readText(XIV_CONFIG)).replace(/Refreshrate 144/i, 'Refreshrate 60'))

  await core.resetSetup()
  await core.review()
  await core.deploy()

  expect(core.getState().error).toBeNull()
  expect(await config(platform)).toMatch(/PeakNits\s*=\s*700/i)
  expect(await config(platform)).toMatch(/FrameRateLimit\s*=\s*59\.000000/i)
})

it('restores Auto HDR when Lucent is uninstalled from Settings → Apps and the deployment is kept', async () => {
  const original = 'GpuPreference=2;AutoHDREnable=1;'
  const { platform, m } = await deployed(MACHINES.screen144Hdr, { registry: { [GPU_PREFERENCES]: { [EXE]: original } } })
  await journalAutoHdrOff(platform, original, 'GpuPreference=2;AutoHDREnable=0;')
  m.exePath = 'C:\\Users\\Player\\AppData\\Local\\Lucent\\Lucent.exe'
  m.headlessMode = 'uninstall'
  const appUninstall = createCore(platform)
  await appUninstall.openAppUninstall()

  await appUninstall.uninstallApp(false)

  expect(appUninstall.getState()).toMatchObject({ error: null, appUninstalled: true })
  expect(await gpuPreferences(platform)).toBe(original)
  expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('OptiScaler')
})

it('leaves a per-game Auto HDR value the player changed since alone when Lucent is uninstalled from Settings → Apps', async () => {
  const original = 'GpuPreference=2;AutoHDREnable=1;'
  const { platform, m } = await deployed(MACHINES.screen144Hdr, { registry: { [GPU_PREFERENCES]: { [EXE]: original } } })
  await journalAutoHdrOff(platform, original, 'GpuPreference=2;AutoHDREnable=0;')
  await platform.writeUserGpuPreferences(TEST_SID, EXE, 'GpuPreference=2;AutoHDREnable=1;NewFlag=7;')
  m.exePath = 'C:\\Users\\Player\\AppData\\Local\\Lucent\\Lucent.exe'
  m.headlessMode = 'uninstall'
  const appUninstall = createCore(platform)
  await appUninstall.openAppUninstall()

  await appUninstall.uninstallApp(false)

  expect(appUninstall.getState()).toMatchObject({ error: null, appUninstalled: true })
  expect(await gpuPreferences(platform)).toBe('GpuPreference=2;AutoHDREnable=1;NewFlag=7;')
})

it('does not rewrite the HDR keys when Windows HDR or the refresh rate changes later', async () => {
  const { platform, m } = await deployed()
  const deployedConfig = await config(platform)
  m.monitors![0] = { ...m.monitors![0], hdrOn: false, refreshHz: 120, peakNits: 800 }
  await platform.writeText(XIV_CONFIG, (await platform.readText(XIV_CONFIG)).replace(/Refreshrate 144/i, 'Refreshrate 120'))

  const reopened = await reopen(platform)
  await reopened.launchGame()

  expect(reopened.getState()).toMatchObject({ error: null, activity: { kind: 'deployment', drift: null } })
  expect(await config(platform)).toBe(deployedConfig)
})
