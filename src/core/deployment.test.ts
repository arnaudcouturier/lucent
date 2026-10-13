import { expect, it } from 'vitest'
import { dataPaths, readDeployment } from './deployment'
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
  expect(core.getState().deployment).toMatchObject({ status: 'complete', tier: 'rtx-30-40', contentVersion: '2026.10.12', includeReShade: true, ownedConfigs: { 'ReShade.ini': '[GENERAL]\nPresetPath=\n' } })
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState().activity).toMatchObject({ kind: 'deployment', drift: null })
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
  ['AMD Radeon RX 7900 XTX', 0x1002, true, ['Insert', 'Home']],
  ['Intel Arc A770', 0x8086, true, ['Home']],
  ['NVIDIA GeForce RTX 4090', 0x10de, false, ['Insert']],
])('fits the hotkeys and required ReShade to %s', async (name, vendor, required, keys) => {
  const core = createCore(createFakePlatform(machine(deploymentMachine(), graphicsCard(name, vendor))))
  await core.scan()
  await core.review(false)
  expect(core.getState().includeReShade).toBe(required)
  await core.deploy()
  expect(core.getState().hotkeys.map((h) => h.key)).toEqual(keys)
  core.finish()
  expect(core.getState().activity).toMatchObject({ kind: 'deployment', drift: null })
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
    expect(intent.step.kind).toBe('rename')
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
  const step = state.manifest.manifest.versions[0].tiers['rtx-30-40'].recipe[0]
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
  const recipe = manifest.versions[0].tiers['rtx-30-40']
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
