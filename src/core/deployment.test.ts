import { expect, it } from 'vitest'
import { dataPaths, originalHashes, readDeployment, replacedOriginals, uninstallDeployment, type JournalEntry } from './deployment'
import { createCore } from './core'
import { createFakePlatform } from '../platform/fake'
import { graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { TEST_MANIFEST, FIXTURE_ASSETS, fixtureUrl, OPTISCALER_HASH, RESHADE_HASH, PRESET_HASH } from '../platform/contentFixture'
import { MANIFEST_URL } from './manifest'
import { PlatformError } from './platform'

const ROOT = 'C:\\Games\\XIV'
export function deploymentMachine() {
  return machine(vanillaGame(ROOT), xivLauncher(ROOT), graphicsCard(), {
    remoteText: { [MANIFEST_URL]: JSON.stringify(TEST_MANIFEST), ...Object.fromEntries(Object.entries(FIXTURE_ASSETS).map(([hash, text]) => [fixtureUrl(hash), text])) },
  })
}

it('deploys a vanilla folder, reports the plan numbers and stores a complete record', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const core = createCore(platform)
  await core.scan()
  await core.review()
  expect(core.getState().plan?.counts).toEqual({ added: 5, backedUp: 0, downloads: 5 })
  expect(core.getState().plan?.downloadSize).toBe(51)
  await core.deploy()
  expect(core.getState().activity.kind).toBe('done')
  expect(await platform.readText(`${ROOT}\\game\\winmm.dll`)).toBe('OptiScaler')
  expect(await platform.readText(`${ROOT}\\game\\ReShade64.dll`)).toBe('ReShade')
  expect(await platform.readText(`${ROOT}\\game\\ReShade.ini`)).toBe('[GENERAL]\nPresetPath=\n')
  expect(core.getState().deployment).toMatchObject({ status: 'complete', tier: 'rtx-20-30-40', contentVersion: '2026.10.12', includeReShade: true })
  // Config files belong to the player: the record keeps no copy of what Lucent wrote.
  expect(core.getState().deployment).not.toHaveProperty('ownedConfigs')
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState().activity).toMatchObject({ kind: 'deployment', drift: null })
})

