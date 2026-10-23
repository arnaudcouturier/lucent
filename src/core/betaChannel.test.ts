import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { announcedContent } from './updates'
import { announcedAppUpdate, parseAppReleases } from './appUpdate'
import { MANIFEST_URL } from './manifest'
import { readSettings } from './settings'
import { statusCard } from './statusCard'
import { createFakePlatform, type FakePlatform, type Machine } from '../platform/fake'
import { betaContentHost, fixtureContentHost, graphicsCard, machine, manifestHost, nextContentHost, vanillaGame, xivLauncher } from '../platform/fixtures'
import { APP_BETA_RELEASE, APP_EXE_URL, APP_RELEASE, appBetaReleaseHost } from '../platform/appUpdateFixture'
import { BETA_CONTENT, BETA_MANIFEST, NEXT_CONTENT, PROFILE_MANIFEST, TEST_CONTENT, betaFixtureUrl, OPTISCALER_NEXT_HASH } from '../platform/contentFixture'
import type { ContentVersion, Manifest } from '../shared/manifest'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`
const STABLE = PROFILE_MANIFEST.versions[0]

it('installs a Beta-only first deployment only after the player explicitly chooses Beta and scans its files', async () => {
  const platform = createFakePlatform(machine(betaContentHost(), manifestHost({ ...BETA_MANIFEST, versions: [BETA_CONTENT] }), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT)))
  const core = createCore(platform)
  await core.scan()
  expect(core.getState().channel).toBe('stable')
  await core.continueSetup()
  expect(core.getState().error).toMatch(/No content is published/)
  expect(platform.downloads).toEqual([])
  await core.setChannel('beta')
  await core.scan()
  await core.continueSetup()
  await core.review()
  await core.deploy()
  expect(core.getState()).toMatchObject({ channel: 'beta', error: null, deployment: { status: 'complete', contentVersion: BETA_CONTENT.id } })
  expect((await readSettings(platform)).channel).toBe('beta')
})

describe('announcements across both channels', () => {
  const version = (id: string, patch: Partial<ContentVersion> = {}): ContentVersion => ({ ...TEST_CONTENT, id, ...patch })
  const manifest = (...versions: ContentVersion[]): Manifest => ({ ...PROFILE_MANIFEST, versions })
  const facts = { tier: 'rtx-20-30-40', current: '2026.10.12', skipped: [] as string[], appVersion: '0.1.0' }

  it('content: Beta announces the newest version of either channel, Stable ignores Beta', () => {
    const m = manifest(version('2026.10.12'), version('2026.11.02'), version('2026.11.10', { channel: 'beta' }))
    expect(announcedContent(m, { ...facts, channel: 'beta' })?.id).toBe('2026.11.10')
    expect(announcedContent(m, { ...facts, channel: 'stable' })?.id).toBe('2026.11.02')
    const newerStable = manifest(version('2026.10.12'), version('2026.11.10', { channel: 'beta' }), version('2026.11.20'))
    expect(announcedContent(newerStable, { ...facts, channel: 'beta' })?.id).toBe('2026.11.20')
    expect(announcedContent(manifest(version('2026.10.12'), version('2026.11.10', { channel: 'beta' })), { ...facts, channel: 'stable' })).toBeNull()
  })

  it('content: a player on a beta version is offered only a newer Stable version once back on Stable', () => {
    const m = manifest(version('2026.11.02'), version('2026.11.10', { channel: 'beta' }))
    expect(announcedContent(m, { ...facts, channel: 'stable', current: '2026.11.10' })).toBeNull()
    expect(announcedContent(manifest(version('2026.11.10', { channel: 'beta' }), version('2026.11.20')), { ...facts, channel: 'stable', current: '2026.11.10' })?.id).toBe('2026.11.20')
  })

  // An app release's download link must name its own tag, so a copy of the fixture under another tag carries its own link.
  const asRelease = (version: string, patch: Record<string, unknown> = {}) => ({
    ...APP_RELEASE, tag_name: `app-v${version}`,
    assets: [{ ...APP_RELEASE.assets[0], browser_download_url: APP_EXE_URL.replace('app-v0.2.0', `app-v${version}`) }], ...patch,
  })
  const releases = parseAppReleases(JSON.stringify([APP_RELEASE, APP_BETA_RELEASE, asRelease('0.3.0-beta.1', { prerelease: true })]))
  const appFacts = { skipped: [] as string[] }

  it('app: Beta offers the newest pre-release, Stable offers only the release', () => {
    expect(announcedAppUpdate(releases, { ...appFacts, appVersion: '0.1.0', channel: 'beta' })?.version).toBe('0.3.0-beta.1')
    expect(announcedAppUpdate(releases, { ...appFacts, appVersion: '0.1.0', channel: 'stable' })?.version).toBe('0.2.0')
    expect(announcedAppUpdate(parseAppReleases(JSON.stringify([APP_BETA_RELEASE])), { ...appFacts, appVersion: '0.1.0', channel: 'stable' })).toBeNull()
  })

  it('app: a running beta is offered only a Stable release newer than it once back on Stable', () => {
    expect(announcedAppUpdate(releases, { ...appFacts, appVersion: '0.3.0-beta.1', channel: 'stable' })).toBeNull()
    expect(announcedAppUpdate(releases, { ...appFacts, appVersion: '0.2.0-beta.1', channel: 'stable' })?.version).toBe('0.2.0')
    const stable030 = parseAppReleases(JSON.stringify([asRelease('0.3.0'), asRelease('0.3.0-beta.1', { prerelease: true })]))
    expect(announcedAppUpdate(stable030, { ...appFacts, appVersion: '0.3.0-beta.1', channel: 'stable' })?.version).toBe('0.3.0')
  })
})

async function deployed(...extra: Machine[]) {
  const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT), ...extra)
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  return { platform, core, m }
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

/** Records every write the platform is asked to make into the game folder. */
function watchGameWrites(platform: FakePlatform) {
  const writes: string[] = []
  const inGame = (path: string) => path.toLowerCase().startsWith(`${ROOT.toLowerCase()}\\`)
  for (const method of ['writeText', 'writeFileByte', 'copyFile', 'removeFile', 'renameFile', 'removeDirectoryIfEmpty'] as const) {
    const original = (platform[method] as (...args: string[]) => Promise<unknown>).bind(platform)
    ;(platform as unknown as Record<string, unknown>)[method] = async (...args: string[]) => {
      for (const arg of args) if (typeof arg === 'string' && inGame(arg)) writes.push(`${method} ${arg}`)
      return original(...args)
    }
  }
  return writes
}

describe('switching to Beta', () => {
  it('starts on Stable: a newer Beta content version and a pre-release are not announced', async () => {
    const { platform, m } = await deployed()
    Object.assign(m.remoteText!, betaContentHost().remoteText, appBetaReleaseHost().remoteText)
    const core = await reopen(platform)
    expect(core.getState().channel).toBe('stable')
    expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
    expect(core.getState().versions.map((v) => v.id)).toEqual([STABLE.id])
  })

  it('announces the Beta content version and the app pre-release once the player turns Beta on', async () => {
    const { platform, m } = await deployed()
    Object.assign(m.remoteText!, betaContentHost().remoteText, appBetaReleaseHost().remoteText)
    const core = await reopen(platform)
    await core.setChannel('beta')
    expect(core.getState()).toMatchObject({ channel: 'beta', error: null, busy: false })
    expect(core.getState().activity).toMatchObject({ kind: 'deployment', update: { version: BETA_CONTENT.id, changelog: BETA_CONTENT.changelog } })
    expect(core.getState().appUpdate).toMatchObject({ version: '0.2.0-beta.2', prerelease: true })
    expect(statusCard(core.getState())).toMatchObject({ kind: 'app-update', version: '0.2.0-beta.2' })
    expect(core.getState().versions.map((v) => v.id)).toEqual([BETA_CONTENT.id, STABLE.id])
    expect(platform.downloads).not.toContain(betaFixtureUrl(OPTISCALER_NEXT_HASH))
  })

  it('hides a Beta version skipped on Beta from Versions once the player leaves Beta', async () => {
    const { platform, m } = await deployed()
    Object.assign(m.remoteText!, betaContentHost().remoteText)
    const core = await reopen(platform)
    await core.setChannel('beta')
    await core.skipUpdate()
    expect(core.getState().versions).toContainEqual(expect.objectContaining({ id: BETA_CONTENT.id, skipped: true, unavailable: null }))
    await core.setChannel('stable')
    expect(core.getState().versions.map((v) => v.id)).toEqual([STABLE.id])
  })

  it('announces the Beta content version on its own when only content is in beta', async () => {
    const { platform, m } = await deployed()
    Object.assign(m.remoteText!, betaContentHost().remoteText)
    const core = await reopen(platform)
    await core.setChannel('beta')
    expect(statusCard(core.getState())).toMatchObject({ kind: 'update', version: BETA_CONTENT.id })
  })

  it('remembers the channel across restarts, announcing from Beta on the very first scan', async () => {
    const { platform, m } = await deployed()
    Object.assign(m.remoteText!, betaContentHost().remoteText, appBetaReleaseHost().remoteText)
    await (await reopen(platform)).setChannel('beta')
    expect((await readSettings(platform)).channel).toBe('beta')
    const core = await reopen(platform)
    expect(core.getState().channel).toBe('beta')
    expect(core.getState().appUpdate).toMatchObject({ version: '0.2.0-beta.2' })
    expect(core.getState().activity).toMatchObject({ update: { version: BETA_CONTENT.id } })
  })

  it('keeps Skip and the other settings when the channel changes', async () => {
    const { platform, m } = await deployed()
    Object.assign(m.remoteText!, nextContentHost().remoteText)
    const core = await reopen(platform)
    await core.skipUpdate()
    await core.setChannel('beta')
    expect((await readSettings(platform))).toMatchObject({ channel: 'beta', skippedContent: [NEXT_CONTENT.id] })
    await core.skipUpdate()
    expect((await readSettings(platform))).toMatchObject({ channel: 'beta', skippedContent: [NEXT_CONTENT.id] })
  })

  it('reads anything but "beta" in the settings file as Stable', async () => {
    const { platform } = await deployed()
    const core = await reopen(platform)
    await core.setChannel('beta')
    const path = `${(await platform.envFolder('LocalAppData'))}\\Lucent\\settings.json`
    await platform.writeText(path, JSON.stringify({ channel: 'nightly' }))
    expect((await readSettings(platform)).channel).toBe('stable')
    await platform.writeText(path, '{ not json')
    expect((await readSettings(platform)).channel).toBe('stable')
  })

  it('works while XIV runs and never writes to the game folder', async () => {
    const { platform, m } = await deployed()
    Object.assign(m.remoteText!, betaContentHost().remoteText)
    const core = await reopen(platform)
    const before = await snapshot(platform)
    platform.isGameRunning = async () => true
    const writes = watchGameWrites(platform)
    await core.setChannel('beta')
    await core.setChannel('stable')
    await core.setChannel('beta')
    expect(core.getState()).toMatchObject({ channel: 'beta', error: null })
    expect(core.getState().activity).toMatchObject({ update: { version: BETA_CONTENT.id } })
    expect(writes).toEqual([])
    expect(await snapshot(platform)).toEqual(before)
  })

  it('does nothing while another command is running', async () => {
    const { platform, core } = await deployed()
    platform.hold()
    const pending = core.copyDiagnostics()
    await core.setChannel('beta')
    platform.release()
    await pending
    expect(core.getState().channel).toBe('stable')
    expect((await readSettings(platform)).channel).toBe('stable')
  })

  it('reports a settings failure without changing the channel', async () => {
    const { platform } = await deployed()
    const core = await reopen(platform)
    const write = platform.writeText.bind(platform)
    platform.writeText = async (path, text) => {
      if (path.endsWith('settings.json')) throw new Error('Disk is read-only')
      return write(path, text)
    }
    await core.setChannel('beta')
    expect(core.getState()).toMatchObject({ channel: 'stable', busy: false, error: expect.stringMatching(/Disk is read-only/) })
  })

  it('prints the channel in the diagnostics', async () => {
    const { platform } = await deployed()
    const core = await reopen(platform)
    await core.copyDiagnostics()
    expect(platform.clipboard).toMatch(/Channel: Stable/)
    await core.setChannel('beta')
    await core.copyDiagnostics()
    expect(platform.clipboard).toMatch(/Channel: Beta/)
  })
})

describe('a fresh deploy', () => {
  it('installs the newest Stable version on Stable, and the newest version of either channel on Beta', async () => {
    const { platform, core } = await deployed(betaContentHost())
    expect(core.getState().deployment?.contentVersion).toBe(STABLE.id)
    await core.setChannel('beta')
    // The channel is a player setting: it outlives the deployment, and Scan reads it back after the uninstall.
    await core.uninstall()
    expect(core.getState()).toMatchObject({ channel: 'beta', deployment: null })
    await core.review()
    await core.deploy()
    expect(core.getState()).toMatchObject({ error: null, deployment: { contentVersion: BETA_CONTENT.id } })
    expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('OptiScaler 2')
  })
})

describe('leaving Beta', () => {
  /** A player who turned Beta on and updated to the Beta content version. */
  async function onBetaVersion() {
    const { platform, m } = await deployed()
    Object.assign(m.remoteText!, betaContentHost().remoteText)
    const core = await reopen(platform)
    await core.setChannel('beta')
    await core.update()
    expect(core.getState()).toMatchObject({ error: null, deployment: { contentVersion: BETA_CONTENT.id } })
    return { platform, m, core }
  }

  it('changes nothing deployed and announces nothing while no newer Stable version exists', async () => {
    const { platform, core } = await onBetaVersion()
    const before = await snapshot(platform)
    const downloads = platform.downloads.length
    const writes = watchGameWrites(platform)
    await core.setChannel('stable')
    expect(core.getState()).toMatchObject({ channel: 'stable', error: null, deployment: { contentVersion: BETA_CONTENT.id } })
    expect(core.getState().activity).toMatchObject({ kind: 'deployment', update: null, drift: null })
    expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
    expect(await snapshot(platform)).toEqual(before)
    expect(platform.downloads.length).toBe(downloads)
    expect(writes).toEqual([])
    expect(core.getState().versions.find((v) => v.current)?.id).toBe(BETA_CONTENT.id)
    expect((await reopen(platform)).getState()).toMatchObject({ channel: 'stable', deployment: { contentVersion: BETA_CONTENT.id } })
  })

  it('does not announce an older Stable version, even after reopening', async () => {
    const { platform, m, core } = await onBetaVersion()
    Object.assign(m.remoteText!, nextContentHost().remoteText)
    m.remoteText![MANIFEST_URL] = JSON.stringify({ ...BETA_MANIFEST, versions: [STABLE, NEXT_CONTENT, BETA_CONTENT] })
    await core.setChannel('stable')
    expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
    const reopened = await reopen(platform)
    expect(reopened.getState().channel).toBe('stable')
    expect(statusCard(reopened.getState())).toEqual({ kind: 'healthy' })
    expect(reopened.getState().deployment?.contentVersion).toBe(BETA_CONTENT.id)
    expect(reopened.getState().versions.find((v) => v.current)?.id).toBe(BETA_CONTENT.id)
  })

  it('announces a Stable version newer than the beta one, and applies it', async () => {
    const { platform, m, core } = await onBetaVersion()
    await core.setChannel('stable')
    const later: ContentVersion = { ...NEXT_CONTENT, id: '2026.12.01', changelog: ['The Stable release of the beta changes.'] }
    Object.assign(m.remoteText!, nextContentHost().remoteText)
    m.remoteText![MANIFEST_URL] = JSON.stringify({ ...BETA_MANIFEST, versions: [STABLE, NEXT_CONTENT, BETA_CONTENT, later] })
    const reopened = await reopen(platform)
    expect(statusCard(reopened.getState())).toMatchObject({ kind: 'update', version: '2026.12.01', changelog: later.changelog })
    await reopened.update()
    expect(reopened.getState()).toMatchObject({ error: null, deployment: { contentVersion: '2026.12.01' } })
  })

  it('still switches tier on the deployed beta version rather than downgrading to Stable', async () => {
    const { platform, m, core } = await onBetaVersion()
    await core.setChannel('stable')
    m.gpus = graphicsCard('AMD Radeon RX 7900 XTX', 0x1002).gpus
    const reopened = await reopen(platform)
    expect(statusCard(reopened.getState())).toMatchObject({ kind: 'switch-tier', to: 'Radeon' })
    await reopened.switchTier()
    await reopened.review()
    await reopened.deploy()
    expect(reopened.getState()).toMatchObject({ error: null, deployment: { tier: 'radeon', contentVersion: BETA_CONTENT.id } })
  })

  it('also leaves the app alone: a running pre-release is offered only a newer release', async () => {
    const { platform } = await deployed(appBetaReleaseHost())
    const core = await reopen(platform)
    await core.setChannel('beta')
    expect(core.getState().appUpdate).toMatchObject({ version: '0.2.0-beta.2' })
    await core.setChannel('stable')
    expect(core.getState().appUpdate).toBeNull()
  })
})
