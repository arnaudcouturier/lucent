// Open folder: the game folder in Settings, Lucent's data folder on Logs and the readable backups in the uninstall window.
// The Rust command is the boundary; the core is a second line that only passes on the folders Lucent itself shows.
import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, DEFAULT_ENV } from '../platform/fake'
import { existingSetup, fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'

const A = 'C:\\Games\\XIV'
const B = 'D:\\Second copy'
const DATA = `${DEFAULT_ENV.LocalAppData}\\Lucent`
const FAILED = 'Lucent couldn’t open that folder.'

async function deployedOnA(...extra: Parameters<typeof machine>) {
  const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), vanillaGame(A), vanillaGame(B), xivLauncher(A), ...extra))
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  return { platform, core }
}

describe('Open folder', () => {
  it('opens the game folder, the data folder and a folder in it, as the port is asked to', async () => {
    const { platform, core } = await deployedOnA(existingSetup(A, 'reshade'))
    expect(core.getState().dataFolder).toBe(DATA)
    await core.openFolder(A)
    await core.openFolder(DATA)
    await core.openFolder(`${DATA}\\Backups`)
    // The same folders, however they are spelled: Windows ignores case, and either slash names them.
    await core.openFolder('c:/games/xiv/')
    expect(platform.openedFolders).toEqual([A, DATA, `${DATA}\\Backups`, 'c:\\games\\xiv'])
    expect(core.getState().notice).toBeNull()
    expect(core.getState().error).toBeNull()
  })

  it('opens a game folder with a deployment after Change… moved to another copy, and the copy it moved to', async () => {
    const { platform, core } = await deployedOnA()
    platform.answerPicker(B)
    await core.changeGameFolder()
    expect(core.getState().gameFolder).toMatchObject({ status: 'found', path: B })
    await core.openFolder(B)
    await core.openFolder(A)
    expect(platform.openedFolders).toEqual([B, A])
  })

  it('ignores any other path: a folder Lucent doesn’t show, one inside a game folder, a look-alike and a way out', async () => {
    const { platform, core } = await deployedOnA()
    for (const path of [
      'C:\\Windows\\System32',
      DEFAULT_ENV.LocalAppData,
      `${DATA} (old)`,
      `${DATA}2`,
      `${DATA}\\..\\..\\Roaming`,
      `${DATA}\\.\\..`,
      `${A}\\game`,
      `${A}\\..\\XIV`,
      'C:\\Games',
      '\\\\server\\share',
      `\\\\?\\${A}`,
      '',
    ]) await core.openFolder(path)
    expect(platform.openedFolders).toEqual([])
    expect(core.getState().notice).toBeNull()
    expect(core.getState().error).toBeNull()
  })

  it('says plainly when Windows can’t open the folder, and stays usable', async () => {
    const { platform, core } = await deployedOnA()
    // A folder in the data folder that isn't there: the port refuses it, as Windows would.
    await core.openFolder(`${DATA}\\Backups`)
    expect(platform.openedFolders).toEqual([])
    expect(core.getState().notice).toBe(FAILED)
    expect(core.getState().error).toBeNull()
    expect(core.getState().busy).toBe(false)
    await core.openFolder(A)
    expect(platform.openedFolders).toEqual([A])
    expect(core.getState().notice).toBeNull()
  })

  it('leaves another notice alone when a folder opens', async () => {
    const { platform, core } = await deployedOnA()
    await core.checkFiles()
    const scanned = core.getState().notice
    expect(scanned).toMatch(/Everything matches/)
    await core.openFolder(A)
    expect(platform.openedFolders).toEqual([A])
    expect(core.getState().notice).toBe(scanned)
  })
})