it('deploys over a read-only file in the game folder instead of failing on permissions', async () => {
  const m = deploymentMachine()
  m.files = { ...m.files, [`${ROOT}\\game\\ReShade.ini`]: '[GENERAL]\nPresetPath=old.ini\n' }
  m.readOnlyFiles = [`${ROOT}\\game\\ReShade.ini`]
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  expect(core.getState()).toMatchObject({ error: null, activity: { kind: 'done' } })
  expect(await platform.readText(`${ROOT}\\game\\ReShade.ini`)).toBe('[GENERAL]\nPresetPath=\n')
  await core.finish()
  await core.uninstall()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${ROOT}\\game\\ReShade.ini`)).toBe('[GENERAL]\nPresetPath=old.ini\n')
})

it('a wrong download hash never reaches the game folder, even after earlier downloads pass', async () => {
  const m = deploymentMachine()
  const lastHash = Object.keys(FIXTURE_ASSETS).at(-1)!
  m.remoteText![fixtureUrl(lastHash)] = 'Wrong!'
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  const before = await platform.listFiles(`${ROOT}\\game`)
  await core.review()
  await core.deploy()
  expect(core.getState().error).toMatch(/hash check/)
  expect(await platform.listFiles(`${ROOT}\\game`)).toEqual(before)
  expect(core.getState().deployment).toBeNull()
})

it('verified cached files are omitted from Review and never downloaded again', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const paths = await dataPaths(platform, ROOT)
  await platform.writeText(`${paths.cache}\\${OPTISCALER_HASH}`, 'OptiScaler')
  const core = createCore(platform)
  await core.scan()
  await core.review()
  expect(core.getState().plan?.counts.downloads).toBe(4)
  expect(core.getState().plan?.downloadSize).toBe(41)
  await core.deploy()
  expect(core.getState().activity.kind).toBe('done')
  expect(platform.downloads).not.toContain(fixtureUrl(OPTISCALER_HASH))
})

it('rejects a corrupt cache entry and downloads a fresh verified file', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const paths = await dataPaths(platform, ROOT)
  await platform.writeText(`${paths.cache}\\${OPTISCALER_HASH}`, '0123456789')
  const core = createCore(platform)
  await core.scan()
  await core.review(false)
  expect(core.getState().plan?.downloadSize).toBe(10)
  await core.deploy()
  expect(await platform.readText(`${ROOT}\\game\\winmm.dll`)).toBe('OptiScaler')
  expect(platform.downloads).toEqual([fixtureUrl(OPTISCALER_HASH)])
})

it('lists an unclaimed file in Scan, backs it up readably, replaces it, and brings it back on uninstall', async () => {
  const platform = createFakePlatform(machine(deploymentMachine(), { files: { [`${ROOT}\\game\\winmm.dll`]: 'User mod', [`${ROOT}\\game\\reshade-shaders\\Paid.fx`]: 'Paid shader' } }))
  const core = createCore(platform)
  await core.scan()
  const readable = `${(await dataPaths(platform, ROOT)).readableBackups}\\XIV\\game`
  expect(core.getState().folderChanges).toEqual({ backupFolder: readable, backedUp: [{ path: 'winmm.dll', removed: false }], carried: [] })
  await core.review()
  expect(core.getState().plan).toMatchObject({ unclaimedPaths: ['winmm.dll'], filesToBackup: ['winmm.dll'] })
  await core.deploy()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${ROOT}\\game\\winmm.dll`)).toBe('OptiScaler')
  expect(await platform.readText(`${readable}\\winmm.dll`)).toBe('User mod')
  expect(await platform.readText(`${ROOT}\\game\\reshade-shaders\\Paid.fx`)).toBe('Paid shader')
  expect(core.getState().deployment?.backupFolder).toBe('XIV')
  core.finish()
  await core.uninstall()
  expect(await platform.readText(`${ROOT}\\game\\winmm.dll`)).toBe('User mod')
  expect(await platform.stat(readable).then(() => true, () => false)).toBe(false)
})

it.each(['after Scan', 'after Review'])('requires another Scan for a user file that appears %s', async (when) => {
  const platform = createFakePlatform(deploymentMachine())
  const core = createCore(platform)
  await core.scan()
  if (when === 'after Review') await core.review(false)
  await platform.writeText(`${ROOT}\\game\\winmm.dll`, 'Unreviewed user file')
  if (when === 'after Scan') await core.review(false)
  else await core.deploy()
  expect(core.getState()).toMatchObject({ activity: { kind: 'scan' }, plan: null, deployment: null, recoveryRequired: false })
  expect(core.getState().error).toMatch(/winmm.dll.*Run Scan again/)
  expect(await platform.readText(`${ROOT}\\game\\winmm.dll`)).toBe('Unreviewed user file')
  expect(platform.downloads).toHaveLength(0)
  expect(await readDeployment(platform, ROOT)).toBeNull()
  // Retrying Review cannot silently acknowledge the new file. Scan must show it first.
  await core.review(false)
  expect(core.getState().activity.kind).toBe('scan')
  await core.scan()
  expect(core.getState().folderChanges?.backedUp).toContainEqual({ path: 'winmm.dll', removed: false })
  await core.review(false)
  await core.deploy()
  expect(core.getState()).toMatchObject({ error: null, activity: { kind: 'done' } })
  expect(await platform.readText(`${ROOT}\\game\\winmm.dll`)).toBe('OptiScaler')
})

it('requires another Scan for a newly detected setup even when its files are only removed', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const core = createCore(platform)
  await core.scan()
  await core.review(false)
  await platform.writeText(`${ROOT}\\game\\dxgi.dll`, 'New ReShade')
  await platform.writeText(`${ROOT}\\game\\ReShade.ini`, '[GENERAL]\n')
  await core.deploy()
  expect(core.getState()).toMatchObject({ activity: { kind: 'scan' }, plan: null, deployment: null })
  expect(core.getState().error).toMatch(/dxgi.dll.*Run Scan again/)
  expect(await platform.readText(`${ROOT}\\game\\dxgi.dll`)).toBe('New ReShade')
  expect(platform.downloads).toHaveLength(0)
})

