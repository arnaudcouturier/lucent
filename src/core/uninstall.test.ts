import { expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform } from '../platform/fake'
import { MACHINES, existingSetup, fixtureContentHost, graphicsCard, machine, nextContentHost, vanillaGame, xivLauncher } from '../platform/fixtures'
import { FIXTURE_ASSETS, NEXT_CONTENT, PROFILE_ASSETS, PROFILE_MANIFEST, TEST_MANIFEST, fixtureUrl } from '../platform/contentFixture'
import { MANIFEST_URL } from './manifest'
import { dataPaths, readableBackupPath, readDeployment, replacedOriginals } from './deployment'
import { PlatformError } from './platform'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`

function deploymentMachine(manifest = TEST_MANIFEST, assets = FIXTURE_ASSETS) {
  return machine(vanillaGame(ROOT), xivLauncher(ROOT), graphicsCard(), {
    remoteText: { [MANIFEST_URL]: JSON.stringify(manifest), ...Object.fromEntries(Object.entries(assets).map(([hash, text]) => [fixtureUrl(hash), text])) },
  })
}

async function snapshot(platform: FakePlatform) {
  return {
    files: Object.fromEntries(await Promise.all((await platform.listFiles(GAME)).sort().map(async (path) => [path, await platform.hashFile(`${GAME}\\${path}`)]))),
    directories: (await platform.listDirectories(GAME)).sort(),
  }
}

async function deployed(platform: FakePlatform) {
  const core = createCore(platform)
  await core.scan()
  await core.review(true)
  await core.deploy()
  core.finish()
  expect(core.getState()).toMatchObject({ error: null, activity: { kind: 'deployment' } })
  return core
}

it.each([
  ['the test content', TEST_MANIFEST, FIXTURE_ASSETS],
  ['content with performance profiles', PROFILE_MANIFEST, PROFILE_ASSETS],
])('deploying then uninstalling %s leaves a vanilla folder byte-identical and returns to Scan', async (_, manifest, assets) => {
  const platform = createFakePlatform(deploymentMachine(manifest, assets))
  const before = await snapshot(platform)
  const core = await deployed(platform)
  await core.uninstall()
  expect(await snapshot(platform)).toEqual(before)
  expect(core.getState()).toMatchObject({ error: null, busy: false, recoveryRequired: false, deployment: null, activity: { kind: 'scan' }, gameFolder: { status: 'found', path: ROOT } })
  expect(core.getState().notice).toMatch(/uninstalled/i)
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState()).toMatchObject({ deployment: null, activity: { kind: 'scan' } })
})

it('keeps user files added after the deployment, and the folders that hold them', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const before = await snapshot(platform)
  const core = await deployed(platform)
  await platform.writeText(`${GAME}\\reshade-presets\\My look.ini`, '[User]\n')
  await platform.writeText(`${GAME}\\reshade-shaders\\Shaders\\Paid.fx`, 'Paid shader')
  await core.uninstall()
  expect(core.getState().error).toBeNull()
  expect(await snapshot(platform)).toEqual({
    files: {
      ...before.files,
      // The fake folder lists paths in lower case, matching them as Windows does.
      'reshade-presets\\my look.ini': await platform.hashFile(`${GAME}\\reshade-presets\\My look.ini`),
      'reshade-shaders\\shaders\\paid.fx': await platform.hashFile(`${GAME}\\reshade-shaders\\Shaders\\Paid.fx`),
    },
    directories: [...before.directories, 'reshade-presets', 'reshade-shaders', 'reshade-shaders\\shaders'].sort(),
  })
})

it('keeps a file the player put where Disabled had moved the entry file away', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const before = await snapshot(platform)
  const core = await deployed(platform)
  await core.setEnabled(false)
  expect(core.getState().error).toBeNull()
  // Another OptiScaler, dropped in while Lucent's sits aside as winmm.dll.disabled.
  await platform.writeText(`${GAME}\\winmm.dll`, 'Another OptiScaler')
  await core.uninstall()
  expect(core.getState().error).toBeNull()
  expect(await snapshot(platform)).toEqual({ ...before, files: { ...before.files, 'winmm.dll': await platform.hashFile(`${GAME}\\winmm.dll`) } })
  expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('Another OptiScaler')
})

it('still keeps that file when the uninstall is interrupted and finished at the next start', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const before = await snapshot(platform)
  const core = await deployed(platform)
  await core.setEnabled(false)
  await platform.writeText(`${GAME}\\winmm.dll`, 'Another OptiScaler')
  // The toggle is undone first; the uninstall stops before the step that first copied winmm.dll.
  const remove = platform.removeFile.bind(platform)
  platform.removeFile = async (path) => {
    if (path.toLowerCase().endsWith('\\reshade.download')) throw new PlatformError('locked', 'Sharing violation')
    await remove(path)
  }
  await core.uninstall()
  expect(core.getState()).toMatchObject({ recoveryRequired: true })
  platform.removeFile = remove
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState()).toMatchObject({ error: null, recoveryRequired: false, deployment: null })
  expect(await snapshot(platform)).toEqual({ ...before, files: { ...before.files, 'winmm.dll': await platform.hashFile(`${GAME}\\winmm.dll`) } })
})

/** Deployed, then updated to the next version, which drops the example shader; `meanwhile` runs before the update. */
async function updatedToNext(meanwhile: (platform: FakePlatform) => Promise<void> = async () => {}) {
  const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))
  const platform = createFakePlatform(m)
  const before = await snapshot(platform)
  await deployed(platform)
  await meanwhile(platform)
  Object.assign(m.remoteText!, nextContentHost().remoteText)
  const core = createCore(platform)
  await core.scan()
  await core.update()
  expect(core.getState()).toMatchObject({ error: null, deployment: { contentVersion: NEXT_CONTENT.id } })
  return { platform, before, core }
}

const SHADER = `${GAME}\\reshade-shaders\\Shaders\\Example.fx`

it('keeps a file the player put at a path an update stopped deploying', async () => {
  const { platform, before, core } = await updatedToNext()
  await expect(platform.stat(SHADER)).rejects.toThrow(/Not found/)
  // The player brings their own shader under the name Lucent's used to have.
  await platform.writeText(SHADER, 'My own Example.fx')
  await core.uninstall()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(SHADER)).toBe('My own Example.fx')
  expect((await snapshot(platform)).files).toEqual({ ...before.files, 'reshade-shaders\\shaders\\example.fx': await platform.hashFile(SHADER) })
})

it('still removes a file that changed while it was Lucent’s, once an update has dropped it', async () => {
  // A tool rewrote the shader Lucent deployed; the update then removed it, keeping its backup in the journal.
  const { platform, before, core } = await updatedToNext((platform) => platform.writeText(SHADER, 'Rewritten by a tool'))
  await core.uninstall()
  expect(core.getState().error).toBeNull()
  expect(await snapshot(platform)).toEqual(before)
})

it('keeps a shipped preset the player edited', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const before = await snapshot(platform)
  const core = await deployed(platform)
  const preset = `${GAME}\\reshade-presets\\Example.ini`
  await platform.writeText(preset, '[My tweaks]\n')
  await core.uninstall()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(preset)).toBe('[My tweaks]\n')
  expect(await snapshot(platform)).toEqual({
    files: { ...before.files, 'reshade-presets\\example.ini': await platform.hashFile(preset) },
    directories: [...before.directories, 'reshade-presets'].sort(),
  })
})

it('removes the files the mods generated', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const before = await snapshot(platform)
  const core = await deployed(platform)
  await platform.writeText(`${GAME}\\OptiScaler.log`, 'log')
  await platform.writeText(`${GAME}\\ReShade.log`, 'log')
  await core.uninstall()
  expect(await snapshot(platform)).toEqual(before)
})

it('removes a generated folder with everything the mods wrote in it, and the folders that emptied', async () => {
  // OptiScaler's HUD-less diagnostics write a new folder of files on every run.
  const diagnostics = { ...TEST_MANIFEST, versions: TEST_MANIFEST.versions.map((v) => ({ ...v, tiers: Object.fromEntries(Object.entries(v.tiers).map(([id, tier]) =>
    [id, { ...tier, generatedFiles: [...tier.generatedFiles, { path: 'OptiScaler/hudless-diag' }] }])) })) }
  const platform = createFakePlatform(deploymentMachine(diagnostics))
  const before = await snapshot(platform)
  const core = await deployed(platform)
  await platform.writeText(`${GAME}\\OptiScaler\\hudless-diag\\20261019-205236\\cost.txt`, 'cost')
  await platform.writeText(`${GAME}\\OptiScaler\\hudless-diag\\20261019-205236\\shaders.csv`, 'shaders')
  await platform.writeText(`${GAME}\\OptiScaler\\hudless-diag\\reshade-20261019-205229\\reshade-probe.txt`, 'probe')
  await core.uninstall()
  expect(core.getState().error).toBeNull()
  expect(await snapshot(platform)).toEqual(before)
})

it('a vanilla uninstall also removes the folders an old setup left empty, but keeps the carried-over presets', async () => {
  const platform = createFakePlatform(machine(deploymentMachine(), existingSetup(ROOT, 'gshade')))
  const core = await deployed(platform)
  await core.uninstall(false)
  expect(core.getState().error).toBeNull()
  const directories = await platform.listDirectories(GAME)
  // gshade-presets held only the presets and config Lucent took over; gshade-shaders still holds a shader that was never touched.
  expect(directories.filter((directory) => directory.startsWith('gshade-presets'))).toEqual([])
  expect(directories).toContain('gshade-shaders\\shaders')
  expect(await platform.listFiles(GAME)).toEqual(expect.arrayContaining(['reshade-presets\\custom\\sunset.ini']))
})

it('removes configs the mods rewrote since the deployment', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const before = await snapshot(platform)
  const core = await deployed(platform)
  await platform.writeText(`${GAME}\\ReShade.ini`, '[GENERAL]\nPresetPath=reshade-presets\\Example.ini\n')
  await core.uninstall()
  expect(core.getState().error).toBeNull()
  expect(await snapshot(platform)).toEqual(before)
})

it('changes nothing and stays on the main screen while XIV is running', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const core = await deployed(platform)
  const before = await snapshot(platform)
  platform.isGameRunning = async () => true
  await core.uninstall()
  expect(await snapshot(platform)).toEqual(before)
  expect(core.getState()).toMatchObject({ busy: false, recoveryRequired: false, activity: { kind: 'deployment' } })
  expect(core.getState().error).toMatch(/Close XIV/)
})

it('finishes an interrupted uninstall at the next start', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const before = await snapshot(platform)
  const core = await deployed(platform)
  await platform.writeText(`${GAME}\\ReShade.ini`, '[GENERAL]\nChanged=1\n')
  const remove = platform.removeFile.bind(platform)
  let removals = 0
  platform.removeFile = async (path) => {
    if (path.startsWith(`${GAME}\\`) && ++removals === 3) throw new PlatformError('locked', 'Sharing violation')
    await remove(path)
  }
  await core.uninstall()
  expect(core.getState()).toMatchObject({ busy: false, recoveryRequired: true })
  expect(core.getState().error).toMatch(/Recovery could not finish/)
  expect((await readDeployment(platform, ROOT))?.status).toBe('applying')
  platform.removeFile = remove
  const reopened = createCore(platform)
  await reopened.scan()
  expect(await snapshot(platform)).toEqual(before)
  expect(reopened.getState()).toMatchObject({ error: null, recoveryRequired: false, deployment: null, activity: { kind: 'scan' } })
})

it('finishes when a folder it created can’t be removed, such as another program’s working folder', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const before = await snapshot(platform)
  const core = await deployed(platform)
  const removeDirectory = platform.removeDirectoryIfEmpty.bind(platform)
  platform.removeDirectoryIfEmpty = async (path) => {
    if (path.toLowerCase() === `${GAME}\\reshade-shaders`.toLowerCase()) throw new PlatformError('locked', 'Sharing violation', path)
    await removeDirectory(path)
  }
  await core.uninstall()
  expect(core.getState()).toMatchObject({ error: null, recoveryRequired: false, deployment: null })
  expect((await readDeployment(platform, ROOT))?.status).toBe('rolled-back')
  // Every file is back; only the folder that was in use stays, empty.
  expect(await snapshot(platform)).toEqual({ ...before, directories: [...before.directories, 'reshade-shaders'].sort() })
})

it('keeps a generated-file path that held a user file before the deployment', async () => {
  const platform = createFakePlatform(machine(deploymentMachine(), { files: { [`${GAME}\\ReShade.log`]: 'An earlier ReShade' } }))
  const before = await snapshot(platform)
  const core = await deployed(platform)
  await platform.writeText(`${GAME}\\OptiScaler.log`, 'log')
  await core.uninstall()
  expect(await snapshot(platform)).toEqual(before)
})

it('leaves the main screen for Scan when an uninstall cannot finish', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const core = await deployed(platform)
  const remove = platform.removeFile.bind(platform)
  platform.removeFile = async (path) => {
    if (path.startsWith(`${GAME}\\`)) throw new PlatformError('locked', 'Sharing violation')
    await remove(path)
  }
  await core.uninstall()
  expect(core.getState()).toMatchObject({ recoveryRequired: true, deployment: null, activity: { kind: 'scan' } })
  platform.removeFile = remove
  await core.scan()
  expect(core.getState().notice).toMatch(/finished uninstalling/i)
})

it('keeps a game folder the player picked when returning to Scan', async () => {
  const other = 'D:\\Games\\XIV'
  const platform = createFakePlatform(machine(deploymentMachine(), vanillaGame(other)))
  const core = createCore(platform)
  await core.scan()
  platform.answerPicker(other)
  await core.chooseGameFolder()
  await core.review(true)
  await core.deploy()
  core.finish()
  await core.uninstall()
  expect(core.getState()).toMatchObject({ error: null, activity: { kind: 'scan' }, gameFolder: { status: 'found', path: other } })
})

it('says whether uninstall put back files it had replaced', async () => {
  const vanilla = createCore(createFakePlatform(deploymentMachine()))
  await vanilla.scan()
  await vanilla.review(true)
  await vanilla.deploy()
  vanilla.finish()
  await vanilla.uninstall()
  expect(vanilla.getState().notice).toMatch(/hadn’t replaced any of your files/)

  const platform = createFakePlatform(MACHINES.existing)
  const existing = createCore(platform)
  await existing.scan()
  await existing.continueSetup()
  await existing.review(true)
  await existing.deploy()
  existing.finish()
  const replaced = replacedOriginals(existing.getState().deployment!)
  expect(replaced.length).toBeGreaterThan(0)
  await existing.uninstall()
  expect(existing.getState().notice).toMatch(new RegExp(`put back the ${replaced.length === 1 ? 'file' : `${replaced.length} files`} it had replaced`))
})

const EXISTING_ROOT = 'C:\\Games\\FFXIV'
const existingFiles = async (platform: FakePlatform) => Object.fromEntries(await Promise.all((await platform.listFiles(`${EXISTING_ROOT}\\game`)).sort().map(async (path) => [path, await platform.hashFile(`${EXISTING_ROOT}\\game\\${path}`)])))
const sameFile = (a: string, b: string) => a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase()

async function deployedOverExisting() {
  const platform = createFakePlatform(MACHINES.existing)
  const before = await existingFiles(platform)
  const core = createCore(platform)
  await core.scan()
  await core.continueSetup()
  await core.review(true)
  await core.deploy()
  core.finish()
  return { platform, core, before }
}

it('restores the game to vanilla when asked, leaving the files it replaced out and their copies in the readable backup', async () => {
  const { platform, core, before } = await deployedOverExisting()
  const replaced = replacedOriginals(core.getState().deployment!)
  expect(replaced.length).toBeGreaterThan(0)
  const folder = core.getState().deployment!.backupFolder!
  await core.uninstall(false)
  expect(core.getState()).toMatchObject({ error: null, busy: false, deployment: null, activity: { kind: 'scan' } })
  expect(core.getState().notice).toMatch(/vanilla/)
  expect(core.getState().notice).toMatch(/copies are in/)
  const after = await existingFiles(platform)
  // Every replaced original stays out; nothing else changed.
  for (const path of replaced) expect(Object.keys(after).some((p) => sameFile(p, path))).toBe(false)
  const left = Object.entries(before).filter(([path]) => !replaced.some((r) => sameFile(r, path)))
  for (const [path, hash] of left) expect(after[path]).toBe(hash)
  // Only presets carried over from the old setup are new; they are the player’s files.
  expect(Object.keys(after).filter((path) => !(path in before)).every((path) => /^reshade-presets[\\/]/i.test(path))).toBe(true)
  // The player's copies are still there, readable.
  const readable = await readableBackupPath(platform, EXISTING_ROOT, folder)
  expect((await platform.listFiles(readable)).length).toBeGreaterThan(0)
})

it('keeps the copies a vanilla uninstall left apart from a later deployment’s readable backup', async () => {
  const platform = createFakePlatform(machine(deploymentMachine(), { files: { [`${GAME}\\winmm.dll`]: 'User mod' } }))
  const first = await deployed(platform)
  const folder = first.getState().deployment!.backupFolder!
  await first.uninstall(false)
  const copies = await readableBackupPath(platform, ROOT, folder)
  expect(await platform.readText(`${copies}\\winmm.dll`)).toBe('User mod')
  // Another mod at the same path, deployed over and then put back by a default uninstall.
  await platform.writeText(`${GAME}\\winmm.dll`, 'Second mod')
  const second = await deployed(platform)
  expect(second.getState().deployment!.backupFolder).toBe(`${folder} (2)`)
  await second.uninstall()
  expect(second.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('Second mod')
  expect(await platform.readText(`${copies}\\winmm.dll`)).toBe('User mod')
  expect(await platform.stat(await readableBackupPath(platform, ROOT, `${folder} (2)`)).then(() => true, () => false)).toBe(false)
})

it('keeps an edited shipped preset where an old setup’s preset was, which stays under the name it was carried to', async () => {
  const { platform, core } = await deployedOverExisting()
  const preset = `${EXISTING_ROOT}\\game\\reshade-presets\\Example.ini`
  await platform.writeText(preset, '[My tweaks of Lucent’s example]\n')
  await core.uninstall(true)
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(preset)).toBe('[My tweaks of Lucent’s example]\n')
  expect(await platform.readText(`${EXISTING_ROOT}\\game\\reshade-presets\\Example (previous).ini`)).toBe('[My example edits]\n')
})

it('leaves the readable backup alone when Lucent’s Backups folder can’t be listed as a plain folder', async () => {
  const { platform, core } = await deployedOverExisting()
  const backups = (await dataPaths(platform, EXISTING_ROOT)).readableBackups
  const copies = await readableBackupPath(platform, EXISTING_ROOT, core.getState().deployment!.backupFolder!)
  const kept = await platform.listFiles(copies)
  // The real port refuses to list a junction or symbolic link: a Backups folder swapped for one to another folder is never emptied.
  const list = platform.listFiles.bind(platform)
  platform.listFiles = async (root) => {
    if (root.toLowerCase() === backups.toLowerCase()) throw new PlatformError('access-denied', 'A path contains a junction or symbolic link', root)
    return list(root)
  }
  await core.uninstall(true)
  expect(core.getState()).toMatchObject({ error: null, deployment: null })
  expect(await list(copies)).toEqual(kept)
})

it('puts the replaced files back by default and removes the readable backup', async () => {
  const { platform, core, before } = await deployedOverExisting()
  await core.uninstall(true)
  const after = await existingFiles(platform)
  for (const [path, hash] of Object.entries(before)) expect(after[path]).toBe(hash)
  expect(core.getState().notice).toMatch(/put back/)
})
