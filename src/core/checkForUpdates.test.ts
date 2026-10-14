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
const STABLE = PROFILE_MANIFEST.versions[0]
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
  expect(core.getState()).toMatchObject({ error: null, busy: false, notice: `Content ${NEXT_CONTENT.id} is available. Update from Home.` })
  expect(core.getState().activity).toMatchObject({ kind: 'deployment', update: { version: NEXT_CONTENT.id } })
  expect(statusCard(core.getState())).toMatchObject({ kind: 'update', version: NEXT_CONTENT.id })
  expect(core.getState().versions.map((v) => v.id)).toContain(NEXT_CONTENT.id)
})

it('announces an app release published after Lucent opened', async () => {
  const { core, m } = await opened()
  Object.assign(m.remoteText!, appReleaseHost().remoteText)
  await core.checkForUpdates()
  expect(core.getState()).toMatchObject({ error: null, notice: 'Lucent 0.2.0 is available. Update from Home.', appUpdate: { version: '0.2.0', notes: APP_RELEASE.body.split('\n') } })
})

it('names both when the app and the content have new versions', async () => {
  const { core, m } = await opened()
  Object.assign(m.remoteText!, nextContentHost().remoteText, appReleaseHost().remoteText)
  await core.checkForUpdates()
  expect(core.getState().notice).toBe(`Lucent 0.2.0 and content ${NEXT_CONTENT.id} are available. Update from Home.`)
})

it('says so when everything is up to date', async () => {
  const { core } = await opened()
  await core.checkForUpdates()
  expect(core.getState()).toMatchObject({ error: null, notice: `You’re up to date: Lucent ${__APP_VERSION__}, content ${STABLE.id}.` })
  expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
})

it('reports a failed check instead of saying everything is up to date, and keeps what it knew', async () => {
  const { core, m } = await opened()
  delete m.remoteText![MANIFEST_URL]
  await core.checkForUpdates()
  expect(core.getState().error).toMatch(/^Couldn’t check for updates\./)
  expect(core.getState().notice).toBeNull()
  expect(core.getState().manifest.status).toBe('ready')
  m.remoteText![MANIFEST_URL] = JSON.stringify(PROFILE_MANIFEST)
  delete m.remoteText![APP_RELEASES_URL]
  await core.checkForUpdates()
  expect(core.getState().error).toMatch(/^Couldn’t check for updates\./)
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
