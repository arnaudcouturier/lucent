import { expect, it } from 'vitest'
import { createCore } from './core'
import { dataPaths, readDeployment } from './deployment'
import { runHeadless } from './autoRepair'
import { DEFAULT_ENV, createFakePlatform, type FakePlatform } from '../platform/fake'
import { firstInstallContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import type { MonitorInfo } from './platform'
import { statusCard } from './statusCard'
import type { FrameGenerationId, HdrMode } from '../shared/manifest'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`
const CONFIG = `${GAME}\\OptiScaler.ini`
const CFG = `${DEFAULT_ENV.Documents}\\My Games\\FINAL FANTASY XIV - A Realm Reborn\\FFXIV.cfg`
const monitor = (refreshHz: number): MonitorInfo => ({
  deviceName: '\\\\.\\DISPLAY1', bounds: { left: 0, top: 0, right: 3840, bottom: 2160 }, primary: true,
  refreshHz, width: 3840, height: 2160, hdrSupported: true, hdrOn: false, peakNits: 1000,
})
const cfg = (refreshHz: number) => `<Display Settings>\r\nMainAdapter\r\nScreenLeft 100\r\nScreenTop 100\r\nScreenMode 1\r\nFullScreenWidth 3840\r\nFullScreenHeight 2160\r\nRefreshrate ${refreshHz}\r\n`

/** Content with frame generation, HDR, four profiles and a frame cap, deployed on a 240 Hz HDR screen. */
async function deployed() {
  const m = machine(firstInstallContentHost(), { monitors: [monitor(240)], files: { [CFG]: cfg(240) } }, graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  expect(core.getState().error).toBeNull()
  return { m, platform, core }
}

async function reopen(platform: FakePlatform) {
  const core = createCore(platform)
  await core.scan()
  return core
}

/** The first-install choices the player made, as the deployment record stored them. */
async function storeChoices(platform: FakePlatform, choices: { frameGenerationMode: FrameGenerationId; hdrMode: HdrMode }) {
  const record = (await readDeployment(platform, ROOT))!
  Object.assign(record, choices)
  await platform.writeText((await dataPaths(platform, ROOT)).record, JSON.stringify(record))
}

it('puts back a deleted OptiScaler.ini from the baseline and the stored choices, with the frame cap of the screen now', async () => {
  const { m, platform } = await deployed()
  await storeChoices(platform, { frameGenerationMode: '4x', hdrMode: 'scene-hdr' })
  // The player has since moved to a 144 Hz screen.
  m.monitors = [monitor(144)]
  await platform.writeText(CFG, cfg(144))
  await platform.removeFile(CONFIG)

  const core = await reopen(platform)
  expect(statusCard(core.getState())).toMatchObject({ kind: 'drift', files: 1 })
  await core.repair()
  expect(core.getState().error).toBeNull()
  const text = await platform.readText(CONFIG)
  expect(text).toMatch(/FrameGeneration[\s\S]*Mode\s*=\s*4x/)
  expect(text).toMatch(/\[HDR\][\s\S]*FfxivHDR\s*=\s*true[\s\S]*Mode\s*=\s*1/)
  expect(text).toContain('FramerateLimit=138.000000')
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'healthy' })
})

it('puts back a deleted ReShade.ini from the cache, and a config that can’t be read as text', async () => {
  const { platform } = await deployed()
  await platform.removeFile(`${GAME}\\ReShade.ini`)
  await platform.writeText(CONFIG, 'binary\0garbage')

  const core = await reopen(platform)
  expect(statusCard(core.getState())).toMatchObject({ kind: 'drift', files: 2 })
  await core.repair()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe('[GENERAL]\nPresetPath=\n')
  expect(await platform.readText(CONFIG)).not.toContain('\0')
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'healthy' })
})

it('leaves a tuned config alone while it puts back a patched file', async () => {
  const { platform } = await deployed()
  const tuned = (await platform.readText(CONFIG)).replace('Passes = 2', 'Passes = 9')
  await platform.writeText(CONFIG, tuned)
  await platform.writeText(`${GAME}\\ReShade.ini`, '[GENERAL]\nPresetPath=reshade-presets/Mine.ini\n')
  await platform.writeText(`${GAME}\\winmm.dll`, 'Patched by the game')

  const core = await reopen(platform)
  expect(statusCard(core.getState())).toMatchObject({ kind: 'drift', files: 1 })
  const journalLength = (await readDeployment(platform, ROOT))!.journal.length
  await core.repair()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('OptiScaler')
  expect(await platform.readText(CONFIG)).toBe(tuned)
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe('[GENERAL]\nPresetPath=reshade-presets/Mine.ini\n')
  // Only the patched file went through the journal.
  expect((await readDeployment(platform, ROOT))!.journal).toHaveLength(journalLength + 1)
})

it('XIVLauncher’s repair on close follows the same rule', async () => {
  const { platform } = await deployed()
  const tuned = (await platform.readText(CONFIG)).replace('Passes = 2', 'Passes = 9')
  await platform.writeText(CONFIG, tuned)
  await platform.writeText(`${GAME}\\winmm.dll`, 'Patched by the game')
  await platform.removeFile(`${GAME}\\ReShade.ini`)

  expect(await runHeadless(platform, 'repair')).toEqual({ kind: 'repaired' })
  expect(await platform.readText(CONFIG)).toBe(tuned)
  expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('OptiScaler')
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe('[GENERAL]\nPresetPath=\n')

  await platform.removeFile(CONFIG)
  expect(await runHeadless(platform, 'repair')).toEqual({ kind: 'repaired' })
  expect(await platform.readText(CONFIG)).toContain('Passes = 2')
})

it('the health check only needs a config to exist and be readable', async () => {
  const { platform } = await deployed()
  await platform.writeText(CONFIG, '; nothing of Lucent’s left in here\n')
  const core = await reopen(platform)
  expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
})
