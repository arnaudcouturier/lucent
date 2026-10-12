import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform } from '../platform/fake'
import { SQUARE_ENIX_UNINSTALL_KEY, machine, squareEnixLauncher, steam, steamGameFolder, vanillaGame, xivLauncher } from '../platform/fixtures'

describe('Scan finds the game folder', () => {
  it('finds the folder XIVLauncher is configured to launch', async () => {
    const core = createCore(createFakePlatform(machine(xivLauncher('C:\\Games\\FFXIV'), vanillaGame('C:\\Games\\FFXIV'))))

    await core.scan()

    expect(core.getState().gameFolder).toEqual({
      status: 'found',
      path: 'C:\\Games\\FFXIV',
      source: 'xivlauncher',
      version: '2026.09.30.0000.0000',
    })
  })

  it('rejects a configured folder that does not hold the DX11 game executable', async () => {
    const core = createCore(createFakePlatform(machine(xivLauncher('C:\\Games\\Empty'), { files: { 'C:\\Games\\Empty\\game\\ffxivgame.ver': '2026.09.30.0000.0000' } })))

    await core.scan()

    expect(core.getState().gameFolder).toEqual({ status: 'not-found' })
  })

  it("finds the game in a Steam library other than Steam's own folder", async () => {
    const core = createCore(
      createFakePlatform(machine(steam({ libraries: ['D:\\SteamLibrary'], game: 'D:\\SteamLibrary' }), vanillaGame(steamGameFolder('D:\\SteamLibrary')))),
    )

    await core.scan()

    expect(core.getState().gameFolder).toMatchObject({
      status: 'found',
      path: 'D:\\SteamLibrary\\steamapps\\common\\FINAL FANTASY XIV Online',
      source: 'steam',
    })
  })

  it("finds the game in Steam's own folder, spelled as Steam's library list spells it", async () => {
    const core = createCore(createFakePlatform(machine(steam({ steamPath: 'C:\\Games\\Steam', game: 'C:\\Games\\Steam' }), vanillaGame(steamGameFolder('C:\\Games\\Steam')))))

    await core.scan()

    expect(core.getState().gameFolder).toMatchObject({ path: 'C:\\Games\\Steam\\steamapps\\common\\FINAL FANTASY XIV Online', source: 'steam' })
  })

  it("still looks in Steam's own folder when its library list can't be read", async () => {
    const folder = steamGameFolder('C:\\Program Files (x86)\\Steam')
    const steamMachine = steam({ game: 'C:\\Program Files (x86)\\Steam' })
    delete steamMachine.files!['C:\\Program Files (x86)\\Steam\\steamapps\\libraryfolders.vdf']
    const core = createCore(createFakePlatform(machine(steamMachine, vanillaGame(folder))))

    await core.scan()

    // Only Steam's registry entry is left to go by, and Steam writes it lower-cased.
    expect(core.getState().gameFolder).toMatchObject({ path: 'c:\\program files (x86)\\steam\\steamapps\\common\\FINAL FANTASY XIV Online', source: 'steam' })
  })

  it("reads Steam's older library list, where each library is a bare path", async () => {
    const steamMachine = steam({ game: 'D:\\Old Library' })
    steamMachine.files!['C:\\Program Files (x86)\\Steam\\steamapps\\libraryfolders.vdf'] =
      '"LibraryFolders"\n{\n\t"TimeNextStatsReport"\t\t"1700000000"\n\t"1"\t\t"D:\\\\Old Library"\n}\n'
    const core = createCore(createFakePlatform(machine(steamMachine, vanillaGame(steamGameFolder('D:\\Old Library')))))

    await core.scan()

    expect(core.getState().gameFolder).toMatchObject({ path: 'D:\\Old Library\\steamapps\\common\\FINAL FANTASY XIV Online', source: 'steam' })
  })

  it("uses the folder name in Steam's app manifest", async () => {
    const folder = steamGameFolder('D:\\SteamLibrary', 'FFXIV Online')
    const core = createCore(createFakePlatform(machine(steam({ libraries: ['D:\\SteamLibrary'], game: 'D:\\SteamLibrary', installDir: 'FFXIV Online' }), vanillaGame(folder))))

    await core.scan()

    expect(core.getState().gameFolder).toMatchObject({ path: 'D:\\SteamLibrary\\steamapps\\common\\FFXIV Online', source: 'steam' })
  })

  it("finds the folder in the Square Enix launcher's uninstall entry", async () => {
    const core = createCore(createFakePlatform(machine(squareEnixLauncher('E:\\Square Enix\\FFXIV'), vanillaGame('E:\\Square Enix\\FFXIV'))))

    await core.scan()

    expect(core.getState().gameFolder).toMatchObject({ status: 'found', path: 'E:\\Square Enix\\FFXIV', source: 'square-enix' })
  })

  it("falls back to the launcher icon's path when the uninstall entry has no install location", async () => {
    const core = createCore(
      createFakePlatform(
        machine(
          { registry: { [`HKLM\\${SQUARE_ENIX_UNINSTALL_KEY}`]: { DisplayIcon: '"E:\\Square Enix\\FFXIV\\boot\\ffxivboot.exe",0' } } },
          vanillaGame('E:\\Square Enix\\FFXIV'),
        ),
      ),
    )

    await core.scan()

    expect(core.getState().gameFolder).toMatchObject({ status: 'found', path: 'E:\\Square Enix\\FFXIV', source: 'square-enix' })
  })

  it.each([
    ['the Square Enix launcher', 'C:\\Program Files (x86)\\SquareEnix\\FINAL FANTASY XIV - A Realm Reborn'],
    ['Steam', 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FINAL FANTASY XIV Online'],
  ])("finds the game at %s's default path when no launcher points to it", async (_, folder) => {
    const core = createCore(createFakePlatform(vanillaGame(folder)))

    await core.scan()

    expect(core.getState().gameFolder).toMatchObject({ status: 'found', path: folder, source: 'default' })
  })

  describe('in order: XIVLauncher, Steam, the Square Enix launcher, then default paths', () => {
    const xiv = machine(xivLauncher('C:\\Games\\FFXIV'), vanillaGame('C:\\Games\\FFXIV'))
    const steamGame = machine(steam({ libraries: ['D:\\SteamLibrary'], game: 'D:\\SteamLibrary' }), vanillaGame(steamGameFolder('D:\\SteamLibrary')))
    const squareEnix = machine(squareEnixLauncher('E:\\Square Enix\\FFXIV'), vanillaGame('E:\\Square Enix\\FFXIV'))
    const defaults = vanillaGame('C:\\Program Files (x86)\\SquareEnix\\FINAL FANTASY XIV - A Realm Reborn')

    it.each([
      ['xivlauncher', [xiv, steamGame, squareEnix, defaults]],
      ['steam', [steamGame, squareEnix, defaults]],
      ['square-enix', [squareEnix, defaults]],
      ['default', [defaults]],
    ] as const)('picks %s over the sources after it', async (source, parts) => {
      const core = createCore(createFakePlatform(machine(...parts)))

      await core.scan()

      expect(core.getState().gameFolder).toMatchObject({ status: 'found', source })
    })

    it('moves on to the next source when one points at a folder without the game', async () => {
      const core = createCore(createFakePlatform(machine(steamGame, xivLauncher('C:\\Games\\Moved away'))))

      await core.scan()

      expect(core.getState().gameFolder).toMatchObject({ status: 'found', source: 'steam' })
    })

    it("moves on to the next source when one can't be read", async () => {
      const platform = createFakePlatform(machine(xiv, steamGame))
      platform.deny('C:\\Users\\Player\\AppData\\Roaming\\XIVLauncher')
      const core = createCore(platform)

      await core.scan()

      expect(core.getState().gameFolder).toMatchObject({ status: 'found', source: 'steam' })
    })
  })

  it('asks the player to pick the folder when no source finds the game', async () => {
    const core = createCore(createFakePlatform())

    await core.scan()

    expect(core.getState().gameFolder).toEqual({ status: 'not-found' })
  })
})

describe('Scan shows the game version', () => {
  it("reads it from the game's version file", async () => {
    const core = createCore(createFakePlatform(machine(xivLauncher('C:\\Games\\FFXIV'), vanillaGame('C:\\Games\\FFXIV', '2026.10.14.0000.0001\r\n'))))

    await core.scan()

    expect(core.getState().gameFolder).toMatchObject({ version: '2026.10.14.0000.0001' })
  })

  it('still accepts the folder when the version file is missing, with no version', async () => {
    const core = createCore(createFakePlatform({ files: { 'C:\\Program Files (x86)\\SquareEnix\\FINAL FANTASY XIV - A Realm Reborn\\game\\ffxiv_dx11.exe': 'MZ' } }))

    await core.scan()

    expect(core.getState().gameFolder).toMatchObject({ status: 'found', version: null })
  })
})

describe('The state is observable', () => {
  it('reports scanning while Scan runs, and tells subscribers about each change', async () => {
    const platform = createFakePlatform(machine(xivLauncher('C:\\Games\\FFXIV'), vanillaGame('C:\\Games\\FFXIV')))
    const core = createCore(platform)
    const seen: string[] = []
    const unsubscribe = core.subscribe(() => seen.push(core.getState().gameFolder.status))

    platform.hold()
    const scanning = core.scan()
    expect(core.getState().gameFolder).toEqual({ status: 'scanning' })
    platform.release()
    await scanning
    unsubscribe()
    await core.scan()

    expect(seen).toEqual(['scanning', 'found'])
  })
})

describe('The player picks the game folder', () => {
  it('accepts a picked folder that holds the game', async () => {
    const platform = createFakePlatform(vanillaGame('F:\\XIV', '2026.10.01.0000.0000'))
    const core = createCore(platform)
    await core.scan()

    platform.answerPicker('F:\\XIV')
    await core.chooseGameFolder()

    expect(core.getState().gameFolder).toEqual({ status: 'found', path: 'F:\\XIV', source: 'picked', version: '2026.10.01.0000.0000' })
  })

  it('refuses a picked folder without the DX11 game executable and keeps the folder it had', async () => {
    const platform = createFakePlatform(machine(xivLauncher('C:\\Games\\FFXIV'), vanillaGame('C:\\Games\\FFXIV'), { files: { 'F:\\Downloads\\readme.txt': 'hi' } }))
    const core = createCore(platform)
    await core.scan()

    platform.answerPicker('F:\\Downloads')
    await core.chooseGameFolder()

    expect(core.getState()).toMatchObject({ gameFolder: { status: 'found', path: 'C:\\Games\\FFXIV' }, rejectedFolder: 'F:\\Downloads' })
  })

  it('accepts the game\'s own "game" subfolder as the game folder above it', async () => {
    const platform = createFakePlatform(vanillaGame('F:\\XIV'))
    const core = createCore(platform)

    platform.answerPicker('f:\\xiv\\game\\')
    await core.chooseGameFolder()

    expect(core.getState()).toMatchObject({ gameFolder: { status: 'found', path: 'f:\\xiv' }, rejectedFolder: null })
  })

  it('lets the player change the folder Scan found, and clears an earlier refusal', async () => {
    const platform = createFakePlatform(machine(xivLauncher('C:\\Games\\FFXIV'), vanillaGame('C:\\Games\\FFXIV'), vanillaGame('F:\\Second copy')))
    const core = createCore(platform)
    await core.scan()

    platform.answerPicker('F:\\Nowhere')
    await core.chooseGameFolder()
    platform.answerPicker('F:\\Second copy')
    await core.chooseGameFolder()

    expect(core.getState()).toMatchObject({ gameFolder: { status: 'found', path: 'F:\\Second copy', source: 'picked' }, rejectedFolder: null })
  })

  it('forgets an earlier refusal when Scan runs again', async () => {
    const platform = createFakePlatform(machine(xivLauncher('C:\\Games\\FFXIV'), vanillaGame('C:\\Games\\FFXIV')))
    const core = createCore(platform)
    platform.answerPicker('F:\\Nowhere')
    await core.chooseGameFolder()

    await core.scan()

    expect(core.getState().rejectedFolder).toBeNull()
  })

  it('changes nothing when the player cancels the picker', async () => {
    const platform = createFakePlatform(machine(xivLauncher('C:\\Games\\FFXIV'), vanillaGame('C:\\Games\\FFXIV')))
    const core = createCore(platform)
    await core.scan()
    const before = core.getState()

    platform.answerPicker(null)
    await core.chooseGameFolder()

    expect(core.getState()).toEqual(before)
  })
})
