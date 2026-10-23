import { describe, expect, it } from 'vitest'
import { announcedAppUpdate, APP_RELEASES_URL, compareAppVersions, parseAppReleases } from './appUpdate'
import { createCore } from './core'
import { statusCard } from './statusCard'
import { createFakePlatform, FAKE_EXE_PATH } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, nextContentHost, vanillaGame, xivLauncher } from '../platform/fixtures'
import { MANIFEST_URL } from './manifest'
import { NEXT_CONTENT, NEXT_MANIFEST } from '../platform/contentFixture'
import { APP_EXE_TEXT, APP_EXE_URL, appReleaseHost } from '../platform/appUpdateFixture'
import { PlatformError } from './platform'

const digest = 'a'.repeat(64)
const downloadUrl = (version: string) => `https://github.com/arnaudcouturier/lucent/releases/download/app-v${version}/Lucent.exe`
const release = (version: string, patch: Record<string, unknown> = {}) => ({
  tag_name: `app-v${version}`,
  draft: false,
  prerelease: false,
  body: 'Faster startup.\n\nClearer errors.\n',
  assets: [{ name: 'Lucent.exe', browser_download_url: downloadUrl(version), digest: `sha256:${digest}`, size: 123 }],
  ...patch,
})
const withAsset = (version: string, patch: Record<string, unknown>) =>
  release(version, { assets: [{ name: 'Lucent.exe', browser_download_url: downloadUrl(version), digest: `sha256:${digest}`, size: 123, ...patch }] })
