import { describe, expect, it } from 'vitest'
import { announcedAppUpdate, APP_RELEASES_URL, parseAppReleases } from './appUpdate'
import { createCore } from './core'
import { statusCard } from './statusCard'
import { createFakePlatform, FAKE_EXE_PATH } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, nextContentHost, vanillaGame, xivLauncher } from '../platform/fixtures'
import { MANIFEST_URL } from './manifest'
import { NEXT_CONTENT, NEXT_MANIFEST } from '../platform/contentFixture'
import { APP_EXE_TEXT, APP_EXE_URL, appReleaseHost } from '../platform/appUpdateFixture'
import { PlatformError } from './platform'

const digest = 'a'.repeat(64)
const release = (version: string, patch: Record<string, unknown> = {}) => ({
  tag_name: `app-v${version}`,
  draft: false,
  prerelease: false,
  body: 'Faster startup.\n\nClearer errors.\n',
  assets: [{ name: 'Lucent.exe', browser_download_url: `https://example.test/app-v${version}/Lucent.exe`, digest: `sha256:${digest}`, size: 123 }],
  ...patch,
})
const releases = (...items: unknown[]) => JSON.stringify(items)

const ROOT = 'C:\\Games\\XIV'

async function deployed() {
  const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  return { platform, m }
}

it('announces the app release and its notes ahead of a content update without downloading it', async () => {
  const { platform, m } = await deployed()
  Object.assign(m.remoteText!, nextContentHost().remoteText, { [APP_RELEASES_URL]: releases(release('0.2.0')) })
  const core = createCore(platform)
  await core.scan()
  expect(statusCard(core.getState())).toMatchObject({ kind: 'app-update', version: '0.2.0', notes: ['Faster startup.', 'Clearer errors.'] })
  expect(platform.downloads).not.toContain('https://example.test/app-v0.2.0/Lucent.exe')
})

it('offers the app update during Scan when content needs a newer app', async () => {
  const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT), {
    remoteText: {
      [MANIFEST_URL]: JSON.stringify({ ...NEXT_MANIFEST, versions: [{ ...NEXT_CONTENT, minAppVersion: '0.2.0' }] }),
      [APP_RELEASES_URL]: releases(release('0.2.0')),
    },
  })
  const core = createCore(createFakePlatform(m))
  await core.scan()
  expect(statusCard(core.getState())).toMatchObject({ kind: 'app-update', version: '0.2.0' })
  await core.review()
  expect(core.getState().plan).toBeNull()
  expect(core.getState().error).toMatch(/Update Lucent/)
})

it('restores the original executable if relaunching the update fails', async () => {
  const platform = createFakePlatform(appReleaseHost())
  const core = createCore(platform)
  await core.scan()
  platform.launchExe = async () => { throw new PlatformError('access-denied', 'Could not start Lucent') }
  await core.updateApp()
  expect(core.getState()).toMatchObject({ busy: false, error: 'Could not start Lucent' })
  expect(await platform.readText(FAKE_EXE_PATH)).toBe('Lucent 0.1.0')
})

it('preserves an unrelated file beside the executable during startup and Update', async () => {
  const m = machine(appReleaseHost(), { files: { [`${FAKE_EXE_PATH}.old`]: 'A user backup' } })
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  expect(await platform.readText(`${FAKE_EXE_PATH}.old`)).toBe('A user backup')
  await core.updateApp()
  expect(core.getState().error).toMatch(/already exists/)
  expect(await platform.readText(`${FAKE_EXE_PATH}.old`)).toBe('A user backup')
  expect(await platform.readText(FAKE_EXE_PATH)).toBe('Lucent 0.1.0')
  expect(platform.launched).toEqual([])
})

it('announces the app instead of content that needs a newer app', async () => {
  const { platform, m } = await deployed()
  Object.assign(m.remoteText!, appReleaseHost().remoteText, {
    [MANIFEST_URL]: JSON.stringify({ ...NEXT_MANIFEST, versions: [NEXT_MANIFEST.versions[0], { ...NEXT_CONTENT, minAppVersion: '0.2.0' }] }),
  })
  const core = createCore(platform)
  await core.scan()
  expect(core.getState().activity).toMatchObject({ kind: 'deployment', update: null })
  expect(statusCard(core.getState())).toMatchObject({ kind: 'app-update', version: '0.2.0' })
  await core.skipAppUpdate()
  expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
})

it('persists Skip for the app independently of content and announces later app versions', async () => {
  const { platform, m } = await deployed()
  Object.assign(m.remoteText!, nextContentHost().remoteText, appReleaseHost().remoteText)
  const core = createCore(platform)
  await core.scan()
  await core.skipAppUpdate()
  expect(statusCard(core.getState())).toMatchObject({ kind: 'update', version: '2026.11.02' })
  const reopened = createCore(platform)
  await reopened.scan()
  expect(statusCard(reopened.getState())).toMatchObject({ kind: 'update', version: '2026.11.02' })
  await reopened.skipUpdate()
  m.remoteText![APP_RELEASES_URL] = releases(release('0.2.0'), release('0.3.0'))
  await reopened.scan()
  expect(statusCard(reopened.getState())).toMatchObject({ kind: 'app-update', version: '0.3.0' })
  expect(platform.downloads).not.toContain(APP_EXE_URL)
})