it('protects a user file appearing while content downloads and directs the player back to Scan', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const core = createCore(platform)
  await core.scan()
  await core.review(false)
  const download = platform.downloadFile.bind(platform)
  platform.downloadFile = async (url, to, progress) => {
    await download(url, to, progress)
    await platform.writeText(`${ROOT}\\game\\winmm.dll`, 'Arrived during download')
  }
  await core.deploy()
  expect(core.getState()).toMatchObject({ activity: { kind: 'scan' }, plan: null, recoveryRequired: false })
  expect(core.getState().error).toMatch(/Run Scan again/)
  expect(await platform.readText(`${ROOT}\\game\\winmm.dll`)).toBe('Arrived during download')
  expect((await readDeployment(platform, ROOT))?.status).toBe('rolled-back')
})

it('still refuses an update that would replace a file no Scan has listed', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  await platform.removeFile(`${ROOT}\\game\\ReShade64.dll`)
  await platform.writeText(`${ROOT}\\game\\ReShade64.dll`, 'Theirs')
  const record = (await readDeployment(platform, ROOT))!
  delete (record.files as Record<string, unknown>)['ReShade64.dll']
  await platform.writeText((await dataPaths(platform, ROOT)).record, JSON.stringify(record))
  const content = TEST_MANIFEST.versions[0]
  const { updateDeployment } = await import('./deployment')
  await expect(updateDeployment(platform, ROOT, content, TEST_MANIFEST.tiers[1], { kind: 'github' }, () => {})).rejects.toThrow(/user files would be replaced: ReShade64.dll/)
  expect(await platform.readText(`${ROOT}\\game\\ReShade64.dll`)).toBe('Theirs')
})

it('undoes earlier steps when a later write fails', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const copy = platform.copyFile.bind(platform)
  platform.copyFile = async (from, to, replace, staging) => {
    if (to === `${ROOT}\\game\\ReShade.ini`) throw new PlatformError('access-denied', 'Access changed after Review', to)
    await copy(from, to, replace, staging)
  }
  const core = createCore(platform)
  await core.scan()
  const before = await platform.listFiles(`${ROOT}\\game`)
  await core.review()
  await core.deploy()
  expect(core.getState().error).toMatch(/Windows denied access/)
  expect(await platform.listFiles(`${ROOT}\\game`)).toEqual(before)
})

it.each([
  ['AMD Radeon RX 7900 XTX', 0x1002, true, ['Insert', 'Page Up', 'Home']],
  ['Intel Arc A770', 0x8086, true, ['Home']],
  ['NVIDIA GeForce RTX 4090', 0x10de, false, ['Insert', 'Page Up']],
])('fits the hotkeys and required ReShade to %s', async (name, vendor, required, keys) => {
  const core = createCore(createFakePlatform(machine(deploymentMachine(), graphicsCard(name, vendor))))
  await core.scan()
  await core.review(false)
  expect(core.getState().includeReShade).toBe(required)
  await core.deploy()
  expect(core.getState().hotkeys.map((h) => h.keys!.join('+'))).toEqual(keys)
  core.finish()
  expect(core.getState().activity).toMatchObject({ kind: 'deployment', drift: null })
})

it('reads the in-game keys from the game folder, so a key changed in game shows', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  await core.refreshKeybinds()
  const menu = () => core.getState().keybinds?.find((b) => b.tool === 'ReShade' && b.action === 'Menu')
  expect(menu()).toMatchObject({ keys: ['Home'] })
  await platform.writeText(`${ROOT}\\game\\ReShade.ini`, '[GENERAL]\nPresetPath=\n[INPUT]\nKeyOverlay=113,0,1,0\n')
  await core.refreshKeybinds()
  expect(menu()).toMatchObject({ keys: ['Shift', 'F2'] })
})

