import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, squareEnixLauncher, steam, steamGameFolder, SQUARE_ENIX_DEFAULT, vanillaGame, xivLauncher } from '../platform/fixtures'
import { xivLauncherConfigPath } from './xivLauncher'

const LIBRARY = 'D:\\SteamLibrary'
const STEAM_GAME = steamGameFolder(LIBRARY)

async function installXivLauncher(platform: FakePlatform) {
  const exe = `${await platform.envFolder('LocalAppData')}\\XIVLauncher\\current\\XIVLauncher.exe`
  await platform.writeText(exe, 'XIVLauncher')
  return exe
}

describe('Launch starts XIV the way this game folder is played', () => {
  it('uses XIVLauncher when it is set up for this folder, and remembers a switch to Steam', async () => {
    const m = machine(fixtureContentHost(), graphicsCard(), steam({ libraries: [LIBRARY], game: LIBRARY }), vanillaGame(STEAM_GAME), xivLauncher(STEAM_GAME))
    const platform = createFakePlatform(m)
    const exe = await installXivLauncher(platform)
    const core = createCore(platform)
    await core.scan()
    expect(core.getState()).toMatchObject({ launchOptions: [{ kind: 'xivlauncher', path: exe }, { kind: 'steam', path: null }], launcher: 'xivlauncher' })
    await core.launchGame()
    expect(platform.started).toEqual([exe])
    expect(core.getState().launching).toBe(true)
    // XIV starting ends "starting".
    m.gameRunning = true
    await core.refreshGameRunning()
    expect(core.getState().launching).toBe(false)
    m.gameRunning = false
    await core.refreshGameRunning()

    await core.setLauncher('steam')
    const reopened = createCore(platform)
    await reopened.scan()
    expect(reopened.getState().launcher).toBe('steam')
    await reopened.launchGame()
    expect(platform.started.at(-1)).toBe('steam://rungameid/39210')
  })

  it('doesn’t offer XIVLauncher set up for another game folder', async () => {
    const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), steam({ libraries: [LIBRARY], game: LIBRARY }), vanillaGame(STEAM_GAME), xivLauncher('E:\\Other XIV')))
    await installXivLauncher(platform)
    const core = createCore(platform)
    await core.scan()
    expect(core.getState()).toMatchObject({ launchOptions: [{ kind: 'steam' }], launcher: 'steam' })
  })

  it.each([null, '{}', '{broken'])('doesn’t offer an installed XIVLauncher without a readable game folder (%s)', async (config) => {
    const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), steam({ libraries: [LIBRARY], game: LIBRARY }), vanillaGame(STEAM_GAME)))
    await installXivLauncher(platform)
    if (config !== null) await platform.writeText(`${await platform.envFolder('AppData')}\\XIVLauncher\\launcherConfigV3.json`, config)
    const core = createCore(platform)
    await core.scan()
    expect(core.getState()).toMatchObject({ launchOptions: [{ kind: 'steam' }], launcher: 'steam' })
  })

  it('offers XIVLauncher and the Square Enix launcher for a copy outside Steam', async () => {
    const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), squareEnixLauncher(SQUARE_ENIX_DEFAULT), vanillaGame(SQUARE_ENIX_DEFAULT), xivLauncher(SQUARE_ENIX_DEFAULT)))
    const exe = await installXivLauncher(platform)
    const boot = `${SQUARE_ENIX_DEFAULT}\\boot\\ffxivboot.exe`
    const core = createCore(platform)
    await core.scan()
    expect(core.getState()).toMatchObject({ launchOptions: [{ kind: 'xivlauncher', path: exe }, { kind: 'official', path: boot }], launcher: 'xivlauncher' })
    await core.setLauncher('official')
    const reopened = createCore(platform)
    await reopened.scan()
    expect(reopened.getState().launcher).toBe('official')
    await reopened.launchGame()
    expect(platform.started).toEqual([boot])
  })

  it('falls back to Steam if the remembered XIVLauncher is no longer available', async () => {
    const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), steam({ libraries: [LIBRARY], game: LIBRARY }), vanillaGame(STEAM_GAME), xivLauncher(STEAM_GAME)))
    const exe = await installXivLauncher(platform)
    const core = createCore(platform)
    await core.scan()
    await core.setLauncher('steam')
    await core.setLauncher('xivlauncher')
    await platform.removeFile(exe)
    const reopened = createCore(platform)
    await reopened.scan()
    expect(reopened.getState()).toMatchObject({ launchOptions: [{ kind: 'steam' }], launcher: 'steam' })
    await reopened.launchGame()
    expect(platform.started).toEqual(['steam://rungameid/39210'])
  })

  it('rechecks XIVLauncher’s game folder before Launch and keeps its preference when that folder returns', async () => {
    const m = machine(fixtureContentHost(), graphicsCard(), steam({ libraries: [LIBRARY], game: LIBRARY }), vanillaGame(STEAM_GAME), xivLauncher(STEAM_GAME))
    const platform = createFakePlatform(m)
    const exe = await installXivLauncher(platform)
    const core = createCore(platform)
    await core.scan()
    await core.setLauncher('steam')
    await core.setLauncher('xivlauncher')
    const configPath = await xivLauncherConfigPath(platform)
    const config = JSON.parse(await platform.readText(configPath))
    await platform.writeText(configPath, JSON.stringify({ ...config, GamePath: 'E:\\Other XIV' }))
    await core.launchGame()
    expect(platform.started).toEqual(['steam://rungameid/39210'])
    expect(core.getState()).toMatchObject({ launcher: 'steam', launchOptions: [{ kind: 'steam' }] })
    m.gameRunning = true
    await core.refreshGameRunning()
    m.gameRunning = false
    await core.refreshGameRunning()
    await platform.writeText(configPath, JSON.stringify(config))
    await core.launchGame()
    expect(platform.started.at(-1)).toBe(exe)
    expect(core.getState().launcher).toBe('xivlauncher')
  })

  it('rechecks the selected executable before launching, without reopening Lucent', async () => {
    const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), steam({ libraries: [LIBRARY], game: LIBRARY }), vanillaGame(STEAM_GAME), xivLauncher(STEAM_GAME)))
    const exe = await installXivLauncher(platform)
    const core = createCore(platform)
    await core.scan()
    await platform.removeFile(exe)
    await core.launchGame()
    expect(platform.started).toEqual(['steam://rungameid/39210'])
    expect(core.getState()).toMatchObject({ launcher: 'steam', launchOptions: [{ kind: 'steam' }] })
  })

  it('does not launch after the game folder loses XIV while Lucent stays open', async () => {
    const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), steam({ libraries: [LIBRARY], game: LIBRARY }), vanillaGame(STEAM_GAME), xivLauncher(STEAM_GAME)))
    await installXivLauncher(platform)
    const core = createCore(platform)
    await core.scan()
    await platform.removeFile(`${STEAM_GAME}\\game\\ffxiv_dx11.exe`)
    await core.launchGame()
    expect(platform.started).toEqual([])
    expect(core.getState()).toMatchObject({ gameFolder: { status: 'missing', path: STEAM_GAME }, launcher: null, launchOptions: [], launching: false })
    expect(core.getState().error).toMatch(/game folder no longer contains XIV/)
  })

  it('checks whether XIV already started before opening another launcher', async () => {
    const m = machine(fixtureContentHost(), graphicsCard(), steam({ libraries: [LIBRARY], game: LIBRARY }), vanillaGame(STEAM_GAME))
    const platform = createFakePlatform(m)
    const core = createCore(platform)
    await core.scan()
    m.gameRunning = true
    await core.launchGame()
    expect(platform.started).toEqual([])
    expect(core.getState()).toMatchObject({ gameRunning: true, launching: false })
  })

  it('Scan on Home restores an unavailable launcher and discovers new launch options without restarting Lucent', async () => {
    const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), squareEnixLauncher(SQUARE_ENIX_DEFAULT), vanillaGame(SQUARE_ENIX_DEFAULT)))
    const boot = `${SQUARE_ENIX_DEFAULT}\\boot\\ffxivboot.exe`
    const core = createCore(platform)
    await core.scan()
    await core.review(false)
    await core.deploy()
    core.finish()
    await platform.removeFile(boot)
    await core.launchGame()
    expect(core.getState()).toMatchObject({ launcher: null, launchOptions: [], launching: false })
    await platform.writeText(boot, 'Restored launcher')
    await core.checkFiles()
    expect(core.getState()).toMatchObject({ launcher: 'official', launchOptions: [{ kind: 'official', path: boot }] })
    const xiv = await installXivLauncher(platform)
    await platform.writeText(await xivLauncherConfigPath(platform), JSON.stringify({ GamePath: SQUARE_ENIX_DEFAULT }))
    await core.checkFiles()
    expect(core.getState().launchOptions).toEqual([{ kind: 'xivlauncher', path: xiv }, { kind: 'official', path: boot }])
    await core.launchGame()
    expect(platform.started).toEqual([xiv])
  })

  it('uses the Square Enix launcher in the game folder for a copy outside Steam', async () => {
    const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), squareEnixLauncher(SQUARE_ENIX_DEFAULT), vanillaGame(SQUARE_ENIX_DEFAULT)))
    const boot = `${SQUARE_ENIX_DEFAULT}\\boot\\ffxivboot.exe`
    await platform.writeText(boot, 'boot')
    const core = createCore(platform)
    await core.scan()
    expect(core.getState()).toMatchObject({ launchOptions: [{ kind: 'official', path: boot }], launcher: 'official' })
    await core.launchGame()
    expect(platform.started).toEqual([boot])
  })

  it('keeps showing the launch through a game check that runs while the launcher starts, so a second click does nothing', async () => {
    const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), squareEnixLauncher(SQUARE_ENIX_DEFAULT), vanillaGame(SQUARE_ENIX_DEFAULT)))
    const boot = `${SQUARE_ENIX_DEFAULT}\\boot\\ffxivboot.exe`
    await platform.writeText(boot, 'boot')
    const core = createCore(platform)
    await core.scan()
    // The window's once-a-second game check can land while Launch is still on its way to the launcher.
    const startProgram = platform.startProgram.bind(platform)
    platform.startProgram = async (path) => { await core.refreshGameRunning(); await startProgram(path) }
    await core.launchGame()
    expect(core.getState().launching).toBe(true)
    await core.launchGame()
    expect(platform.started).toEqual([boot])
  })

  it('still launches from a window reopened with administrator access, and says XIV starts with it too', async () => {
    const m = machine(fixtureContentHost(), graphicsCard(), squareEnixLauncher(SQUARE_ENIX_DEFAULT), vanillaGame(SQUARE_ENIX_DEFAULT), { readOnlyDirectories: [`${SQUARE_ENIX_DEFAULT}\\game`] })
    const platform = createFakePlatform(m)
    const boot = `${SQUARE_ENIX_DEFAULT}\\boot\\ffxivboot.exe`
    await platform.writeText(boot, 'boot')
    const core = createCore(platform)
    await core.scan()
    await core.launchGame()
    expect(core.getState().notice).toBeNull()
    await core.review()
    await core.deploy()
    expect(platform.elevationRequests).toHaveLength(1)
    m.elevated = true
    const elevated = createCore(platform)
    await elevated.scan()
    elevated.finish()
    await elevated.launchGame()
    expect(platform.started).toEqual([boot, boot])
    expect(elevated.getState().notice).toMatch(/administrator access, so XIV starts with it too/)
  })

  it('offers nothing it can’t find, and Launch then does nothing', async () => {
    const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), squareEnixLauncher(SQUARE_ENIX_DEFAULT), vanillaGame(SQUARE_ENIX_DEFAULT)))
    await platform.removeFile(`${SQUARE_ENIX_DEFAULT}\\boot\\ffxivboot.exe`)
    const core = createCore(platform)
    await core.scan()
    expect(core.getState()).toMatchObject({ launchOptions: [], launcher: null })
    await core.launchGame()
    expect(platform.started).toEqual([])
  })
})
