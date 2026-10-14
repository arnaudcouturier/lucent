import { expect, it } from 'vitest'
import { createCore } from './core'
import { runHeadless } from './autoRepair'
import { readDeployment } from './deployment'
import { createFakePlatform, type FakePlatform } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { PROFILE_MANIFEST } from '../platform/contentFixture'
import { MANIFEST_URL } from './manifest'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`
const fixture = () => machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))
const snapshot = async (platform: FakePlatform) => Object.fromEntries(await Promise.all(
  (await platform.listFiles(GAME)).map(async (path) => [path, await platform.readText(`${GAME}\\${path}`)]),
))

function pauseAfterGameCopy(platform: FakePlatform) {
  let started!: () => void
  let resume!: () => void
  const paused = new Promise<void>((resolve) => { started = resolve })
  const released = new Promise<void>((resolve) => { resume = resolve })
  const copy = platform.copyMany.bind(platform)
  const copyFile = platform.copyFile.bind(platform)
  let blocked = false
  const pause = async (targets: string[]) => {
    if (!blocked && targets.some((path) => path.startsWith(GAME))) {
      blocked = true
      started()
      await released
    }
  }
  platform.copyMany = async (items, staging) => {
    await copy(items, staging)
    await pause(items.map((item) => item.to))
  }
  platform.copyFile = async (from, to, replace, staging) => { await copyFile(from, to, replace, staging); await pause([to]) }
  return { paused, resume }
}

it('a second window or headless run cannot recover an active deployment, and works once the operation finishes', async () => {
  const platform = createFakePlatform(fixture())
  const first = createCore(platform)
  await first.scan()
  await first.review()
  const { paused, resume } = pauseAfterGameCopy(platform)
  const deploying = first.deploy()
  await paused
  const before = await snapshot(platform)
  expect((await readDeployment(platform, ROOT))?.status).toBe('applying')
  const second = createCore(platform)
  try {
    await second.scan()
    expect(second.getState().error).toMatch(/Another Lucent operation/)
    expect(second.getState().recoveryRequired).toBe(false)
    for (const mode of ['check', 'repair'] as const) {
      expect(await runHeadless(platform, mode)).toMatchObject({ kind: 'failed', reason: expect.stringMatching(/Another Lucent operation/) })
    }
    expect(await snapshot(platform)).toEqual(before)
    expect((await readDeployment(platform, ROOT))?.status).toBe('applying')
  } finally { resume(); await deploying }
  expect(first.getState()).toMatchObject({ error: null, activity: { kind: 'done' } })
  await second.scan()
  expect(second.getState()).toMatchObject({ error: null, activity: { kind: 'deployment', drift: null } })
  // An idle window holds no lease, so XIVLauncher's headless commands remain usable.
  expect(await runHeadless(platform, 'check')).toEqual({ kind: 'healthy' })
  expect(await runHeadless(platform, 'repair')).toEqual({ kind: 'healthy' })
})

it('a second deployed window cannot uninstall while another window is repairing', async () => {
  const platform = createFakePlatform(fixture())
  const first = createCore(platform)
  await first.scan()
  await first.review()
  await first.deploy()
  first.finish()
  const second = createCore(platform)
  await second.scan()
  await platform.writeText(`${GAME}\\ffxivgame.ver`, '2026.10.20.0000.0000')
  await platform.writeText(`${GAME}\\winmm.dll`, 'Patched')
  const { paused, resume } = pauseAfterGameCopy(platform)
  const repairing = first.repair()
  await paused
  const before = await snapshot(platform)
  const active = await readDeployment(platform, ROOT)
  try {
    await second.uninstall()
    expect(second.getState().error).toMatch(/Another Lucent operation/)
    await second.copyDiagnostics()
    await second.reportBug()
    expect(platform.clipboard).toBeNull()
    expect(platform.openedUrls).toEqual([])
    expect(await readDeployment(platform, ROOT)).toEqual(active)
    expect(await snapshot(platform)).toEqual(before)
  } finally { resume(); await repairing }
  expect(first.getState()).toMatchObject({ error: null, activity: { kind: 'deployment', drift: null } })
  await second.uninstall()
  expect(second.getState().error).toBeNull()
  expect(await platform.listFiles(GAME)).toEqual(['ffxiv_dx11.exe', 'ffxivgame.ver'])
})

it('an idle window reloads the current journal before switching Enabled after another window updates', async () => {
  const m = fixture()
  const platform = createFakePlatform(m)
  const first = createCore(platform)
  await first.scan()
  await first.review()
  await first.deploy()
  first.finish()
  const second = createCore(platform)
  await second.scan()
  const next = { ...PROFILE_MANIFEST.versions[0], id: '2026.10.13', changelog: ['Same files, new tested version.'] }
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...PROFILE_MANIFEST, versions: [...PROFILE_MANIFEST.versions, next] })
  await first.scan()
  await first.update()
  const updated = (await readDeployment(platform, ROOT))!
  expect(updated.contentVersion).toBe(next.id)
  platform.setModifiedTime(`${GAME}\\winmm.dll`, 1000)
  await second.setEnabled(false)
  const changed = (await readDeployment(platform, ROOT))!
  expect(second.getState().error).toBeNull()
  expect(changed).toMatchObject({ contentVersion: next.id, enabled: false })
  expect(changed.journal.slice(0, updated.journal.length)).toEqual(updated.journal)
})

it('an old idle window cannot resurrect a deployment that another window uninstalled', async () => {
  const platform = createFakePlatform(fixture())
  const first = createCore(platform)
  await first.scan()
  await first.review()
  await first.deploy()
  first.finish()
  const second = createCore(platform)
  await second.scan()
  await first.uninstall()
  const uninstalled = await readDeployment(platform, ROOT)
  await second.setEnabled(false)
  expect(second.getState()).toMatchObject({ activity: { kind: 'scan' }, deployment: null })
  expect(second.getState().error).toMatch(/changed in another Lucent window.*Run Scan again/)
  expect(await readDeployment(platform, ROOT)).toEqual(uninstalled)
  expect(await platform.listFiles(GAME)).toEqual(['ffxiv_dx11.exe', 'ffxivgame.ver'])
})