it('uses the platform keyboard names on both the Done and Keys screens', async () => {
  const platform = createFakePlatform(machine(deploymentMachine(), graphicsCard('AMD Radeon RX 7900 XTX', 0x1002)))
  const lookups: number[][] = []
  platform.getKeyNames = async (codes) => {
    lookups.push(codes)
    return { 0x2d: 'Inser', 0x24: 'Accueil', 0x10: 'Maj', 0x71: 'F2' }
  }
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  expect(core.getState().hotkeys.map((binding) => binding.keys?.join('+'))).toEqual(['Inser', 'Page Up', 'Accueil'])
  expect(lookups[0]).toContain(0x2d)
  expect(lookups[0]).toContain(0x24)

  core.finish()
  await core.refreshKeybinds()
  expect(core.getState().keybinds?.find((binding) => binding.tool === 'ReShade' && binding.action === 'Menu')?.keys).toEqual(['Accueil'])

  await platform.writeText(`${ROOT}\\game\\ReShade.ini`, '[GENERAL]\nPresetPath=\n[INPUT]\nKeyOverlay=113,0,1,0\n')
  await core.refreshKeybinds()
  expect(core.getState().keybinds?.find((binding) => binding.tool === 'ReShade' && binding.action === 'Menu')).toMatchObject({ keys: ['Maj', 'F2'] })
})

it('refuses to touch the game folder while XIV runs', async () => {
  const platform = createFakePlatform(machine(deploymentMachine(), { gameRunning: true }))
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  expect(core.getState().error).toMatch(/Close XIV/)
  expect(platform.downloads).toHaveLength(0)
})

it('journals intent and its verified backup before a rename takes effect', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const originalRename = platform.renameFile.bind(platform)
  platform.renameFile = async (from, to) => {
    const record = await readDeployment(platform, ROOT)
    const intent = record!.journal.at(-1)!
    expect(intent.step?.kind).toBe('rename')
    const before = intent.before['ReShade.download']!
    const paths = await dataPaths(platform, ROOT)
    expect(await platform.readText(`${paths.backups}\\${before}`)).toBe('ReShade')
    await originalRename(from, to)
  }
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  expect(core.getState().activity.kind).toBe('done')
})

it('does not undo legacy Auto HDR transitions after the latest transition restored the player value', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  const record = (await readDeployment(platform, ROOT))!
  const exe = `${ROOT}\\game\\ffxiv_dx11.exe`
  const sid = 'S-1-5-21-1000-1000-1000-1001'
  const original = 'GpuPreference=2;AutoHDREnable=2097;'
  const disabled = 'GpuPreference=2;AutoHDREnable=2096;'
  record.journal.push(
    { registry: { kind: 'user-gpu-preferences', userSid: sid, name: exe, before: original, after: disabled }, before: {}, after: {} },
    { registry: { kind: 'user-gpu-preferences', userSid: sid, name: exe, before: disabled, after: original }, before: {}, after: {} },
  )
  await platform.writeText((await dataPaths(platform, ROOT)).record, JSON.stringify(record))
  await platform.writeUserGpuPreferences(sid, exe, disabled)
  await uninstallDeployment(platform, ROOT)
  expect(await platform.readUserGpuPreferences(sid, exe)).toBe(disabled)
})
it('recovers an unfinished journal on reopening and keeps cached assets for retry', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  const paths = await dataPaths(platform, ROOT)
  const record = await readDeployment(platform, ROOT)
  record!.status = 'applying'
  await platform.writeText(paths.record, JSON.stringify(record))
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState().activity.kind).toBe('scan')
  expect(await platform.listFiles(`${ROOT}\\game`)).toEqual(['ffxiv_dx11.exe', 'ffxivgame.ver'])
  await reopened.review()
  expect(reopened.getState().plan?.counts.downloads).toBe(0)
  const previousDownloads = [...platform.downloads]
  await reopened.deploy()
  expect(reopened.getState().activity.kind).toBe('done')
  expect(platform.downloads).toEqual(previousDownloads)
})

