import { expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform, type Machine } from '../platform/fake'
import { FRAME_GENERATION_MANIFEST, PROFILE_ASSETS, fixtureUrl } from '../platform/contentFixture'
import { graphicsCard, MACHINES, machine } from '../platform/fixtures'
import { MANIFEST_URL } from './manifest'
import type { ContentVersion, HdrOption, IniSetting, Manifest } from '../shared/manifest'

const ROOT = 'D:\\SteamLibrary\\steamapps\\common\\FINAL FANTASY XIV Online'
const GAME = `${ROOT}\\game`
const EXE = `${GAME}\\ffxiv_dx11.exe`
const TEST_SID = 'S-1-5-21-101-202-303-1004'
const GPU_PREFERENCES = `HKU\\${TEST_SID}\\Software\\Microsoft\\DirectX\\UserGpuPreferences`

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
    tiers: Object.fromEntries(Object.entries(content.tiers).map(([id, recipe]) => [id, id === 'rtx-30-40' ? {
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

function hdrMachine(screen: Machine = MACHINES.screen144Hdr, extra: Machine = {}) {
  const host = {
    remoteText: {
      ...Object.fromEntries(Object.entries(PROFILE_ASSETS).map(([hash, content]) => [fixtureUrl(hash), content])),
      [MANIFEST_URL]: JSON.stringify(HDR_MANIFEST),
    },
  }
  return machine(screen, host, graphicsCard('NVIDIA GeForce RTX 4080'), { userSid: TEST_SID }, extra)
}

async function deployed(screen: Machine = MACHINES.screen144Hdr, extra: Machine = {}) {
  const m = hdrMachine(screen, extra)
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

async function selectOffState() {
  const { core, platform } = await deployed()
  await core.selectHdrMode('off')
  expect(core.getState()).toMatchObject({ error: null, hdrMode: 'off', hdrActive: false })
  return { core, platform, beforeIni: await config(platform) }
}

function failFinalRegistryRecordSave(platform: FakePlatform) {
  const writeText = platform.writeText.bind(platform)
  let failed = false
  platform.writeText = async (path, text) => {
    if (!failed && path.toLowerCase().endsWith('\\record.json')) {
      const record = JSON.parse(text)
      if (record.status === 'complete' && record.journal.some((entry: { registry?: unknown }) => entry.registry)) {
        failed = true
        throw new Error('Simulated final deployment record save failure.')
      }
    }
    await writeText(path, text)
  }
  return () => failed
}

function publishNextContent(m: Machine) {
  const current = HDR_MANIFEST.versions[0]
  const newer: ContentVersion = { ...current, id: '2026.10.20', changelog: ['Inert HDR content update.'] }
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...HDR_MANIFEST, versions: [current, newer] })
}

it('starts in HDR by default even when the HDR control is hidden on an SDR monitor', async () => {
  const { core, platform } = await deployed(MACHINES.screen60Sdr)

  expect(core.getState()).toMatchObject({ hdrMode: 'hdr', hdrActive: true, screen: { hdrSupported: false, hdrOn: false } })
  expect(await config(platform)).toMatch(/FfxivHDR\s*=\s*true/i)
  expect(await config(platform)).toMatch(/PeakNits\s*=\s*1100/i)
  expect(await config(platform)).toMatch(/FrameRateLimit\s*=\s*59\.000000/i)
})

it('keeps an explicit Off selection through a content update', async () => {
  const { core, platform, m } = await deployed()
  await core.selectHdrMode('off')
  expect(core.getState()).toMatchObject({ error: null, hdrMode: 'off', hdrActive: false })
  expect(await config(platform)).toMatch(/FfxivHDR\s*=\s*false/i)
  expect(await config(platform)).toMatch(/FrameGeneration\]\r?\nMode\s*=\s*fsr2/i)

  publishNextContent(m)
  const update = await reopen(platform)
  await update.update()

  expect(update.getState()).toMatchObject({ error: null, hdrMode: 'off', hdrActive: false, frameGenerationMode: '2x' })
  expect(update.getState().deployment?.contentVersion).toBe('2026.10.20')
  expect(await config(platform)).toMatch(/FfxivHDR\s*=\s*false/i)
  expect(await config(platform)).toMatch(/FrameGeneration\]\r?\nMode\s*=\s*fsr2/i)
})

it('reads an unmatched, unlit on-disk HDR combination as Custom and preserves it through an update', async () => {
  const { platform, m } = await deployed()
  const before = await config(platform)
  await platform.writeText(`${GAME}\\OptiScaler.ini`, before.replace(/FfxivHDR=true/i, 'FfxivHDR=false').replace(/Mode=0/i, 'Mode=77'))

  const custom = await reopen(platform)
  expect(custom.getState()).toMatchObject({ error: null, hdrMode: null, hdrActive: false })
  expect(await config(platform)).toMatch(/FfxivHDR=false/i)
  expect(await config(platform)).toMatch(/Mode=77/i)

  publishNextContent(m)
  await custom.update()

  expect(custom.getState()).toMatchObject({ error: null, hdrMode: null, hdrActive: false, frameGenerationMode: '2x' })
  expect(await config(platform)).toMatch(/FfxivHDR=false/i)
  expect(await config(platform)).toMatch(/Mode=77/i)
})

it('switches FSR frame generation to XeFG as Windows HDR changes across Launch and reopen', async () => {
  const { core, platform, m } = await deployed()
  const originalProfile = core.getState().selectedProfile
  expect(core.getState()).toMatchObject({ hdrMode: 'hdr', hdrActive: true, frameGenerationMode: '2x' })
  expect(await config(platform)).toMatch(/FrameGeneration\]\r?\nMode\s*=\s*xeFG2/i)

  m.monitors![0] = { ...m.monitors![0], hdrOn: false, refreshHz: 120, peakNits: 800 }
  const xivConfig = 'C:\\Users\\Player\\Documents\\My Games\\FINAL FANTASY XIV - A Realm Reborn\\FFXIV.cfg'
  await platform.writeText(xivConfig, (await platform.readText(xivConfig)).replace(/Refreshrate 144/i, 'Refreshrate 120'))
  await core.launchGame()
  expect(core.getState()).toMatchObject({ error: null, hdrMode: 'hdr', hdrActive: true, frameGenerationMode: '2x', selectedProfile: originalProfile })
  expect(await config(platform)).toMatch(/FrameGeneration\]\r?\nMode\s*=\s*fsr2/i)
  expect(await config(platform)).toMatch(/PeakNits\s*=\s*800/i)
  expect(await config(platform)).toMatch(/FrameRateLimit\s*=\s*116\.000000/i)

  const reopened = await reopen(platform)
  expect(reopened.getState()).toMatchObject({ error: null, hdrMode: 'hdr', hdrActive: true, frameGenerationMode: '2x', selectedProfile: originalProfile })
  m.monitors![0] = { ...m.monitors![0], hdrOn: true }
  await reopened.launchGame()

  expect(reopened.getState()).toMatchObject({ error: null, hdrMode: 'hdr', hdrActive: true, frameGenerationMode: '2x', selectedProfile: originalProfile })
  expect(await config(platform)).toMatch(/FrameGeneration\]\r?\nMode\s*=\s*xeFG2/i)
})

