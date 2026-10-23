import { expect, it } from 'vitest'
import { createCore } from './core'
import { dataPaths, readDeployment } from './deployment'
import { MANIFEST_URL } from './manifest'
import { readSettings } from './settings'
import { statusCard } from './statusCard'
import { createFakePlatform, DEFAULT_ENV, type FakePlatform, type Machine } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { NEXT_CONTENT, NEXT_MANIFEST, OPTISCALER_HASH, OPTISCALER_NEXT_HASH } from '../platform/contentFixture'
import type { ContentVersion } from '../shared/manifest'
import { PlatformError } from './platform'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`
const FIRST = NEXT_MANIFEST.versions[0]
const TUNED_RESHADE = '; Tuned before updates\n[GENERAL]\nPresetPath=reshade-presets/Mine.ini\n'

async function deployed() {
  const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))
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

async function publish(m: Machine, id: string, text: string, previous: ContentVersion[] = [FIRST]) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const version: ContentVersion = {
    ...NEXT_CONTENT, id, changelog: [`Content ${id}.`],
    files: [...NEXT_CONTENT.files.filter((f) => f.sha256 !== OPTISCALER_NEXT_HASH), { sha256: hash, size: text.length, release: `content-${id}` }],
    tiers: Object.fromEntries(Object.entries(NEXT_CONTENT.tiers).map(([tier, recipe]) => [tier, {
      ...recipe, recipe: recipe.recipe.map((s) => s.kind === 'copy' && s.file === OPTISCALER_NEXT_HASH ? { ...s, file: hash } : s),
    }])),
  }
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...NEXT_MANIFEST, versions: [...previous, version] })
  m.remoteText![`https://github.com/arnaudcouturier/lucent/releases/download/content-${id}/${hash}`] = text
  return version
}

function replaceReShadeOn(m: Machine, versions: ContentVersion[]): ContentVersion[] {
  const changed = versions.map((version) => {
    const recipe = version.tiers['rtx-20-30-40']
    return { ...version, tiers: { ...version.tiers, 'rtx-20-30-40': {
      ...recipe,
      ownedConfigs: recipe.ownedConfigs.map((config) => config.path === 'ReShade.ini' ? { ...config, update: 'replace' as const } : config),
    } } }
  })
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...NEXT_MANIFEST, versions: changed })
  return changed
}

it('updates twice, then rolls back without downloads, pins the target, skips the version left behind, and announces a newer version', async () => {
  const { platform, core: first, m } = await deployed()
  await first.setEnabled(false)
  const second = await publish(m, '2026.11.02', 'Second OptiScaler')
  await (await reopen(platform)).update()
  const third = await publish(m, '2026.11.20', 'Third OptiScaler', [FIRST, second])
  await (await reopen(platform)).update()
  await publish(m, '2026.12.01', 'Fourth OptiScaler', [FIRST, second, third])
  const core = await reopen(platform)
  expect(core.getState().versions.filter((v) => v.cached).map((v) => v.id)).toEqual(['2026.11.20', '2026.11.02', '2026.10.12'])
  await platform.writeText(`${GAME}\\ReShade.ini`, '[GENERAL]\nPresetPath=reshade-presets/Example.ini\n')
  const downloads = platform.downloads.length
  await core.applyVersion('2026.10.12')
  expect(core.getState().error).toBeNull()
  expect(platform.downloads.length).toBe(downloads)
  expect(await platform.readText(`${GAME}\\winmm.dll.disabled`)).toBe('OptiScaler')
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toContain('PresetPath=reshade-presets/Example.ini')
  expect(core.getState()).toMatchObject({ selectedProfile: 'fidelity', deployment: { contentVersion: '2026.10.12', enabled: false } })
  expect(core.getState().versions.find((v) => v.current)).toMatchObject({ id: '2026.10.12', pinned: true })
  expect((await readSettings(platform)).skippedContent).toContain('2026.11.20')
  expect(statusCard(core.getState())).toMatchObject({ kind: 'update', version: '2026.12.01' })
  expect((await reopen(platform)).getState().versions.find((v) => v.current)?.pinned).toBe(true)
})

