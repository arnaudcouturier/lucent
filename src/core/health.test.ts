import { expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform } from '../platform/fake'
import { OPTISCALER_HASH, fixtureUrl } from '../platform/contentFixture'
import { dataPaths, readDeployment } from './deployment'
import { PlatformError } from './platform'
import { fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { statusCard } from './statusCard'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`
const PATCH = '2026.10.20.0000.0000'

async function deployed() {
  const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT)))
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  return platform
}

async function reopen(platform: FakePlatform) {
  const core = createCore(platform)
  await core.scan()
  return core
}

it('shows drift naming the patch when a game patch replaces a deployed DLL', async () => {
  const platform = await deployed()
  await platform.writeText(`${GAME}\\winmm.dll`, 'Patched')
  await platform.writeText(`${GAME}\\ffxivgame.ver`, PATCH)
  const core = await reopen(platform)
  expect(statusCard(core.getState())).toEqual({ kind: 'drift', files: 1, patch: PATCH })
})

it('repairs a patched DLL from the cache and returns to healthy, keeping the player’s config changes', async () => {
  const platform = await deployed()
  const presetSelection = '[GENERAL]\nPresetPath=reshade-presets/Example.ini\n[INPUT]\nKeyOverlay=36,0,0,0\n'
  await platform.writeText(`${GAME}\\ReShade.ini`, presetSelection)
  await platform.writeText(`${GAME}\\winmm.dll`, 'Patched')
  await platform.writeText(`${GAME}\\ffxivgame.ver`, PATCH)
  const core = await reopen(platform)
  const downloads = platform.downloads.length
  await core.repair()
  expect(core.getState().error).toBeNull()
  expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
  expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('OptiScaler')
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe(presetSelection)
  expect(platform.downloads.length).toBe(downloads)
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'healthy' })
})

it('treats an edited shipped preset as the player’s, and a deleted one as drift that Repair brings back', async () => {
  const platform = await deployed()
  const preset = `${GAME}\\reshade-presets\\Example.ini`
  await platform.writeText(preset, 'My tweaks')
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'healthy' })
  await platform.removeFile(preset)
  const core = await reopen(platform)
  expect(statusCard(core.getState())).toEqual({ kind: 'drift', files: 1, patch: null })
  await core.repair()
  expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
  expect(await platform.readText(preset)).toBe('Preset')
})

it('downloads only the missing file when the cache lost it', async () => {
  const platform = await deployed()
  await platform.removeFile(`${(await dataPaths(platform, ROOT)).cache}\\${OPTISCALER_HASH}`)
  await platform.removeFile(`${GAME}\\winmm.dll`)
  await platform.removeFile(`${GAME}\\ReShade64.dll`)
  const core = await reopen(platform)
  const downloads = platform.downloads.length
  await core.repair()
  expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
  expect(platform.downloads.slice(downloads)).toEqual([fixtureUrl(OPTISCALER_HASH)])
  expect(await platform.readText(`${GAME}\\ReShade64.dll`)).toBe('ReShade')
})

it('leaves the game folder as it was when Repair can’t download, and keeps showing drift', async () => {
  const platform = await deployed()
  await platform.removeFile(`${(await dataPaths(platform, ROOT)).cache}\\${OPTISCALER_HASH}`)
  await platform.writeText(`${GAME}\\winmm.dll`, 'Patched')
  await platform.removeFile(`${GAME}\\ReShade64.dll`)
  const core = await reopen(platform)
  const before = await snapshot(platform)
  platform.downloadFile = async () => { throw new PlatformError('network', 'Offline') }
  await core.repair()
  expect(core.getState().error).toMatch(/download/)
  expect(statusCard(core.getState())).toEqual({ kind: 'drift', files: 2, patch: null })
  expect(await snapshot(platform)).toEqual(before)
})

it('restores an unreadable owned config to Lucent’s last-written copy', async () => {
  const platform = await deployed()
  const written = await platform.readText(`${GAME}\\OptiScaler.ini`)
  await platform.writeText(`${GAME}\\OptiScaler.ini`, '\0\0\0')
  const core = await reopen(platform)
  expect(statusCard(core.getState())).toEqual({ kind: 'drift', files: 1, patch: null })
  await core.repair()
  expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
  expect(await platform.readText(`${GAME}\\OptiScaler.ini`)).toBe(written)
})

it('refuses to repair while the game runs', async () => {
  const platform = await deployed()
  await platform.writeText(`${GAME}\\winmm.dll`, 'Patched')
  const core = await reopen(platform)
  platform.isGameRunning = async () => true
  await core.repair()
  expect(core.getState().error).toMatch(/Close XIV/)
  expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('Patched')
})

it('keeps a Disabled deployment Disabled through Repair', async () => {
  const platform = await deployed()
  const record = (await readDeployment(platform, ROOT))!
  record.enabled = false
  await platform.renameFile(`${GAME}\\winmm.dll`, `${GAME}\\winmm.dll.disabled`)
  record.files['winmm.dll.disabled'] = record.files['winmm.dll']
  delete record.files['winmm.dll']
  await platform.writeText((await dataPaths(platform, ROOT)).record, JSON.stringify(record))
  await platform.removeFile(`${GAME}\\winmm.dll.disabled`)
  const core = await reopen(platform)
  await core.repair()
  expect(core.getState().activity).toMatchObject({ kind: 'deployment', enabled: false, drift: null })
  expect(await platform.readText(`${GAME}\\winmm.dll.disabled`)).toBe('OptiScaler')
  expect(await platform.listFiles(GAME)).not.toContain('winmm.dll')
})

it('trusts a matching size and modified time until the game version changes, then checks every hash', async () => {
  const platform = await deployed()
  const stamp = (await readDeployment(platform, ROOT))!.files['winmm.dll']
  // Same size, original timestamp: only a hash can tell.
  await platform.writeText(`${GAME}\\winmm.dll`, 'OptiScaleX')
  platform.setModifiedTime(`${GAME}\\winmm.dll`, stamp.modifiedMs)
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'healthy' })
  await platform.writeText(`${GAME}\\ffxivgame.ver`, PATCH)
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'drift', files: 1, patch: PATCH })
})

it('undoes a repair that fails partway, leaving the game folder as it was', async () => {
  const platform = await deployed()
  await platform.writeText(`${GAME}\\winmm.dll`, 'Patched')
  await platform.removeFile(`${GAME}\\ReShade64.dll`)
  const core = await reopen(platform)
  const before = await snapshot(platform)
  const copy = platform.copyFile.bind(platform)
  let gameWrites = 0
  platform.copyFile = async (from, to, replace) => {
    if (to.startsWith(`${GAME}\\`) && ++gameWrites === 2) throw new PlatformError('disk-full', 'Disk full')
    await copy(from, to, replace)
  }
  await core.repair()
  platform.copyFile = copy
  expect(core.getState()).toMatchObject({ recoveryRequired: false, error: expect.stringMatching(/disk space.*restored the game folder/) })
  expect(statusCard(core.getState())).toEqual({ kind: 'drift', files: 2, patch: null })
  expect(await snapshot(platform)).toEqual(before)
  await core.repair()
  expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
})

async function snapshot(platform: FakePlatform) {
  const files = await platform.listFiles(GAME)
  return Object.fromEntries(await Promise.all(files.map(async (f) => [f, await platform.readText(`${GAME}\\${f}`)])))
}
