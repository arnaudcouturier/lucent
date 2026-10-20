import { expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform } from '../platform/fake'
import { MACHINES, existingSetup, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { FIXTURE_ASSETS, PROFILE_ASSETS, PROFILE_MANIFEST, TEST_MANIFEST, fixtureUrl } from '../platform/contentFixture'
import { MANIFEST_URL } from './manifest'
import { readableBackupPath, readDeployment, replacedOriginals } from './deployment'
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

it('puts the replaced files back by default and removes the readable backup', async () => {
  const { platform, core, before } = await deployedOverExisting()
  await core.uninstall(true)
  const after = await existingFiles(platform)
  for (const [path, hash] of Object.entries(before)) expect(after[path]).toBe(hash)
  expect(core.getState().notice).toMatch(/put back/)
})
