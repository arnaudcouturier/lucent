import { expect, it } from 'vitest'
import { createCore } from './core'
import { APP_RELEASES_URL } from './appUpdate'
import { MANIFEST_URL } from './manifest'
import { statusCard } from './statusCard'
import { createFakePlatform, type FakePlatform } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, nextContentHost, vanillaGame, xivLauncher } from '../platform/fixtures'
import { APP_RELEASE, appReleaseHost } from '../platform/appUpdateFixture'
import { NEXT_CONTENT, PROFILE_MANIFEST } from '../platform/contentFixture'

const ROOT = 'C:\\Games\\XIV'
const NO_APP_RELEASES = { [APP_RELEASES_URL]: '[]' }

/** Deployed and reopened, so the check on open has already run against what was published then. */
async function opened() {
  const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))
  Object.assign(m.remoteText!, NO_APP_RELEASES)
  const platform = createFakePlatform(m)
  const first = createCore(platform)
  await first.scan()
  await first.review()
  await first.deploy()
  const core = createCore(platform)
  await core.scan()
  return { platform, core, m }
}

function watchGameWrites(platform: FakePlatform) {
  const writes: string[] = []
  for (const method of ['writeText', 'copyFile', 'removeFile', 'renameFile'] as const) {
    const original = (platform[method] as (...args: string[]) => Promise<unknown>).bind(platform)
    ;(platform as unknown as Record<string, unknown>)[method] = async (...args: string[]) => {
      for (const arg of args) if (typeof arg === 'string' && arg.toLowerCase().startsWith(`${ROOT.toLowerCase()}\\`)) writes.push(`${method} ${arg}`)
      return original(...args)
    }
  }
  return writes
}

it('announces content published after Lucent opened, without reopening it', async () => {
  const { core, m } = await opened()
  expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
  Object.assign(m.remoteText!, nextContentHost().remoteText)
  await core.checkForUpdates()
  expect(core.getState()).toMatchObject({ error: null, busy: false, updateCheck: { status: 'checked', checkedAt: expect.any(String), error: null } })
  expect(core.getState().activity).toMatchObject({ kind: 'deployment', update: { version: NEXT_CONTENT.id } })
  expect(statusCard(core.getState())).toMatchObject({ kind: 'update', version: NEXT_CONTENT.id })
  expect(core.getState().versions.map((v) => v.id)).toContain(NEXT_CONTENT.id)
})

it('announces an app release published after Lucent opened', async () => {
  const { core, m } = await opened()
  Object.assign(m.remoteText!, appReleaseHost().remoteText)
  await core.checkForUpdates()
  expect(core.getState()).toMatchObject({ error: null, updateCheck: { status: 'checked', checkedAt: expect.any(String), error: null }, appUpdate: { version: '0.2.0', notes: APP_RELEASE.body.split('\n') } })
})

it('names both when the app and the content have new versions', async () => {
  const { core, m } = await opened()
  Object.assign(m.remoteText!, nextContentHost().remoteText, appReleaseHost().remoteText)
  await core.checkForUpdates()
  expect(core.getState().activity).toMatchObject({ update: { version: NEXT_CONTENT.id } })
  expect(core.getState().appUpdate?.version).toBe('0.2.0')
})

it('says so when everything is up to date', async () => {
  const { core } = await opened()
  await core.checkForUpdates()
  expect(core.getState()).toMatchObject({ error: null, updateCheck: { status: 'checked', checkedAt: expect.any(String), error: null } })
  expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
})

it('reports a failed check instead of saying everything is up to date, and keeps what it knew', async () => {
  const { core, m } = await opened()
  const checkedAt = core.getState().updateCheck.checkedAt
  delete m.remoteText![MANIFEST_URL]
  await core.checkForUpdates()
  expect(core.getState().updateCheck).toMatchObject({ status: 'failed', checkedAt, error: expect.stringContaining('manifest') })
  expect(core.getState().error).toBeNull()
  expect(core.getState().manifest.status).toBe('ready')
  m.remoteText![MANIFEST_URL] = JSON.stringify(PROFILE_MANIFEST)
  delete m.remoteText![APP_RELEASES_URL]
  await core.checkForUpdates()
  expect(core.getState().updateCheck).toMatchObject({ status: 'failed', error: expect.any(String) })
})

it('records a quiet successful check on open and keeps that success when a later open cannot reach a source', async () => {
  const { platform, core, m } = await opened()
  Object.assign(m.remoteText!, nextContentHost().remoteText, appReleaseHost().remoteText)
  await core.checkForUpdates()
  const lastSuccess = JSON.parse(await platform.readText(`${await platform.envFolder('LocalAppData')}\\Lucent\\settings.json`)).lastUpdateCheck
  expect(Number.isFinite(Date.parse(lastSuccess.checkedAt))).toBe(true)
  expect(lastSuccess).toMatchObject({ appVersion: '0.2.0', contentVersion: NEXT_CONTENT.id })

  delete m.remoteText![MANIFEST_URL]
  delete m.remoteText![APP_RELEASES_URL]
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState()).toMatchObject({ error: null, updateCheck: { status: 'stale', checkedAt: lastSuccess.checkedAt, error: null,
    outcome: { channel: 'stable', appVersion: '0.2.0', contentVersion: NEXT_CONTENT.id } } })
})

it('announces a successful app release check on open even when the manifest is unavailable', async () => {
  const { platform, m } = await opened()
  Object.assign(m.remoteText!, appReleaseHost().remoteText)
  delete m.remoteText![MANIFEST_URL]
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState()).toMatchObject({ error: null, appUpdate: { version: '0.2.0' }, updateCheck: { status: 'stale' } })
})

it('leaves an unrelated notice in place when the player checks for updates', async () => {
  const { core } = await opened()
  await core.checkFiles()
  const notice = core.getState().notice
  expect(notice).toBeTruthy()
  await core.checkForUpdates()
  expect(core.getState().notice).toBe(notice)
})

it('exposes the checking state while the sources are still loading', async () => {
  const { core, platform } = await opened()
  const fetchText = platform.fetchText.bind(platform)
  let finishManifest!: (text: string) => void
  platform.fetchText = async (url) => url === MANIFEST_URL ? new Promise<string>((resolve) => { finishManifest = resolve }) : fetchText(url)
  const checking = core.checkForUpdates()
  expect(core.getState().updateCheck.status).toBe('checking')
  await new Promise((resolve) => setTimeout(resolve, 0))
  finishManifest(JSON.stringify(PROFILE_MANIFEST))
  await checking
  expect(core.getState().updateCheck.status).toBe('checked')
})

it('works while XIV runs and never writes to the game folder', async () => {
  const { platform, core, m } = await opened()
  Object.assign(m.remoteText!, nextContentHost().remoteText)
  platform.isGameRunning = async () => true
  const writes = watchGameWrites(platform)
  await core.checkForUpdates()
  expect(core.getState().activity).toMatchObject({ update: { version: NEXT_CONTENT.id } })
  expect(writes).toEqual([])
})