it('checks paths again at execution and leaves files untouched for an escaping step', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const core = createCore(platform)
  await core.scan()
  await core.review(false)
  const state = core.getState()
  if (state.manifest.status !== 'ready') throw new Error('Fixture manifest missing')
  const step = state.manifest.manifest.versions[0].tiers['rtx-20-30-40'].recipe[0]
  if (step.kind !== 'copy') throw new Error('Fixture copy step missing')
  step.to = '../outside.dll'
  await core.deploy()
  expect(core.getState().error).toMatch(/path/i)
  expect(platform.downloads).toHaveLength(0)
  expect(await platform.listFiles(`${ROOT}\\game`)).toEqual(['ffxiv_dx11.exe', 'ffxivgame.ver'])
})

it('reads local dev assets and verifies them without a remote download', async () => {
  const m = deploymentMachine()
  m.remoteText = {}
  m.devContent = { manifestPath: 'C:\\Dev\\manifest.json', filesDirectory: 'C:\\Dev\\files' }
  m.files!['C:\\Dev\\manifest.json'] = JSON.stringify(TEST_MANIFEST)
  Object.assign(m.files!, Object.fromEntries(Object.entries(FIXTURE_ASSETS).map(([hash, text]) => [`C:\\Dev\\files\\${hash}`, text])))
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  expect(core.getState().activity.kind).toBe('done')
  expect(platform.downloads).toHaveLength(0)
})

it('protects an unowned file that appears between journaling and the atomic copy', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const originalCopy = platform.copyFile.bind(platform)
  let injected = false
  platform.copyFile = async (from, to, replace) => {
    if (!injected && to.endsWith('winmm.dll')) { injected = true; await platform.writeText(to, 'User file appeared') }
    await originalCopy(from, to, replace)
  }
  const core = createCore(platform)
  await core.scan()
  await core.review(false)
  await core.deploy()
  expect(await platform.readText(`${ROOT}\\game\\winmm.dll`)).toBe('User file appeared')
  expect(core.getState().error).toBeTruthy()
  expect(core.getState().deployment).toBeNull()
})

it.each(['before removal', 'after removal'])('resumes recovery interrupted %s after undoing repeated writes to one path', async (when) => {
  const manifest = structuredClone(TEST_MANIFEST)
  const recipe = manifest.versions[0].tiers['rtx-20-30-40']
  recipe.recipe = [{ kind: 'copy', file: OPTISCALER_HASH, to: 'winmm.dll' }, { kind: 'copy', file: RESHADE_HASH, to: 'winmm.dll' }, { kind: 'copy', file: PRESET_HASH, to: 'winmm.dll' }]
  recipe.ownedConfigs = []
  recipe.shippedPresets = []
  const platform = createFakePlatform(machine(deploymentMachine(), { remoteText: { [MANIFEST_URL]: JSON.stringify(manifest) } }))
  const core = createCore(platform)
  await core.scan()
  await core.review(false)
  await core.deploy()
  expect(core.getState().activity.kind).toBe('done')
  const paths = await dataPaths(platform, ROOT)
  const record = (await readDeployment(platform, ROOT))!
  record.status = 'applying'
  await platform.writeText(paths.record, JSON.stringify(record))
  const originalRemove = platform.removeFile.bind(platform)
  let interrupted = false
  platform.removeFile = async (path) => {
    if (!interrupted && when === 'before removal' && path.endsWith('winmm.dll')) { interrupted = true; throw new Error('Simulated shutdown during recovery') }
    await originalRemove(path)
    if (!interrupted && path.endsWith('winmm.dll')) { interrupted = true; throw new Error('Simulated shutdown during recovery') }
  }
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState().error).toMatch(/Simulated shutdown/)
  await reopened.scan()
  expect(reopened.getState().error).toBeNull()
  expect((await readDeployment(platform, ROOT))!.status).toBe('rolled-back')
})

