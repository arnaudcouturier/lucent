import { expect, it } from 'vitest'
import { createCore } from './core'
import { readDeployment } from './deployment'
import { createFakePlatform } from '../platform/fake'
import { existingSetup, fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { PlatformError } from './platform'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`

it('resets tuned configs from prefilled choices, keeps Disabled, and makes a readable backup', async () => {
  const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT)))
  const core = createCore(platform)
  await core.scan()
  await core.continueSetup()
  const before = core.getState()
  const profile = before.selectedProfile
  const frameGeneration = before.frameGenerationMode
  const hdr = before.hdrMode
  await core.review()
  await core.deploy()
  core.finish()
  await core.setEnabled(false)
  await platform.writeText(`${GAME}\\OptiScaler.ini`, '[Upscalers]\nDx11Upscaler=player-choice\n')

  const reset = createCore(platform)
  await reset.scan()
  const originalPath = reset.getState().resetBackupPath
  expect(originalPath).toContain('Backups')
  await reset.resetSetup()
  expect(reset.getState().resetBackupPath).toBe(originalPath)
  expect(reset.getState()).toMatchObject({ activity: { kind: 'profile' }, setupMode: 'reset', selectedProfile: profile, frameGenerationMode: frameGeneration, hdrMode: hdr })
  await reset.review()
  await reset.deploy()
  expect(reset.getState().error).toBeNull()
  expect(reset.getState().deployment?.enabled).toBe(false)
  expect(await platform.readText(`${GAME}\\OptiScaler.ini`)).not.toContain('player-choice')
  const backupPath = originalPath!
  expect(await platform.readText(`${backupPath}\\OptiScaler.ini`)).toContain('player-choice')

  await reset.finish()
  await reset.uninstall()
  expect(await platform.listFiles(GAME)).toEqual(['ffxiv_dx11.exe', 'ffxivgame.ver'])
  expect(await readDeployment(platform, ROOT)).toMatchObject({ status: 'rolled-back' })
})

it('gives repeated Resets separate readable backups and preserves the uninstall history', async () => {
  const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT)))
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()

  await core.resetSetup()
  const firstBackup = core.getState().resetBackupPath!
  await core.review()
  await core.deploy()
  core.finish()
  await platform.writeText(`${GAME}\\OptiScaler.ini`, '[Upscalers]\nDx11Upscaler=second-choice\n')

  await core.resetSetup()
  const secondBackup = core.getState().resetBackupPath!
  expect(secondBackup).not.toBe(firstBackup)
  await core.review()
  await core.deploy()
  expect(await platform.readText(`${secondBackup}\\OptiScaler.ini`)).toContain('second-choice')
  expect(await platform.stat(firstBackup).then(() => true, () => false)).toBe(true)

  await core.finish()
  await core.uninstall()
  expect(await platform.listFiles(GAME)).toEqual(['ffxiv_dx11.exe', 'ffxivgame.ver'])
})

it('restores an existing OptiScaler setup after Reset and uninstall', async () => {
  const platform = createFakePlatform(machine(
    fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT), existingSetup(ROOT, 'optiscaler'),
  ))
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  await core.resetSetup()
  await core.review()
  await core.deploy()
  await core.finish()
  await core.uninstall()

  expect(await platform.readText(`${GAME}\\OptiScaler.ini`)).toBe('[Upscalers]\nDx11Upscaler=fsr22\n')
  expect(await platform.readText(`${GAME}\\OptiScaler.log`)).toBe('old log')
  expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('Older OptiScaler')
  expect(await platform.readText(`${GAME}\\nvngx.dll`)).toBe('Spoofer')
})

it('reports a locked Reset file and leaves the setup recoverable', async () => {
  const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT)))
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  await core.resetSetup()
  await core.review()

  const configPath = `${GAME}\\OptiScaler.ini`.toLowerCase()
  const copyFile = platform.copyFile.bind(platform)
  let locked = true
  platform.copyFile = async (from, to, replace, staging) => {
    if (locked && to.toLowerCase() === configPath) {
      locked = false
      throw new PlatformError('locked', 'Sharing violation', to)
    }
    await copyFile(from, to, replace, staging)
  }
  await core.deploy()

  expect(core.getState().error).toMatch(/file is in use/i)
  expect(core.getState().recoveryRequired).toBe(false)
  expect(core.getState().activity.kind).toBe('review')
  expect(await platform.readText(`${GAME}\\OptiScaler.ini`)).not.toContain('second-choice')
})