it('aborts a hash mismatch without replacing any executable or launching it', async () => {
  const m = machine(appReleaseHost(), { remoteText: { [APP_EXE_URL]: 'Corrupt download' } })
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.updateApp()
  expect(core.getState().error).toMatch(/hash check.*Nothing was replaced/)
  expect(await platform.readText(FAKE_EXE_PATH)).toBe('Lucent 0.1.0')
  expect(await platform.listFiles('C:\\Users\\Player\\Downloads')).toEqual(['lucent.exe'])
  expect(platform.launched).toEqual([])
  expect(statusCard(core.getState())).toMatchObject({ kind: 'app-update', version: '0.2.0' })
})

it('replaces and relaunches the verified executable, cleaning the previous one at the next start', async () => {
  const platform = createFakePlatform(appReleaseHost())
  const core = createCore(platform)
  await core.scan()
  platform.hold()
  const updating = core.updateApp()
  expect(statusCard(core.getState())).toEqual({ kind: 'busy', operation: 'app-update', progress: 0 })
  platform.release()
  await updating
  expect(core.getState()).toMatchObject({ error: null, busy: false })
  expect(await platform.readText(FAKE_EXE_PATH)).toBe(APP_EXE_TEXT)
  expect(await platform.readText(`${FAKE_EXE_PATH}.old`)).toBe('Lucent 0.1.0')
  expect(platform.launched).toEqual([FAKE_EXE_PATH])
  await createCore(platform).scan()
  expect(await platform.listFiles('C:\\Users\\Player\\Downloads')).toEqual(['lucent.exe'])
  expect(await platform.readText(FAKE_EXE_PATH)).toBe(APP_EXE_TEXT)
})

it('opens the deployment and announces content when the app releases are unreachable', async () => {
  const { platform, m } = await deployed()
  Object.assign(m.remoteText!, nextContentHost().remoteText)
  const core = createCore(platform)
  await core.scan()
  expect(core.getState().error).toBeNull()
  expect(statusCard(core.getState())).toMatchObject({ kind: 'update', version: '2026.11.02' })
})

describe('GitHub app releases', () => {
  it('parses an app release with its notes, download and SHA-256 digest', () => {
    expect(parseAppReleases(releases(release('0.2.0'), { tag_name: 'content-2026.11.02', assets: [] }))).toEqual([{
      version: '0.2.0',
      notes: ['Faster startup.', 'Clearer errors.'],
      downloadUrl: 'https://example.test/app-v0.2.0/Lucent.exe',
      sha256: digest,
      size: 123,
      prerelease: false,
    }])
  })

  it('ignores releases without a Lucent.exe asset or a usable digest', () => {
    expect(parseAppReleases(releases(
      release('0.2.0', { assets: [] }),
      release('0.3.0', { assets: [{ name: 'Lucent.exe', browser_download_url: 'https://example.test/x', digest: null, size: 1 }] }),
      release('0.4.0', { assets: [{ name: 'Other.exe', browser_download_url: 'https://example.test/x', digest: `sha256:${digest}`, size: 1 }] }),
    ))).toEqual([])
  })

  it('announces the newest Stable release newer than the running app', () => {
    const parsed = parseAppReleases(releases(release('0.1.1'), release('0.2.0'), release('0.3.0-beta.1', { prerelease: true }), release('0.4.0', { draft: true })))
    expect(announcedAppUpdate(parsed, { appVersion: '0.1.0', skipped: [], channel: 'stable' })?.version).toBe('0.2.0')
    expect(announcedAppUpdate(parsed, { appVersion: '0.2.0', skipped: [], channel: 'stable' })).toBeNull()
  })

  it('never offers a beta tag on Stable even if GitHub marks it as a regular release', () => {
    const parsed = parseAppReleases(releases(release('0.3.0-beta.1')))
    expect(announcedAppUpdate(parsed, { appVersion: '0.1.0', skipped: [], channel: 'stable' })).toBeNull()
  })

  it('passes over a skipped app version to the newest one that is not skipped', () => {
    const parsed = parseAppReleases(releases(release('0.2.0'), release('0.3.0')))
    expect(announcedAppUpdate(parsed, { appVersion: '0.1.0', skipped: ['0.3.0'], channel: 'stable' })?.version).toBe('0.2.0')
    expect(announcedAppUpdate(parsed, { appVersion: '0.1.0', skipped: ['0.3.0', '0.2.0'], channel: 'stable' })).toBeNull()
  })
})
