import { expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { gameActionsAvailable } from './gameAccess'
import { statusCard } from './statusCard'

const ROOT = 'C:\\Games\\XIV'

async function deployed() {
  const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT)))
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  return platform
}

/** Takes the whole game folder away, as deleting or moving it would; returns what it held. */
async function removeFolder(platform: FakePlatform) {
  const files: Record<string, string> = {}
  for (const relative of await platform.listFiles(ROOT)) {
    files[relative] = await platform.readText(`${ROOT}\\${relative}`)
    await platform.removeFile(`${ROOT}\\${relative}`)
  }
  return files
}

async function reopen(platform: FakePlatform) {
  const core = createCore(platform)
  await core.scan()
  return core
}

it('says the game folder is missing and offers Find it, with every game action unavailable', async () => {
  const platform = await deployed()
  await removeFolder(platform)
  const core = await reopen(platform)
  expect(core.getState().error).toBeNull()
  expect(statusCard(core.getState())).toEqual({ kind: 'folder-missing', path: ROOT })
  expect(core.getState().deployment).toMatchObject({ gameFolder: ROOT, contentVersion: '2026.10.12' })
  expect(gameActionsAvailable(core.getState())).toBe(false)
})

it('Find it restores the deployment once the folder is back', async () => {
  const platform = await deployed()
  const files = await removeFolder(platform)
  const core = await reopen(platform)
  for (const [relative, text] of Object.entries(files)) await platform.writeText(`${ROOT}\\${relative}`, text)
  await core.findGameFolder()
  expect(core.getState().error).toBeNull()
  expect(core.getState().gameFolder).toMatchObject({ status: 'found', path: ROOT })
  expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
})

it('Find it falls back to Scan and its folder picker when the folder is still gone', async () => {
  const platform = await deployed()
  await removeFolder(platform)
  const core = await reopen(platform)
  await core.findGameFolder()
  expect(core.getState()).toMatchObject({ activity: { kind: 'scan' }, gameFolder: { status: 'not-found' }, deployment: null, error: null })
  // Reopening still says the deployed folder is missing.
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'folder-missing', path: ROOT })
})

it('shows the deployment in a folder Scan finds rather than one that has gone missing', async () => {
  const platform = await deployed()
  await removeFolder(platform)
  const other = 'D:\\XIV'
  for (const [path, text] of Object.entries(vanillaGame(other).files!)) await platform.writeText(path, text)
  await platform.writeText('C:\\Users\\Player\\AppData\\Roaming\\XIVLauncher\\launcherConfigV3.json', JSON.stringify({ GamePath: other }))
  const core = await reopen(platform)
  expect(core.getState()).toMatchObject({ activity: { kind: 'scan' }, gameFolder: { status: 'found', path: other }, deployment: null })
})

it('doesn’t report a folder missing once Lucent was uninstalled from it', async () => {
  const platform = await deployed()
  const core = await reopen(platform)
  await core.uninstall()
  await removeFolder(platform)
  expect((await reopen(platform)).getState()).toMatchObject({ activity: { kind: 'scan' }, gameFolder: { status: 'not-found' }, deployment: null })
})