it('keeps journaled config history for multi-hop rollback', async () => {
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\ReShade.ini`, TUNED_RESHADE)
  const second = await publish(m, '2026.11.02', 'Second OptiScaler')
  const [firstWithReplace, secondWithReplace] = replaceReShadeOn(m, [FIRST, second])
  await (await reopen(platform)).update()
  const third = await publish(m, '2026.11.20', 'Third OptiScaler', [firstWithReplace, secondWithReplace])
  replaceReShadeOn(m, [firstWithReplace, secondWithReplace, third])
  await (await reopen(platform)).update()

  const rolledToSecond = await reopen(platform)
  await rolledToSecond.applyVersion(second.id)
  expect(rolledToSecond.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).not.toBe(TUNED_RESHADE)

  const rolledToFirst = await reopen(platform)
  await rolledToFirst.applyVersion(FIRST.id)
  expect(rolledToFirst.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe(TUNED_RESHADE)
})

it('keeps the current content and two previous versions, prunes older assets, and retains shared files', async () => {
  const { platform, m } = await deployed()
  const second = await publish(m, '2026.11.02', 'Second OptiScaler')
  await (await reopen(platform)).update()
  const third = await publish(m, '2026.11.20', 'Third OptiScaler', [FIRST, second])
  await (await reopen(platform)).update()
  const fourth = await publish(m, '2026.12.01', 'Fourth OptiScaler', [FIRST, second, third])
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(core.getState().versions.filter((v) => v.cached).map((v) => v.id)).toEqual(['2026.12.01', '2026.11.20', '2026.11.02'])
  const cache = (await dataPaths(platform, ROOT)).cache
  expect(await platform.listFiles(cache)).not.toContain(OPTISCALER_HASH)
  expect(await platform.readText(`${cache}\\${second.files.at(-1)!.sha256}`)).toBe('Second OptiScaler')
  expect(await platform.readText(`${cache}\\${fourth.files.at(-1)!.sha256}`)).toBe('Fourth OptiScaler')
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toContain('PresetPath=')
})

it('removes what an interrupted download left in the cache once it is an hour old, and nothing else', async () => {
  const { platform } = await deployed()
  const cache = (await dataPaths(platform, ROOT)).cache
  for (const name of ['.tmpAb12Cd', '.tmpEf34Gh', 'notes.txt']) await platform.writeText(`${cache}\\${name}`, 'partial')
  platform.setModifiedTime(`${cache}\\.tmpAb12Cd`, Date.now() - 2 * 60 * 60 * 1000)
  // Another Lucent may still be writing this one.
  platform.setModifiedTime(`${cache}\\.tmpEf34Gh`, Date.now() - 5 * 60 * 1000)
  platform.setModifiedTime(`${cache}\\notes.txt`, Date.now() - 2 * 60 * 60 * 1000)
  await reopen(platform)
  const left = await platform.listFiles(cache)
  expect(left).not.toContain('.tmpab12cd')
  expect(left).toEqual(expect.arrayContaining(['.tmpef34gh', 'notes.txt', OPTISCALER_HASH]))
})

it('applies a skipped version and another channel version from the list, downloading only missing files', async () => {
  const { platform, m } = await deployed()
  const second = await publish(m, '2026.11.02', 'Second OptiScaler')
  const core = await reopen(platform)
  await core.skipUpdate()
  expect(core.getState().versions.find((v) => v.id === second.id)).toMatchObject({ skipped: true, cached: false, downloadSize: 17 })
  const downloads = platform.downloads.length
  await core.applyVersion(second.id)
  expect(core.getState().error).toBeNull()
  expect(platform.downloads.slice(downloads)).toEqual([`https://github.com/arnaudcouturier/lucent/releases/download/content-2026.11.02/${second.files.at(-1)!.sha256}`])
  expect(core.getState().versions.find((v) => v.current)).toMatchObject({ id: second.id, skipped: false, pinned: false })
  const third = await publish(m, '2026.11.20', 'Third OptiScaler', [FIRST, second])
  const fourth = await publish(m, '2026.12.01', 'Fourth OptiScaler', [FIRST, second, third])
  const reopened = await reopen(platform)
  expect(reopened.getState().versions.map((v) => v.id)).toEqual([fourth.id, third.id, second.id, FIRST.id])
  await reopened.applyVersion(third.id)
  expect(reopened.getState().deployment?.contentVersion).toBe(third.id)
  expect(statusCard(reopened.getState())).toMatchObject({ kind: 'update', version: fourth.id })
})