it('turns off only per-game Auto HDR, preserves GPU preference, and restores the exact value on Off', async () => {
  const original = 'GpuPreference=2;AutoHDREnable=1;'
  const { core, platform } = await deployed(MACHINES.screen144Hdr, {
    registry: { [GPU_PREFERENCES]: { [EXE]: original } },
  })

  expect(await gpuPreferences(platform)).toBe('GpuPreference=2;AutoHDREnable=0;')
  await core.selectHdrMode('off')

  expect(core.getState()).toMatchObject({ error: null, hdrMode: 'off', hdrActive: false })
  expect(await gpuPreferences(platform)).toBe(original)
})

it('removes Lucent’s Auto HDR value on Off when no per-game value existed before', async () => {
  const { core, platform } = await deployed()

  expect(await gpuPreferences(platform)).toBe('AutoHDREnable=2096;')
  await core.selectHdrMode('off')

  expect(await gpuPreferences(platform)).toBeNull()
})

it('restores Auto HDR while Disabled and applies it again when re-enabled', async () => {
  const original = 'GpuPreference=2;AutoHDREnable=1;'
  const { core, platform } = await deployed(MACHINES.screen144Hdr, {
    registry: { [GPU_PREFERENCES]: { [EXE]: original } },
  })

  await core.setEnabled(false)
  expect(core.getState()).toMatchObject({ error: null, deployment: { enabled: false } })
  expect(await gpuPreferences(platform)).toBe(original)

  await core.setEnabled(true)
  expect(core.getState()).toMatchObject({ error: null, deployment: { enabled: true } })
  expect(await gpuPreferences(platform)).toBe('GpuPreference=2;AutoHDREnable=0;')
})

