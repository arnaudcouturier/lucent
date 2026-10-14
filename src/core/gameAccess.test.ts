import { expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform, type Machine } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, nextContentHost, vanillaGame, xivLauncher } from '../platform/fixtures'
import { statusCard } from './statusCard'
import { dataPaths, readDeployment } from './deployment'
import { PlatformError } from './platform'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`
const RADEON = graphicsCard('AMD Radeon RX 7900 XTX', 0x1002).gpus
const fixture = () => machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))
const snapshot = async (platform: FakePlatform) => Object.fromEntries(await Promise.all(
  (await platform.listFiles(GAME)).map(async (path) => [path, await platform.readText(`${GAME}\\${path}`)]),
))

it('observes XIV starting and closing without rescanning or losing the selected profile', async () => {
  const m = fixture()
  const core = createCore(createFakePlatform(m))
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  m.gameRunning = true
  await core.refreshGameRunning()
  expect(statusCard(core.getState())).toEqual({ kind: 'game-running' })
  m.gameRunning = false
  await core.refreshGameRunning()
  expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
  await core.selectProfile('balanced')
  expect(core.getState().selectedProfile).toBe('balanced')
})

it.each(['deploy', 'repair', 'profile', 'enabled', 'uninstall', 'update', 'switchTier'] as const)('refuses %s while XIV runs without changing the game folder or downloading', async (command) => {
  const m = fixture()
  const platform = createFakePlatform(m)
  let core = createCore(platform)
  await core.scan()
  await core.review()
  if (command !== 'deploy') {
    await core.deploy()
    core.finish()
    await platform.writeText(`${GAME}\\winmm.dll`, 'Patched')
    Object.assign(m.remoteText!, nextContentHost().remoteText)
    if (command === 'switchTier') m.gpus = RADEON
    core = createCore(platform)
    await core.scan()
  }
  const before = await snapshot(platform)
  const downloads = [...platform.downloads]
  m.gameRunning = true
  if (command === 'profile') await core.selectProfile('balanced')
  else if (command === 'enabled') await core.setEnabled(false)
  else await core[command]()
  expect(core.getState().error).toMatch(/Close XIV/)
  expect(await snapshot(platform)).toEqual(before)
  expect(platform.downloads).toEqual(downloads)
})

// Game writes go in batches and the check runs before each one, so XIV starting during a batch stops the next.
it('stops uninstall and preserves recovery when XIV starts between batches of game writes', async () => {
  const m = fixture()
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  const remove = platform.removeFile.bind(platform)
  const removed: string[] = []
  platform.removeFile = async (path) => {
    await remove(path)
    if (path.startsWith(GAME)) { removed.push(path); m.gameRunning = true }
  }
  await core.uninstall()
  expect(removed.length).toBeGreaterThan(0)
  expect(core.getState().recoveryRequired).toBe(true)
  m.gameRunning = false
  platform.removeFile = remove
  await core.scan()
  expect(await platform.listFiles(GAME)).toEqual(['ffxiv_dx11.exe', 'ffxivgame.ver'])
})

it('asks once for a non-writable game folder and resumes deployment with the same folder and choices', async () => {
  const manual = 'E:\\Manual XIV'
  const game = `${manual}\\game`
  const m = machine(fixture(), vanillaGame(manual), { readOnlyDirectories: [game] })
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  platform.answerPicker(manual)
  await core.chooseGameFolder()
  await core.continueSetup()
  await core.selectProfile('performance')
  await core.review(false)
  await core.deploy()
  expect(platform.elevationRequests).toHaveLength(1)
  expect(await platform.listFiles(game)).toEqual(['ffxiv_dx11.exe', 'ffxivgame.ver'])
  await core.deploy()
  expect(platform.elevationRequests).toHaveLength(1)
  m.elevated = true
  const resumed = createCore(platform)
  await resumed.scan()
  expect(resumed.getState()).toMatchObject({ activity: { kind: 'done' }, selectedProfile: 'performance', includeReShade: false, gameFolder: { path: manual } })
  expect(await platform.readText(`${game}\\winmm.dll`)).toBe('OptiScaler')
  expect(await platform.listFiles(game)).not.toContain('reshade64.dll')
  expect(await platform.listFiles(GAME)).toEqual(['ffxiv_dx11.exe', 'ffxivgame.ver'])
})

it('keeps the reviewed takeover paths through elevation instead of authorizing files found by the elevated Scan', async () => {
  const m = machine(fixture(), { readOnlyDirectories: [GAME], files: { [`${GAME}\\winmm.dll`]: 'Reviewed user file' } })
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review(false)
  await core.deploy()
  expect(platform.elevationRequests).toHaveLength(1)
  const resume = JSON.parse(await platform.readText(platform.elevationRequests[0]))
  expect(resume.request.reviewedPaths).toContain('winmm.dll')
  m.elevated = true
  await platform.writeText(`${GAME}\\dxgi.dll`, 'Unreviewed ReShade')
  await platform.writeText(`${GAME}\\ReShade.ini`, '[GENERAL]\n')
  const resumed = createCore(platform)
  await resumed.scan()
  expect(resumed.getState()).toMatchObject({ activity: { kind: 'scan' }, deployment: null, plan: null })
  expect(resumed.getState().error).toMatch(/dxgi.dll.*Run Scan again/)
  expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('Reviewed user file')
  expect(await platform.readText(`${GAME}\\dxgi.dll`)).toBe('Unreviewed ReShade')
  expect(platform.downloads).toHaveLength(0)
})

it.each(['repair', 'profile', 'enabled', 'uninstall', 'update', 'switchTier'] as const)('continues %s after elevation without repeating the administrator request', async (command) => {
  const m = fixture()
  const platform = createFakePlatform(m)
  let core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  if (command === 'repair') await platform.writeText(`${GAME}\\winmm.dll`, 'Patched')
  if (command === 'update') Object.assign(m.remoteText!, nextContentHost().remoteText)
  if (command === 'switchTier') m.gpus = RADEON
  core = createCore(platform)
  await core.scan()
  m.readOnlyDirectories = [GAME]
  if (command === 'profile') await core.selectProfile('balanced')
  else if (command === 'enabled') await core.setEnabled(false)
  else await core[command]()
  expect(platform.elevationRequests).toHaveLength(1)
  m.elevated = true
  const resumed = createCore(platform)
  await resumed.scan()
  expect(resumed.getState().error).toBeNull()
  if (command === 'profile') expect(resumed.getState().selectedProfile).toBe('balanced')
  else if (command === 'enabled') expect(resumed.getState().deployment?.enabled).toBe(false)
  else if (command === 'update') expect(resumed.getState().deployment?.contentVersion).toBe('2026.11.02')
  else if (command === 'switchTier') expect(resumed.getState().deployment?.tier).toBe('radeon')
  else if (command === 'repair') expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('OptiScaler')
  else expect(await platform.listFiles(GAME)).toEqual(['ffxiv_dx11.exe', 'ffxivgame.ver'])
  expect(platform.elevationRequests).toHaveLength(1)
})

it('continues recovery after elevation before doing any other startup work', async () => {
  const m = fixture()
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  const record = (await readDeployment(platform, ROOT))!
  record.status = 'applying'
  await platform.writeText((await dataPaths(platform, ROOT)).record, JSON.stringify(record))
  m.readOnlyDirectories = [GAME]
  await createCore(platform).scan()
  expect(platform.elevationRequests).toHaveLength(1)
  m.elevated = true
  const resumed = createCore(platform)
  await resumed.scan()
  expect(resumed.getState().error).toBeNull()
  expect(await platform.listFiles(GAME)).toEqual(['ffxiv_dx11.exe', 'ffxivgame.ver'])
})

it('keeps Review and the game folder intact when UAC is cancelled, and asks again on retry', async () => {
  const m: Machine = { ...fixture(), readOnlyDirectories: [GAME], elevationCancelled: true }
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review(false)
  expect(platform.elevationRequests).toHaveLength(0)
  await core.deploy()
  expect(core.getState()).toMatchObject({ activity: { kind: 'review' }, busy: false, recoveryRequired: false, includeReShade: false })
  expect(core.getState().error).toMatch(/cancelled/i)
  await core.deploy()
  expect(platform.elevationRequests).toHaveLength(2)
  expect(await platform.listFiles(GAME)).toEqual(['ffxiv_dx11.exe', 'ffxivgame.ver'])
  expect(platform.downloads).toHaveLength(0)
})

it('never asks for administrator access for a writable game folder, or while XIV runs', async () => {
  for (const gameRunning of [false, true]) {
    const m = fixture()
    m.gameRunning = gameRunning
    if (gameRunning) m.readOnlyDirectories = [GAME]
    const platform = createFakePlatform(m)
    const core = createCore(platform)
    await core.scan()
    await core.review()
    await core.deploy()
    expect(platform.elevationRequests).toHaveLength(0)
  }
})

it('keeps changes unavailable when the process check fails and recovers on the next successful check', async () => {
  const platform = createFakePlatform(fixture())
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  const running = platform.isGameRunning.bind(platform)
  platform.isGameRunning = async () => { throw new PlatformError('unknown', 'Process snapshot unavailable') }
  await core.refreshGameRunning()
  expect(statusCard(core.getState())).toEqual({ kind: 'game-check-failed' })
  await core.setEnabled(false)
  expect(core.getState().deployment?.enabled).toBe(true)
  platform.isGameRunning = running
  await core.refreshGameRunning()
  expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
})

it('asks for elevation when the profile config is protected even though the game root is writable', async () => {
  const m = fixture()
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  m.readOnlyDirectories = [`${GAME}\\OptiScaler.ini`]
  await core.selectProfile('balanced')
  expect(platform.elevationRequests).toHaveLength(1)
  expect(core.getState().recoveryRequired).toBe(false)
  m.elevated = true
  const resumed = createCore(platform)
  await resumed.scan()
  expect(resumed.getState().selectedProfile).toBe('balanced')
})

it('keeps the player’s deployment data when UAC uses another administrator account', async () => {
  const m = fixture()
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  const originalData = (await dataPaths(platform, ROOT)).data
  m.readOnlyDirectories = [GAME]
  await core.setEnabled(false)
  m.elevated = true
  const envFolder = platform.envFolder.bind(platform)
  platform.envFolder = async (folder) => folder === 'LocalAppData' ? 'C:\\Users\\Administrator\\AppData\\Local' : envFolder(folder)
  const resumed = createCore(platform)
  await resumed.scan()
  expect(resumed.getState().error).toBeNull()
  expect(resumed.getState().deployment?.enabled).toBe(false)
  expect((await platform.listFiles(`${originalData}\\deployments`)).filter((f) => !f.includes('\\backups\\'))).toHaveLength(1)
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState().deployment?.enabled).toBe(false)
})

async function deployedThenUpdated() {
  const m = fixture()
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  Object.assign(m.remoteText!, nextContentHost().remoteText)
  await (await reopen(platform)).update()
  return { m, platform, core: await reopen(platform) }
}
const reopen = async (platform: FakePlatform) => { const core = createCore(platform); await core.scan(); return core }

it('refuses rollback while XIV runs without changing the game folder', async () => {
  const { m, platform, core } = await deployedThenUpdated()
  const before = await snapshot(platform)
  m.gameRunning = true
  await core.applyVersion('2026.10.12')
  expect(core.getState().error).toMatch(/Close XIV/)
  expect(core.getState().deployment?.contentVersion).toBe('2026.11.02')
  expect(await snapshot(platform)).toEqual(before)
})

it('continues rollback after elevation without repeating the administrator request', async () => {
  const { m, platform, core } = await deployedThenUpdated()
  m.readOnlyDirectories = [GAME]
  await core.applyVersion('2026.10.12')
  expect(platform.elevationRequests).toHaveLength(1)
  expect(await platform.readText(`${GAME}\\winmm.dll`)).not.toBe('OptiScaler')
  m.elevated = true
  const resumed = await reopen(platform)
  expect(resumed.getState().error).toBeNull()
  expect(resumed.getState().deployment?.contentVersion).toBe('2026.10.12')
  expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('OptiScaler')
  expect(platform.elevationRequests).toHaveLength(1)
})