it('rolls back offline using the saved recipe when the manifest no longer contains the target', async () => {
  const { platform, m } = await deployed()
  await publish(m, '2026.11.02', 'Second OptiScaler')
  await (await reopen(platform)).update()
  delete m.remoteText![MANIFEST_URL]
  const core = await reopen(platform)
  const downloads = platform.downloads.length
  expect(core.getState().manifest.status).toBe('unavailable')
  await core.applyVersion(FIRST.id)
  expect(core.getState().error).toBeNull()
  expect(platform.downloads.length).toBe(downloads)
  expect(core.getState().deployment?.contentVersion).toBe(FIRST.id)
  expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('OptiScaler')
})

it('warns only a pinned player whose content is known broken on the detected game version, and never forces a change or download', async () => {
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\ffxivgame.ver`, '2026.10.20.0000.0000')
  const broken = { ...FIRST, knownBrokenGameVersions: ['2026.10.20.0000.0000'] }
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...NEXT_MANIFEST, versions: [broken] })
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'healthy' })
  await publish(m, '2026.11.02', 'Second OptiScaler', [broken])
  await (await reopen(platform)).update()
  const downloads = platform.downloads.length
  await (await reopen(platform)).applyVersion(FIRST.id)
  const core = await reopen(platform)
  expect(core.getState().deployment).toMatchObject({ contentVersion: FIRST.id, pinned: true })
  expect(statusCard(core.getState())).toMatchObject({ kind: 'healthy', caution: expect.stringContaining('known broken on game 2026.10.20.0000.0000') })
  expect(core.getState().deployment?.contentVersion).toBe(FIRST.id)
  expect(platform.downloads.length).toBe(downloads)
})

it('refuses a rollback while XIV runs and leaves the deployment and version choice untouched', async () => {
  const { platform, m } = await deployed()
  const second = await publish(m, '2026.11.02', 'Second OptiScaler')
  const core = await reopen(platform)
  await core.update()
  platform.isGameRunning = async () => true
  await core.applyVersion(FIRST.id)
  expect(core.getState().error).toMatch(/Close XIV/)
  expect(core.getState().deployment?.contentVersion).toBe(second.id)
  expect(core.getState().versions.find((v) => v.current)?.pinned).toBe(false)
  expect((await readSettings(platform)).skippedContent).toEqual([])
})

it('restores the current deployment and does not pin or skip when a rollback fails partway', async () => {
  const { platform, m } = await deployed()
  const second = await publish(m, '2026.11.02', 'Second OptiScaler')
  const core = await reopen(platform)
  await core.update()
  const copy = platform.copyFile.bind(platform)
  let gameWrites = 0
  platform.copyFile = async (from, to, replace, staging) => {
    if (to.startsWith(`${GAME}\\`) && ++gameWrites === 2) throw new PlatformError('disk-full', 'Disk full')
    await copy(from, to, replace, staging)
  }
  await core.applyVersion(FIRST.id)
  platform.copyFile = copy
  expect(core.getState().error).toMatch(/disk space.*restored the game folder/)
  expect(core.getState()).toMatchObject({ deployment: { contentVersion: second.id, pinned: false }, recoveryRequired: false })
  expect((await readSettings(platform)).skippedContent).toEqual([])
  expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
})

it('recovers the pin and skipped version if saving settings fails after a completed rollback', async () => {
  const { platform, m } = await deployed()
  const second = await publish(m, '2026.11.02', 'Second OptiScaler')
  const core = await reopen(platform)
  await core.update()
  const write = platform.writeText.bind(platform)
  platform.writeText = async (path, text, staging) => {
    if (path.endsWith('settings.json')) throw new PlatformError('disk-full', 'Disk full')
    await write(path, text, staging)
  }
  await core.applyVersion(FIRST.id)
  expect(core.getState().error).toBeNull()
  expect(core.getState().notice).toMatch(/applied.*finish saving/)
  expect(core.getState().versions.find((v) => v.current)?.pinned).toBe(true)
  expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
  platform.writeText = write
  const reopened = await reopen(platform)
  expect(reopened.getState().error).toBeNull()
  expect(reopened.getState().versions.find((v) => v.id === second.id)?.skipped).toBe(true)
  expect((await readDeployment(platform, ROOT))?.pendingSelection).toBeUndefined()
})

it('keeps cached assets that another game folder still needs when pruning older versions', async () => {
  const { platform, m } = await deployed()
  const otherRoot = 'D:\\Games\\XIV'
  for (const [path, text] of Object.entries(vanillaGame(otherRoot).files!)) await platform.writeText(path, text)
  const config = `${DEFAULT_ENV.AppData}\\XIVLauncher\\launcherConfigV3.json`
  await platform.writeText(config, JSON.stringify({ GamePath: otherRoot }))
  const other = await reopen(platform)
  await other.review()
  await other.deploy()
  await platform.writeText(config, JSON.stringify({ GamePath: ROOT }))
  const second = await publish(m, '2026.11.02', 'Second OptiScaler')
  await (await reopen(platform)).update()
  const third = await publish(m, '2026.11.20', 'Third OptiScaler', [FIRST, second])
  await (await reopen(platform)).update()
  await publish(m, '2026.12.01', 'Fourth OptiScaler', [FIRST, second, third])
  await (await reopen(platform)).update()
  const cache = (await dataPaths(platform, ROOT)).cache
  expect(await platform.readText(`${cache}\\${OPTISCALER_HASH}`)).toBe('OptiScaler')
  expect(await platform.readText(`${otherRoot}\\game\\winmm.dll`)).toBe('OptiScaler')
})

it('shows incompatible channel versions with an explanation, excludes Beta, and refuses to apply an incompatible version', async () => {
  const { platform, m } = await deployed()
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...NEXT_MANIFEST, versions: [FIRST,
    { ...NEXT_CONTENT, id: '2026.11.02', minAppVersion: '99.0.0' },
    { ...NEXT_CONTENT, id: '2026.11.20', tiers: { radeon: NEXT_CONTENT.tiers.radeon } },
    { ...NEXT_CONTENT, id: '2026.12.01', channel: 'beta' },
  ] })
  const core = await reopen(platform)
  expect(core.getState().versions.map((v) => v.id)).toEqual(['2026.11.20', '2026.11.02', FIRST.id])
  expect(core.getState().versions.find((v) => v.id === '2026.11.02')?.unavailable).toMatch(/Update Lucent/)
  expect(core.getState().versions.find((v) => v.id === '2026.11.20')?.unavailable).toMatch(/No recipe/)
  const downloads = platform.downloads.length
  await core.applyVersion('2026.11.02')
  expect(core.getState().error).toMatch(/Update Lucent/)
  expect(core.getState().deployment?.contentVersion).toBe(FIRST.id)
  expect(platform.downloads.length).toBe(downloads)
})