const withBody = (body: string) => parseAppReleases(releases(release('0.2.0', { body })))[0].notes
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
  expect(platform.downloads).not.toContain(downloadUrl('0.2.0'))
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
  let started!: () => void
  let release!: () => void
  const downloading = new Promise<void>((resolve) => { started = resolve })
  const held = new Promise<void>((resolve) => { release = resolve })
  const download = platform.downloadFile.bind(platform)
  platform.downloadFile = async (url, to, progress) => { started(); await held; return download(url, to, progress) }
  const updating = core.updateApp()
  await downloading
  expect(statusCard(core.getState())).toEqual({ kind: 'busy', operation: 'app-update', progress: 0 })
  release()
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
      downloadUrl: downloadUrl('0.2.0'),
      sha256: digest,
      size: 123,
      prerelease: false,
    }])
  })

  it('ignores releases without a Lucent.exe asset or a usable digest', () => {
    expect(parseAppReleases(releases(
      release('0.2.0', { assets: [] }),
      withAsset('0.3.0', { digest: null }),
      withAsset('0.4.0', { name: 'Other.exe', browser_download_url: downloadUrl('0.4.0').replace('Lucent.exe', 'Other.exe') }),
    ))).toEqual([])
  })

  it('matches the asset name without regard to case, as the release page may list it', () => {
    expect(parseAppReleases(releases(withAsset('0.2.0', { name: 'LUCENT.EXE' }))).map((r) => r.version)).toEqual(['0.2.0'])
  })

  it.each([
    ['another host', 'https://example.test/arnaudcouturier/lucent/releases/download/app-v0.2.0/Lucent.exe'],
    ['a look-alike host', 'https://github.com.example.test/arnaudcouturier/lucent/releases/download/app-v0.2.0/Lucent.exe'],
    ['plain HTTP', 'http://github.com/arnaudcouturier/lucent/releases/download/app-v0.2.0/Lucent.exe'],
    ['another repository', 'https://github.com/someone/lucent/releases/download/app-v0.2.0/Lucent.exe'],
    ['another release tag', downloadUrl('0.1.9')],
    ['a content release asset', 'https://github.com/arnaudcouturier/lucent/releases/download/content-2026.10.21/Lucent.exe'],
    ['another file name', downloadUrl('0.2.0').replace('Lucent.exe', 'Other.exe')],
    ['a query string', `${downloadUrl('0.2.0')}?token=1`],
    ['a fragment', `${downloadUrl('0.2.0')}#x`],
    ['credentials in front of the host', 'https://user@github.com/arnaudcouturier/lucent/releases/download/app-v0.2.0/Lucent.exe'],
    ['a path that climbs out of the tag', 'https://github.com/arnaudcouturier/lucent/releases/download/app-v0.2.0/../app-v0.1.0/Lucent.exe'],
    ['a different letter case in the tag path', downloadUrl('0.2.0').replace('app-v', 'APP-v')],
  ])('refuses a release whose download URL points to %s', (_what, url) => {
    expect(parseAppReleases(releases(withAsset('0.2.0', { browser_download_url: url })))).toEqual([])
  })

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['fractional', 1.5],
    ['not a number', '123'],
    ['missing', undefined],
    ['over 200 MB', 200 * 1024 * 1024 + 1],
    ['beyond a safe integer', Number.MAX_SAFE_INTEGER + 1],
  ])('refuses a release whose declared size is %s', (_what, size) => {
    expect(parseAppReleases(releases(withAsset('0.2.0', { size })))).toEqual([])
  })

  it('accepts the largest size it allows', () => {
    expect(parseAppReleases(releases(withAsset('0.2.0', { size: 200 * 1024 * 1024 }))).map((r) => r.size)).toEqual([200 * 1024 * 1024])
  })

  it('keeps the first release it can trust when another carries a foreign download', () => {
    const parsed = parseAppReleases(releases(withAsset('0.3.0', { browser_download_url: 'https://example.test/Lucent.exe' }), release('0.2.0')))
    expect(announcedAppUpdate(parsed, { appVersion: '0.1.0', skipped: [], channel: 'stable' })?.version).toBe('0.2.0')
  })

  describe('release notes', () => {
    it('keeps plain hand-written notes as they are, one entry per line', () => {
      expect(withBody('Faster startup.\r\n\r\nClearer errors. Works with 2× frame generation, and with 0.3.0-beta.8.\r\n')).toEqual([
        'Faster startup.', 'Clearer errors. Works with 2× frame generation, and with 0.3.0-beta.8.',
      ])
    })

    it('reduces GitHub’s generated notes to the pull request titles', () => {
      expect(withBody([
        "## What's Changed",
        '* Add the Ember menu style by @arnaudcouturier in https://github.com/arnaudcouturier/lucent/pull/44',
        '* Fix Update on Stable in https://github.com/arnaudcouturier/lucent/pull/45',
        '',
        '**Full Changelog**: https://github.com/arnaudcouturier/lucent/compare/app-v0.3.0-beta.7...app-v0.3.0-beta.8',
      ].join('\n'))).toEqual(['Add the Ember menu style', 'Fix Update on Stable'])
    })

    it('drops the heading with a typographic apostrophe, in any case, and the changelog line in any form', () => {
      expect(withBody(['### WHAT’S CHANGED', '- Tidy the logs', 'Full Changelog: https://github.com/arnaudcouturier/lucent/compare/a...b'].join('\n'))).toEqual(['Tidy the logs'])
    })

    it('strips heading hashes, list markers and bold from hand-written notes', () => {
      expect(withBody(['# Lucent 0.3.0-beta.8', '- **ReShade screenshots go to Pictures.** They no longer land in the game folder.', '+ Plain bullet', '* *Not bold*'].join('\n'))).toEqual([
        'Lucent 0.3.0-beta.8', 'ReShade screenshots go to Pictures. They no longer land in the game folder.', 'Plain bullet', '*Not bold*',
      ])
    })

    it('shows inline code and links as their text', () => {
      expect(withBody('Screenshots go to `Pictures\\FFXIV Screenshots`; see [the guide](https://arnaudcouturier.github.io/lucent/guide.html).')).toEqual([
        'Screenshots go to Pictures\\FFXIV Screenshots; see the guide.',
      ])
    })

    it('leaves a trailing "in <address>" alone unless it is a pull request link at the end of the line', () => {
      expect(withBody(['Works in https://example.test/page today', 'Merged in https://github.com/arnaudcouturier/lucent/pull/44 yesterday'].join('\n'))).toEqual([
        'Works in https://example.test/page today', 'Merged in https://github.com/arnaudcouturier/lucent/pull/44 yesterday',
      ])
    })

    it('never leaves an empty entry behind', () => {
      expect(withBody('##\n*\n**\n---\n\n   \n')).toEqual([])
    })
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

it('does not update from a window Lucent reopened with administrator access: the new exe would not carry the player’s context', async () => {
  const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT), {
    readOnlyDirectories: [[ROOT, 'game'].join(String.fromCharCode(92))], remoteText: { [APP_RELEASES_URL]: releases(release('0.2.0')) },
  })
  const platform = createFakePlatform(m)
  const first = createCore(platform)
  await first.scan()
  await first.review()
  await first.deploy()
  expect(platform.elevationRequests).toHaveLength(1)
  m.elevated = true
  const elevated = createCore(platform)
  await elevated.scan()
  elevated.finish()
  expect(elevated.getState().appUpdate).toMatchObject({ version: '0.2.0' })
  await elevated.updateApp()
  expect(elevated.getState()).toMatchObject({ busy: false, error: null, notice: expect.stringMatching(/administrator access.*open it again to update/i) })
  expect(platform.downloads).not.toContain(downloadUrl('0.2.0'))
  expect(platform.launched).toEqual([])
})

it('still updates from a window that was merely opened as administrator by the player', async () => {
  const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT), { elevated: true, remoteText: { [APP_RELEASES_URL]: releases(release('0.2.0')) } })
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.updateApp()
  expect(platform.downloads).toContain(downloadUrl('0.2.0'))
})

describe('comparing app versions', () => {
  it('ranks beta numbers as numbers, so beta.10 follows beta.9', () => {
    expect(compareAppVersions('0.3.0-beta.10', '0.3.0-beta.9')).toBeGreaterThan(0)
    expect(compareAppVersions('0.3.0-beta.9', '0.3.0-beta.10')).toBeLessThan(0)
    expect(compareAppVersions('0.3.0-beta.10', '0.3.0-beta.10')).toBe(0)
    expect(compareAppVersions('0.3.0', '0.3.0-beta.10')).toBeGreaterThan(0)
    expect(compareAppVersions('0.3.0-beta.10', '0.2.9')).toBeGreaterThan(0)
  })
})
