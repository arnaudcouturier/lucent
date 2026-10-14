import { expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { statusCard } from './statusCard'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`

async function deployed() {
  const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT)))
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  return { platform, core }
}

async function reopen(platform: FakePlatform) {
  const core = createCore(platform)
  await core.scan()
  return core
}

async function snapshot(platform: FakePlatform) {
  const files = await platform.listFiles(GAME)
  return Object.fromEntries(await Promise.all(files.map(async (f) => [f, await platform.readText(`${GAME}\\${f}`)])))
}

it('disabling renames the entry DLL aside so the game loads nothing, and the status card shows Disabled', async () => {
  const { platform, core } = await deployed()
  await core.setEnabled(false)
  expect(core.getState().error).toBeNull()
  expect(core.getState().deployment).toMatchObject({ enabled: false })
  expect(core.getState().activity).toMatchObject({ kind: 'deployment', enabled: false, drift: null })
  expect(statusCard(core.getState())).toEqual({ kind: 'disabled' })
  const files = await platform.listFiles(GAME)
  expect(files).not.toContain('winmm.dll')
  expect(files).toContain('winmm.dll.disabled')
  expect(await platform.readText(`${GAME}\\winmm.dll.disabled`)).toBe('OptiScaler')
  // Disabled persists across reopening, and the health check expects it.
  const reopened = await reopen(platform)
  expect(reopened.getState().activity).toMatchObject({ kind: 'deployment', enabled: false, drift: null })
  expect(statusCard(reopened.getState())).toEqual({ kind: 'disabled' })
})

it('enabling restores the entry DLL under the name the game loads', async () => {
  const { platform, core } = await deployed()
  await core.setEnabled(false)
  await core.setEnabled(true)
  expect(core.getState().error).toBeNull()
  expect(core.getState().deployment).toMatchObject({ enabled: true })
  expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
  const files = await platform.listFiles(GAME)
  expect(files).toContain('winmm.dll')
  expect(files).not.toContain('winmm.dll.disabled')
  expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('OptiScaler')
  expect((await reopen(platform)).getState().activity).toMatchObject({ kind: 'deployment', enabled: true, drift: null })
})

it('repairing a drifted Disabled deployment keeps it Disabled', async () => {
  const { platform, core } = await deployed()
  await core.setEnabled(false)
  await platform.removeFile(`${GAME}\\winmm.dll.disabled`)
  const drifted = await reopen(platform)
  expect(statusCard(drifted.getState())).toMatchObject({ kind: 'drift' })
  await drifted.repair()
  expect(drifted.getState().error).toBeNull()
  expect(drifted.getState().activity).toMatchObject({ kind: 'deployment', enabled: false, drift: null })
  expect(statusCard(drifted.getState())).toEqual({ kind: 'disabled' })
  expect(await platform.readText(`${GAME}\\winmm.dll.disabled`)).toBe('OptiScaler')
  expect(await platform.listFiles(GAME)).not.toContain('winmm.dll')
})

it('disabling a drifted entry file keeps the drift visible under its disabled name', async () => {
  const { platform, core } = await deployed()
  await platform.writeText(`${GAME}\\winmm.dll`, 'Patched')
  await core.setEnabled(false)
  expect(core.getState().error).toBeNull()
  expect(core.getState().deployment).toMatchObject({ enabled: false })
  expect(core.getState().activity).toMatchObject({ kind: 'deployment', enabled: false, drift: { files: ['winmm.dll.disabled'] } })
  expect(statusCard(core.getState())).toMatchObject({ kind: 'drift' })
  expect(await platform.readText(`${GAME}\\winmm.dll.disabled`)).toBe('Patched')
  expect(await platform.listFiles(GAME)).not.toContain('winmm.dll')
})

it('uninstall from Disabled leaves the folder as it was before Lucent', async () => {
  const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT)))
  const before = await snapshot(platform)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  await core.setEnabled(false)
  await core.uninstall()
  expect(core.getState().error).toBeNull()
  expect(await snapshot(platform)).toEqual(before)
})

it('leaves the deployment Enabled when a user file sits at the disabled name', async () => {
  const { platform, core } = await deployed()
  await platform.writeText(`${GAME}\\winmm.dll.disabled`, 'User file')
  await core.setEnabled(false)
  expect(core.getState().error).toMatch(/Protecting a user file/)
  expect(core.getState().deployment).toMatchObject({ enabled: true })
  expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('OptiScaler')
  expect(await platform.readText(`${GAME}\\winmm.dll.disabled`)).toBe('User file')
  expect((await reopen(platform)).getState().activity).toMatchObject({ kind: 'deployment', enabled: true, drift: null })
})

it('recovers a toggle interrupted after the rename on reopening', async () => {
  const { platform, core } = await deployed()
  const rename = platform.renameFile.bind(platform)
  let crashed!: () => void
  const crashSeen = new Promise<void>((resolve) => { crashed = resolve })
  platform.renameFile = async (from, to, replace) => {
    await rename(from, to, replace)
    crashed()
    await new Promise<void>(() => {})
  }
  void core.setEnabled(false)
  await crashSeen
  platform.crash()
  platform.renameFile = rename
  const reopened = await reopen(platform)
  expect(reopened.getState().error).toBeNull()
  expect(reopened.getState().activity).toMatchObject({ kind: 'deployment', enabled: true, drift: null })
  expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('OptiScaler')
  expect(await platform.listFiles(GAME)).not.toContain('winmm.dll.disabled')
})

it('refuses to toggle while the game runs and leaves the deployment Enabled', async () => {
  const { platform, core } = await deployed()
  platform.isGameRunning = async () => true
  await core.setEnabled(false)
  expect(core.getState().error).toMatch(/Close XIV/)
  expect(core.getState().deployment).toMatchObject({ enabled: true })
  expect(await platform.listFiles(GAME)).toContain('winmm.dll')
})
