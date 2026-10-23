import { expect, it } from 'vitest'
import { createCore } from './core'
import { PlatformError } from './platform'
import { readSettings, writeSettings } from './settings'
import { createFakePlatform, DEFAULT_ENV, type FakePlatform } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, vanillaGame } from '../platform/fixtures'

const SETTINGS = `${DEFAULT_ENV.LocalAppData}\\Lucent\\settings.json`
const STORED = { skippedContent: ['2026.11.02'], skippedApp: ['0.2.0'], channel: 'beta', launcher: 'steam', gameFolder: 'E:\\Manual XIV', lastUpdateCheck: null }

/** Makes the next `times` reads of the settings file fail the way Windows does while another program holds it. Returns what the file holds. */
function holdSettings(platform: FakePlatform, times = Infinity) {
  const readText = platform.readText.bind(platform)
  let left = times
  platform.readText = async (path) => {
    if (path.toLowerCase() === SETTINGS.toLowerCase() && left-- > 0) throw new PlatformError('locked', 'The process cannot access the file because it is being used by another process.', path)
    return readText(path)
  }
  return async () => JSON.parse(await readText(SETTINGS))
}

it('reads the settings once another program lets go of the file', async () => {
  const platform = createFakePlatform({ files: { [SETTINGS]: JSON.stringify(STORED) } })
  holdSettings(platform, 2)
  expect(await readSettings(platform)).toMatchObject({ skippedContent: ['2026.11.02'], skippedApp: ['0.2.0'], channel: 'beta', launcher: 'steam', gameFolder: 'E:\\Manual XIV' })
})

it('runs on the defaults while the file can’t be read, and never saves them over it', async () => {
  const platform = createFakePlatform({ files: { [SETTINGS]: JSON.stringify(STORED) } })
  const stored = holdSettings(platform)
  const settings = await readSettings(platform)
  expect(settings).toMatchObject({ skippedContent: [], skippedApp: [], channel: 'stable', launcher: null, gameFolder: null })
  await expect(writeSettings(platform, { ...settings, channel: 'beta' })).rejects.toThrow(/couldn’t read its settings/)
  expect(await stored()).toEqual(STORED)
})

it('replaces a damaged settings file with the defaults', async () => {
  const platform = createFakePlatform({ files: { [SETTINGS]: '{"skippedContent": [' } })
  const settings = await readSettings(platform)
  expect(settings).toMatchObject({ skippedContent: [], channel: 'stable' })
  await writeSettings(platform, { ...settings, channel: 'beta' })
  expect((await readSettings(platform)).channel).toBe('beta')
})

it('keeps the player’s skipped versions, launcher and game folder when a change is made while the file is held', async () => {
  const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), vanillaGame('C:\\Games\\XIV'), { files: { [SETTINGS]: JSON.stringify({ ...STORED, gameFolder: null }) } }))
  const core = createCore(platform)
  const stored = holdSettings(platform)
  await core.scan()
  expect(core.getState().channel).toBe('stable')
  await core.setChannel('beta')
  expect(core.getState().error).toMatch(/couldn’t read its settings/)
  expect(await stored()).toEqual({ ...STORED, gameFolder: null })
})

it('uses a folder picked while the file is held, and says the choice wasn’t saved', async () => {
  const manual = 'E:\\Manual XIV'
  const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), vanillaGame(manual), { files: { [SETTINGS]: JSON.stringify(STORED) } }))
  const core = createCore(platform)
  await core.scan()
  const stored = holdSettings(platform)
  platform.answerPicker(manual)
  await core.chooseGameFolder()
  expect(core.getState()).toMatchObject({ error: null, gameFolder: { status: 'found', path: manual }, notice: expect.stringMatching(/until you close it, but couldn’t save the choice/) })
  expect(await stored()).toEqual(STORED)
})