it('downloads several files at once, the largest first, and reports progress by bytes received', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const download = platform.downloadFile.bind(platform)
  const started: string[] = []
  let running = 0, most = 0
  platform.downloadFile = async (url, to, progress) => {
    started.push(url)
    most = Math.max(most, ++running)
    await new Promise((resolve) => setTimeout(resolve, 5))
    try { await download(url, to, progress) } finally { running-- }
  }
  const core = createCore(platform)
  await core.scan()
  await core.review()
  const downloading: number[] = []
  const unsubscribe = core.subscribe(() => {
    const { deploymentProgress } = core.getState()
    if (deploymentProgress?.phase === 'downloading') downloading.push(deploymentProgress.progress)
  })
  await core.deploy()
  unsubscribe()
  expect(core.getState().activity.kind).toBe('done')
  expect(most).toBeGreaterThan(1)
  const sizes = Object.fromEntries(Object.entries(FIXTURE_ASSETS).map(([hash, text]) => [fixtureUrl(hash), text.length]))
  expect(started.map((url) => sizes[url])).toEqual(started.map((url) => sizes[url]).sort((a, b) => b - a))
  expect(downloading).toEqual([...downloading].sort((a, b) => a - b))
  expect(Math.max(...downloading)).toBeLessThanOrEqual(0.4)
})

it('retries a download that failed on the network before giving up on the deployment', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const download = platform.downloadFile.bind(platform)
  const failed = new Set<string>()
  platform.downloadFile = async (url, to, progress) => {
    if (!failed.has(url)) { failed.add(url); throw new PlatformError('network', 'Connection reset') }
    return download(url, to, progress)
  }
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  expect(core.getState()).toMatchObject({ error: null, activity: { kind: 'done' } })
  expect(failed.size).toBe(Object.keys(FIXTURE_ASSETS).length)
})

it('treats a record whose file stamp is not a hash as damaged', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  const record = (await readDeployment(platform, ROOT))!
  record.files['winmm.dll'].sha256 = '..\\..\\payload'
  await platform.writeText((await dataPaths(platform, ROOT)).record, JSON.stringify(record))
  await expect(readDeployment(platform, ROOT)).rejects.toThrow(/record is damaged/)
})

it('repairs a file only from one the deployed content ships, whatever the record names', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  // A record edited to name another file, and that file waiting in the cache.
  const payload = 'Not from the content'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const paths = await dataPaths(platform, ROOT)
  await platform.writeText(`${paths.cache}\\${hash}`, payload)
  const record = (await readDeployment(platform, ROOT))!
  record.files['winmm.dll'].sha256 = hash
  await platform.writeText(paths.record, JSON.stringify(record))
  await platform.writeText(`${ROOT}\\game\\winmm.dll`, 'Patched by the game')
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState().activity).toMatchObject({ kind: 'deployment', drift: { files: ['winmm.dll'] } })
  await reopened.repair()
  expect(reopened.getState().error).toMatch(/doesn’t ship: winmm\.dll/)
  expect(await platform.readText(`${ROOT}\\game\\winmm.dll`)).toBe('Patched by the game')
})

it('reads the originals Lucent overwrote in place, and none that a takeover removed before the content wrote its own file', () => {
  const [original, written, edited] = ['a', 'b', 'c'].map((digit) => digit.repeat(64))
  const journal: JournalEntry[] = [
    { step: { kind: 'delete', path: 'nvngx_dlss.dll' }, before: { 'nvngx_dlss.dll': original }, after: { 'nvngx_dlss.dll': null } },
    { step: { kind: 'copy', file: written, to: 'NVNGX_DLSS.dll' }, before: { 'NVNGX_DLSS.dll': null }, after: { 'NVNGX_DLSS.dll': written } },
    { step: { kind: 'copy', file: written, to: 'winmm.dll' }, before: { 'winmm.dll': null }, after: { 'winmm.dll': written } },
    { step: { kind: 'copy', file: written, to: 'ReShade.ini' }, before: { 'ReShade.ini': original }, after: { 'ReShade.ini': written } },
    { step: { kind: 'copy', file: edited, to: 'RESHADE.ini' }, before: { 'RESHADE.ini': written }, after: { 'RESHADE.ini': edited } },
    { step: { kind: 'copy', file: written, to: 'winmm.dll' }, before: { 'winmm.dll': written }, after: { 'winmm.dll': written } },
  ]
  expect(originalHashes({ journal })).toEqual({ 'ReShade.ini': original })
  expect(replacedOriginals({ journal })).toEqual(['nvngx_dlss.dll', 'ReShade.ini'])
})