it('leaves an external Auto HDR change alone after Off and reopen', async () => {
  const { core, platform } = await deployed()
  await core.selectHdrMode('off')
  await platform.writeUserGpuPreferences(TEST_SID, EXE, 'AutoHDREnable=2096;')

  const reopened = await reopen(platform)

  expect(reopened.getState()).toMatchObject({ error: null, hdrMode: 'off', hdrActive: false })
  expect(await gpuPreferences(platform)).toBe('AutoHDREnable=2096;')
})

it('restores the per-game Auto HDR value on deployment uninstall', async () => {
  const original = 'GpuPreference=2;AutoHDREnable=1;'
  const { core, platform } = await deployed(MACHINES.screen144Hdr, {
    registry: { [GPU_PREFERENCES]: { [EXE]: original } },
  })
  expect(await gpuPreferences(platform)).toBe('GpuPreference=2;AutoHDREnable=0;')

  await core.uninstall()

  expect(core.getState()).toMatchObject({ error: null, deployment: null, activity: { kind: 'scan' } })
  expect(await gpuPreferences(platform)).toBe(original)
})

it('restores Auto HDR when Lucent is uninstalled from Settings → Apps and the deployment is kept', async () => {
  const original = 'GpuPreference=2;AutoHDREnable=1;'
  const { platform, m } = await deployed(MACHINES.screen144Hdr, {
    registry: { [GPU_PREFERENCES]: { [EXE]: original } },
  })
  m.exePath = 'C:\\Users\\Player\\AppData\\Local\\Lucent\\Lucent.exe'
  m.headlessMode = 'uninstall'
  const appUninstall = createCore(platform)
  await appUninstall.openAppUninstall()

  await appUninstall.uninstallApp(false)

  expect(appUninstall.getState()).toMatchObject({ error: null, appUninstalled: true })
  expect(await gpuPreferences(platform)).toBe(original)
  expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('OptiScaler')
})

it('rolls back HDR config, frame-generation variant and registry if the registry write fails after the INI write', async () => {
  const { core, platform, beforeIni } = await selectOffState()
  const writePreferences = platform.writeUserGpuPreferences.bind(platform)
  platform.writeUserGpuPreferences = async () => { throw new Error('Simulated registry write failure.') }

  await core.selectHdrMode('hdr')

  expect(core.getState()).toMatchObject({ recoveryRequired: false, hdrMode: 'off', hdrActive: false })
  expect(core.getState().error).toMatch(/Simulated registry write failure/)
  expect(await config(platform)).toBe(beforeIni)
  expect(await gpuPreferences(platform)).toBeNull()
  platform.writeUserGpuPreferences = writePreferences
})

it('rolls back HDR config, frame-generation variant and registry after the final record save fails', async () => {
  const { core, platform, beforeIni } = await selectOffState()
  const failedFinalSave = failFinalRegistryRecordSave(platform)

  await core.selectHdrMode('hdr')

  expect(failedFinalSave()).toBe(true)
  expect(core.getState()).toMatchObject({ recoveryRequired: false, hdrMode: 'off', hdrActive: false })
  expect(core.getState().error).toMatch(/Simulated final deployment record save failure/)
  expect(await config(platform)).toBe(beforeIni)
  expect(await gpuPreferences(platform)).toBeNull()
})

it('recovers the whole HDR change on the next Scan when its first undo attempt fails', async () => {
  const { core, platform, beforeIni } = await selectOffState()
  const failedFinalSave = failFinalRegistryRecordSave(platform)
  const writePreferences = platform.writeUserGpuPreferences.bind(platform)
  let preferenceWrites = 0
  platform.writeUserGpuPreferences = async (userSid, executablePath, value) => {
    preferenceWrites++
    if (preferenceWrites === 2) throw new Error('Simulated registry restore failure.')
    await writePreferences(userSid, executablePath, value)
  }

  await core.selectHdrMode('hdr')

  expect(failedFinalSave()).toBe(true)
  expect(preferenceWrites).toBe(2)
  expect(core.getState().recoveryRequired).toBe(true)
  platform.writeUserGpuPreferences = writePreferences
  const recovered = await reopen(platform)

  expect(recovered.getState()).toMatchObject({ error: null, recoveryRequired: false, hdrMode: 'off', hdrActive: false })
  expect(await config(platform)).toBe(beforeIni)
  expect(await gpuPreferences(platform)).toBeNull()
})
