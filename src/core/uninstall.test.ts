import { expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform } from '../platform/fake'
import { graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { FIXTURE_ASSETS, PROFILE_ASSETS, PROFILE_MANIFEST, TEST_MANIFEST, fixtureUrl } from '../platform/contentFixture'
import { MANIFEST_URL } from './manifest'
import { readDeployment } from './deployment'
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
  if (core.getState().profiles.length) await core.selectProfile('performance')
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
