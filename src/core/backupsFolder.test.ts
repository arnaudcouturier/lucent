// Settings' Backups row: the folder of readable copies, shown only while it holds one, and opened through Open folder.
import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, DEFAULT_ENV } from '../platform/fake'
import { existingSetup, fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'

const ROOT = 'C:\\Games\\XIV'
const BACKUPS = `${DEFAULT_ENV.LocalAppData}\\Lucent\\Backups`

async function deployed(...extra: Parameters<typeof machine>) {
  const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT), ...extra))
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  expect(core.getState()).toMatchObject({ error: null, activity: { kind: 'deployment' } })
  return { platform, core }
}

describe('Backups row', () => {
  it('has no folder before Lucent has copied anything', async () => {
    const core = createCore(createFakePlatform(machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))))
    await core.refreshBackupsFolder()
    expect(core.getState().backupsFolder).toBeNull()
  })

  it('has none after a first install over a vanilla game, which replaces no file', async () => {
    const { core } = await deployed()
    await core.refreshBackupsFolder()
    expect(core.getState().backupsFolder).toBeNull()
  })

  it('names the folder after a first install over an existing setup, and Open folder opens it', async () => {
    const { platform, core } = await deployed(existingSetup(ROOT, 'reshade'))
    await core.refreshBackupsFolder()
    expect(core.getState().backupsFolder).toBe(BACKUPS)
    await core.openFolder(core.getState().backupsFolder!)
    expect(platform.openedFolders).toEqual([BACKUPS])
    expect(core.getState().notice).toBeNull()
  })

  it('shows a Reset’s copy even when no first-install copy is left', async () => {
    const { platform, core } = await deployed()
    await platform.writeText(`${BACKUPS}\\XIV - Reset 2026-10-20T10-00-00-000\\game\\ReShade.ini`, '[GENERAL]\n')
    await core.refreshBackupsFolder()
    expect(core.getState().backupsFolder).toBe(BACKUPS)
  })

  it('goes once an Uninstall that puts the files back has removed the copies', async () => {
    const { core } = await deployed(existingSetup(ROOT, 'reshade'))
    await core.refreshBackupsFolder()
    expect(core.getState().backupsFolder).toBe(BACKUPS)
    await core.uninstall()
    await core.refreshBackupsFolder()
    expect(core.getState().backupsFolder).toBeNull()
  })

  it('stays after a vanilla Uninstall, which keeps the copies, with no deployment left', async () => {
    const { core } = await deployed(existingSetup(ROOT, 'reshade'))
    await core.uninstall(false)
    expect(core.getState().deployment).toBeNull()
    await core.refreshBackupsFolder()
    expect(core.getState().backupsFolder).toBe(BACKUPS)
  })
})
