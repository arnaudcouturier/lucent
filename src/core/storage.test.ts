// Settings' Storage card: what the cache and the readable copies take, and clearing each. Neither may reach what Uninstall and
// recovery restore from (the journal's own backups), and nothing may clear while Lucent is busy or needs recovery.
import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, DEFAULT_ENV, type FakePlatform } from '../platform/fake'
import { existingSetup, fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { statusCard } from './statusCard'
import { sizeLabel } from './format'
import { PlatformError } from './platform'
import { startsTicked } from './storage'
import { readDeployment, replacedOriginals } from './deployment'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`
const DATA = `${DEFAULT_ENV.LocalAppData}\\Lucent`
const CACHE = `${DATA}\\cache`
const BACKUPS = `${DATA}\\Backups`
const HASH = 'a'.repeat(64)
const RESET = 'XIV - Reset 2026-10-20T10-00-00-000'

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

/** Every file under a folder, with its text, to see what a Clear left alone. The fake lists names in lower case; the real port keeps their case. */
async function tree(platform: FakePlatform, root: string) {
  const out: Record<string, string> = {}
  for (const relative of await platform.listFiles(root)) out[relative] = await platform.readText(`${root}\\${relative}`)
  return out
}
const journalBackups = async (platform: FakePlatform) =>
  Object.fromEntries(Object.entries(await tree(platform, `${DATA}\\deployments`)).filter(([name]) => /\\backups\\/.test(name)))

describe('reading the storage', () => {
  it('has nothing before Lucent has downloaded or copied anything', async () => {
    const core = createCore(createFakePlatform(machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))))
    await core.refreshStorage()
    expect(core.getState().storage).toEqual({ cache: { path: CACHE, files: 0, bytes: 0 }, backups: { path: BACKUPS, groups: [] } })
  })

  it('sums the cache file by file', async () => {
    const { platform, core } = await deployed()
    const files = await platform.listFiles(CACHE)
    const bytes = (await platform.statMany(files.map((file) => `${CACHE}\\${file}`))).reduce((sum, stat) => sum + stat!.size, 0)
    await core.refreshStorage()
    expect(files.length).toBeGreaterThan(0)
    expect(core.getState().storage!.cache).toEqual({ path: CACHE, files: files.length, bytes })
  })

  it('counts only Lucent’s own files in the cache, which is what Clear removes', async () => {
    const { platform, core } = await deployed()
    const before = (await platform.listFiles(CACHE)).length
    await platform.writeText(`${CACHE}\\.tmp1234`, 'half a download')
    await platform.writeText(`${CACHE}\\notes.txt`, 'mine')
    await core.refreshStorage()
    expect(core.getState().storage!.cache.files).toBe(before + 1)
  })

  it('tells a live deployment’s copy from a Reset’s, the originals a vanilla Uninstall kept, and a stranger’s', async () => {
    const { platform, core } = await deployed(existingSetup(ROOT, 'reshade'))
    await platform.writeText(`${BACKUPS}\\${RESET}\\game\\ReShade.ini`, '[GENERAL]\n')
    await platform.writeText(`${BACKUPS}\\Someone else\\game\\x.ini`, 'x')
    await core.refreshStorage()
    expect(core.getState().storage!.backups.groups.map(({ folder, kind }) => [folder, kind])).toEqual([['someone else', 'other'], ['xiv', 'install'], [RESET.toLowerCase(), 'reset']])

    await core.uninstall(false)
    await core.refreshStorage()
    expect(core.getState().storage!.backups.groups.map(({ folder, kind }) => [folder, kind])).toEqual([['someone else', 'other'], ['xiv', 'kept'], [RESET.toLowerCase(), 'reset']])
  })

  it('calls the copies of a game folder that is gone the only ones left', async () => {
    const { platform, core } = await deployed(existingSetup(ROOT, 'reshade'))
    await platform.removeFile(`${GAME}\\ffxiv_dx11.exe`)
    await core.refreshStorage()
    expect(core.getState().storage!.backups.groups).toMatchObject([{ folder: 'xiv', kind: 'kept' }])
  })

  it('offers none of a deployment’s install copies as redundant while a record can’t be read; a Reset’s copy is known by its name', async () => {
    const { platform, core } = await deployed(existingSetup(ROOT, 'reshade'))
    const record = (await platform.listFiles(`${DATA}\\deployments`)).find((name) => name.endsWith('record.json'))!
    await platform.writeText(`${DATA}\\deployments\\${record}`, '{ not json')
    await platform.writeText(`${BACKUPS}\\${RESET}\\game\\ReShade.ini`, '[GENERAL]\n')
    await core.refreshStorage()
    expect(core.getState().storage!.backups.groups.map(({ folder, kind }) => [folder, kind])).toEqual([['xiv', 'other'], [RESET.toLowerCase(), 'reset']])
  })

  it('sizes each folder', async () => {
    const { platform, core } = await deployed()
    await platform.writeText(`${BACKUPS}\\Mine\\game\\a.ini`, '12345')
    await platform.writeText(`${BACKUPS}\\Mine\\game\\deeper\\b.ini`, '123')
    await core.refreshStorage()
    expect(core.getState().storage!.backups.groups).toEqual([{ folder: 'mine', kind: 'other', files: 2, bytes: 8 }])
  })
})

describe('what Clear backups ticks to start with', () => {
  it('ticks the copies the journal also holds, and leaves the only copies and the unexplained ones for the player to tick', () => {
    expect((['install', 'reset', 'kept', 'other'] as const).map((kind) => [kind, startsTicked(kind)])).toEqual([['install', true], ['reset', true], ['kept', false], ['other', false]])
  })
})

describe('Clear cache', () => {
  it('removes every cached file and says how much', async () => {
    const { platform, core } = await deployed()
    await core.refreshStorage()
    const { files, bytes } = core.getState().storage!.cache
    await core.clearCache()
    expect(await platform.listFiles(CACHE)).toEqual([])
    expect(core.getState()).toMatchObject({ error: null, busy: false, notice: `Cleared ${sizeLabel(bytes)} from the cache (${files} files).`, storage: { cache: { files: 0, bytes: 0 } } })
  })

  it('removes a download an interrupted run left, leaves a file that is not Lucent’s, and keeps the cache folder', async () => {
    const { platform, core } = await deployed()
    await platform.writeText(`${CACHE}\\.tmp1234`, 'half a download')
    await platform.writeText(`${CACHE}\\notes.txt`, 'mine')
    await core.clearCache()
    expect(await platform.listFiles(CACHE)).toEqual(['notes.txt'])
  })

  it('says so when there is nothing to clear', async () => {
    const { core } = await deployed()
    await core.clearCache()
    await core.clearCache()
    expect(core.getState().notice).toBe('There was nothing to clear from the cache.')
  })

  it('leaves the journal’s backups, the record and the game folder as they were', async () => {
    const { platform, core } = await deployed(existingSetup(ROOT, 'reshade'))
    const journal = await journalBackups(platform)
    const records = await tree(platform, `${DATA}\\deployments`)
    const game = await tree(platform, ROOT)
    expect(Object.keys(journal).length).toBeGreaterThan(0)
    await core.clearCache()
    expect(await journalBackups(platform)).toEqual(journal)
    expect(await tree(platform, `${DATA}\\deployments`)).toEqual(records)
    expect(await tree(platform, ROOT)).toEqual(game)
  })

  it('works while XIV runs, since it writes nothing to the game folder', async () => {
    const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))
    const platform = createFakePlatform(m)
    const core = createCore(platform)
    await core.scan(); await core.review(); await core.deploy(); core.finish()
    m.gameRunning = true
    await core.refreshGameRunning()
    expect(core.getState().gameRunning).toBe(true)
    await core.clearCache()
    expect(await platform.listFiles(CACHE)).toEqual([])
    expect(core.getState().error).toBeNull()
  })

  it('lets Repair download what it needs again, back to healthy', async () => {
    const { platform, core } = await deployed()
    await core.clearCache()
    await platform.removeFile(`${GAME}\\winmm.dll`)
    await platform.removeFile(`${GAME}\\ReShade64.dll`)
    const reopened = createCore(platform)
    await reopened.scan()
    const downloads = platform.downloads.length
    await reopened.repair()
    expect(statusCard(reopened.getState())).toEqual({ kind: 'healthy' })
    expect(platform.downloads.length).toBeGreaterThan(downloads)
    expect(await platform.readText(`${GAME}\\ReShade64.dll`)).toBe('ReShade')
  })

  it('lets a Reset write the setup again from downloads', async () => {
    const { platform, core } = await deployed()
    await core.clearCache()
    const downloads = platform.downloads.length
    await core.resetSetup()
    await core.review()
    await core.deploy()
    core.finish()
    expect(core.getState()).toMatchObject({ error: null, activity: { kind: 'deployment' } })
    expect(platform.downloads.length).toBeGreaterThan(downloads)
  })
})

describe('Clear backups', () => {
  it('removes only the folders named, with what they hold, and the Backups folder once none is left', async () => {
    const { platform, core } = await deployed(existingSetup(ROOT, 'reshade'))
    await platform.writeText(`${BACKUPS}\\${RESET}\\game\\deeper\\ReShade.ini`, '[GENERAL]\n')
    await core.refreshStorage()
    const install = core.getState().storage!.backups.groups.find((group) => group.folder === 'xiv')!
    await core.clearBackups([RESET])
    expect(await platform.listFiles(BACKUPS)).toEqual(expect.arrayContaining([expect.stringMatching(/^xiv\\/)]))
    expect((await platform.listFiles(BACKUPS)).some((file) => file.startsWith(RESET.toLowerCase()))).toBe(false)
    expect(core.getState()).toMatchObject({ error: null, busy: false, notice: 'Cleared 10 B from backup copies (1 file).' })
    expect(core.getState().storage!.backups.groups).toEqual([install])
    expect(core.getState().backupsFolder).toBe(BACKUPS)

    await core.clearBackups(['xiv'])
    expect(await platform.listFiles(BACKUPS)).toEqual([])
    expect(core.getState()).toMatchObject({ storage: { backups: { groups: [] } }, backupsFolder: null })
    expect(await platform.stat(BACKUPS).catch(() => null)).toBeNull()
  })

  it('ignores a name that is not one of the folders', async () => {
    const { platform, core } = await deployed(existingSetup(ROOT, 'reshade'))
    const before = await tree(platform, BACKUPS)
    await core.clearBackups(['Nothing like it', '..', '.', 'game', `XIV\\game`])
    expect(await tree(platform, BACKUPS)).toEqual(before)
    expect(core.getState().notice).toBe('There was nothing to clear from backup copies.')
  })

  it('leaves the journal’s backups, so Uninstall still puts the player’s files back', async () => {
    const { platform, core } = await deployed(existingSetup(ROOT, 'reshade'))
    const journal = await journalBackups(platform)
    await core.refreshStorage()
    await core.clearBackups(core.getState().storage!.backups.groups.map((group) => group.folder))
    await core.clearCache()
    expect(await platform.listFiles(BACKUPS)).toEqual([])
    expect(await journalBackups(platform)).toEqual(journal)
    await core.uninstall(true)
    expect(core.getState()).toMatchObject({ error: null, deployment: null })
    expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe('[GENERAL]\nPresetPath=.\\reshade-presets\\Mine.ini\n')
    expect(await platform.readText(`${GAME}\\reshade-presets\\Example.ini`)).toBe('[My example edits]\n')
  })

  it('leaves a stray file directly in Backups alone', async () => {
    const { platform, core } = await deployed(existingSetup(ROOT, 'reshade'))
    await platform.writeText(`${BACKUPS}\\readme.txt`, 'mine')
    await core.clearBackups(['XIV', 'readme.txt'])
    expect(await platform.listFiles(BACKUPS)).toEqual(['readme.txt'])
  })
})

describe('what Clear may reach', () => {
  /** A port whose listing names paths outside the folder asked about, as a swapped-in link or a bug might. */
  function lying(platform: FakePlatform, extra: string[]) {
    const list = platform.listFiles.bind(platform)
    platform.listFiles = async (root) => [...await list(root), ...(root === CACHE || root === BACKUPS ? extra : [])]
    // The fake doesn't resolve `..`, so a planted name would not exist there and drop out at the size check; the real port resolves it, so here every listed name exists.
    const stat = platform.statMany.bind(platform)
    platform.statMany = async (paths) => (await stat(paths)).map((found) => found ?? { kind: 'file' as const, size: 1, modifiedMs: 0, readOnly: false })
    const removed: string[] = []
    const remove = platform.removeMany.bind(platform)
    platform.removeMany = async (paths) => { removed.push(...paths); await remove(paths) }
    return removed
  }

  it('never passes the port a path that leaves the cache', async () => {
    const { platform, core } = await deployed()
    await platform.writeText(`${DATA}\\settings.json`, '{}')
    const removed = lying(platform, [`..\\settings.json`, `${HASH}\\..\\..\\settings.json`, `C:\\Windows\\${HASH}`, `deployments\\x\\backups\\${HASH}`, `${HASH}:stream`, `${HASH.replace(/a/, '*')}`])
    await core.clearCache()
    expect(removed.every((path) => path.startsWith(`${CACHE}\\`) && !path.includes('..') && !/[:*?"<>|]/.test(path.slice(2)))).toBe(true)
    expect(await platform.readText(`${DATA}\\settings.json`)).toBe('{}')
  })

  it('never passes the port a path that leaves Backups, such as the journal’s backups beside it', async () => {
    const { platform, core } = await deployed(existingSetup(ROOT, 'reshade'))
    const journal = await journalBackups(platform)
    const hash = Object.keys(journal)[0]
    const removed = lying(platform, [`XIV\\..\\..\\${hash}`, `..\\${hash}`, `XIV\\..\\..\\deployments\\${hash}`, `C:\\Windows\\win.ini`, `XIV\\game\\a:b`, `XIV\\\\game\\x`])
    await core.clearBackups(['XIV', '..', 'C:'])
    expect(removed.length).toBeGreaterThan(0)
    expect(removed.every((path) => path.toLowerCase().startsWith(`${BACKUPS}\\xiv\\`.toLowerCase()) && !path.includes('..') && !/[:*?"<>|]/.test(path.slice(2)))).toBe(true)
    expect(await journalBackups(platform)).toEqual(journal)
  })
})

describe('refusing', () => {
  it('says why when another process is using Lucent’s files, and removes nothing', async () => {
    const { platform, core } = await deployed(existingSetup(ROOT, 'reshade'))
    const cache = await tree(platform, CACHE)
    const backups = await tree(platform, BACKUPS)
    const token = await platform.acquireOperationLock(DATA)
    await core.clearCache()
    expect(core.getState().error).toMatch(/Another Lucent operation is using its files/)
    await core.clearBackups(['XIV'])
    await platform.releaseOperationLock(token)
    expect(await tree(platform, CACHE)).toEqual(cache)
    expect(await tree(platform, BACKUPS)).toEqual(backups)
    expect(core.getState()).toMatchObject({ busy: false, notice: null })
  })

  it('says so, rather than doing nothing, when Lucent is in the middle of another change', async () => {
    const { platform, core } = await deployed(existingSetup(ROOT, 'reshade'))
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const remove = platform.removeMany.bind(platform)
    platform.removeMany = async (paths) => { await held; await remove(paths) }
    const first = core.clearCache()
    for (let i = 0; i < 100 && !core.getState().busy; i++) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(core.getState().busy).toBe(true)
    await core.clearBackups(['XIV'])
    expect(core.getState().error).toMatch(/busy with another change/)
    release()
    await first
    expect((await platform.listFiles(BACKUPS)).length).toBeGreaterThan(0)
    expect(core.getState()).toMatchObject({ busy: false, storage: { cache: { files: 0 } } })
  })

  it('does not clear while an interrupted change waits for recovery', async () => {
    const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT), existingSetup(ROOT, 'reshade'))
    const platform = createFakePlatform(m)
    const core = createCore(platform)
    await core.scan(); await core.review(); await core.deploy(); core.finish()
    // XIV starts partway through an uninstall, which leaves the journal for recovery.
    const remove = platform.removeFile.bind(platform)
    platform.removeFile = async (path) => {
      await remove(path)
      if (path.startsWith(GAME)) m.gameRunning = true
    }
    await core.uninstall()
    platform.removeFile = remove
    expect(core.getState().recoveryRequired).toBe(true)
    const cache = await tree(platform, CACHE)
    const backups = await tree(platform, BACKUPS)
    await core.clearCache()
    expect(core.getState().error).toMatch(/needs recovering/)
    await core.clearBackups(['XIV'])
    expect(await tree(platform, CACHE)).toEqual(cache)
    expect(await tree(platform, BACKUPS)).toEqual(backups)
  })
})

describe('a vanilla Uninstall after Clear backups', () => {
  /** The files the existing setup left in `game\`, before Lucent changes anything. */
  async function withExistingSetup() {
    const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT), existingSetup(ROOT, 'reshade')))
    const originals = await tree(platform, GAME)
    const core = createCore(platform)
    await core.scan(); await core.review(); await core.deploy(); core.finish()
    expect(core.getState().error).toBeNull()
    return { platform, core, originals }
  }

  it('writes the copies again from the journal’s backups, so the files it leaves out are still readable', async () => {
    const { platform, core, originals } = await withExistingSetup()
    const replaced = replacedOriginals(core.getState().deployment!)
    expect(replaced.length).toBeGreaterThan(0)
    await core.clearBackups(['xiv'])
    expect(await platform.listFiles(BACKUPS)).toEqual([])
    await core.uninstall(false)
    expect(core.getState()).toMatchObject({ error: null, deployment: null })
    expect(core.getState().notice).toContain(`copies are in ${BACKUPS}\\XIV\\game`)
    for (const relative of replaced) expect(await platform.readText(`${BACKUPS}\\XIV\\game\\${relative}`)).toBe(originals[relative.toLowerCase()])
    // None of them came back to the game folder: it is vanilla, as that choice says.
    const left = (await platform.listFiles(GAME)).map((name) => name.toLowerCase())
    for (const relative of replaced) expect(left).not.toContain(relative.toLowerCase())
  })

  it('adds only the copies that are gone, and leaves the ones that are there', async () => {
    const { platform, core, originals } = await withExistingSetup()
    const replaced = replacedOriginals(core.getState().deployment!)
    const [gone, kept] = [replaced[0], replaced[1]]
    await platform.removeFile(`${BACKUPS}\\XIV\\game\\${gone}`)
    await platform.writeText(`${BACKUPS}\\XIV\\game\\${kept}`, 'edited by the player')
    await core.uninstall(false)
    expect(core.getState()).toMatchObject({ error: null, deployment: null })
    expect(await platform.readText(`${BACKUPS}\\XIV\\game\\${gone}`)).toBe(originals[gone.toLowerCase()])
    expect(await platform.readText(`${BACKUPS}\\XIV\\game\\${kept}`)).toBe('edited by the player')
  })

  it('still uninstalls when a journal backup is gone too, and says which originals have no copy', async () => {
    const { platform, core } = await withExistingSetup()
    const replaced = replacedOriginals(core.getState().deployment!)
    await core.clearBackups(['xiv'])
    // Only the backups of the originals: a vanilla Uninstall needs no other, but undoing the rest of the journal does.
    const record = (await readDeployment(platform, ROOT))!
    const hashes = record.journal.flatMap((entry) => Object.entries(entry.before)).filter(([path, hash]) => hash && replaced.includes(path)).map(([, hash]) => hash!)
    for (const name of (await platform.listFiles(`${DATA}\\deployments`)).filter((file) => hashes.some((hash) => file.endsWith(hash)))) await platform.removeFile(`${DATA}\\deployments\\${name}`)
    await core.uninstall(false)
    expect(core.getState()).toMatchObject({ error: null, deployment: null })
    expect(core.getState().notice).toContain(`except ${replaced.length} files whose backup in Lucent’s own folder was missing`)
    expect((await readDeployment(platform, ROOT))?.status).toBe('rolled-back')
  })

  it('writes the copies it can when only some journal backups are gone, and names the rest', async () => {
    const { platform, core, originals } = await withExistingSetup()
    const replaced = replacedOriginals(core.getState().deployment!)
    await core.clearBackups(['xiv'])
    const record = (await readDeployment(platform, ROOT))!
    const lost = replaced[0]
    const hash = record.journal.flatMap((entry) => Object.entries(entry.before)).find(([path]) => path === lost)![1]!
    await platform.removeFile(`${DATA}\\deployments\\${(await platform.listFiles(`${DATA}\\deployments`)).find((name) => name.endsWith(hash))!}`)
    await core.uninstall(false)
    expect(core.getState().notice).toContain('except 1 file whose backup in Lucent’s own folder was missing')
    for (const relative of replaced.slice(1)) expect(await platform.readText(`${BACKUPS}\\XIV\\game\\${relative}`)).toBe(originals[relative.toLowerCase()])
    expect(await platform.listFiles(BACKUPS)).not.toContain(`xiv\\game\\${lost.toLowerCase()}`)
  })

  it('stops with the game folder as it was when a copy it wrote does not match its backup, and does not keep the bad copy', async () => {
    const { platform, core } = await withExistingSetup()
    await core.clearBackups(['xiv'])
    const copy = platform.copyFile.bind(platform)
    platform.copyFile = async (from, to, replace, staging) => {
      await copy(from, to, replace, staging)
      if (to.startsWith(BACKUPS)) await platform.writeText(to, 'garbled')
    }
    const game = await tree(platform, ROOT)
    await core.uninstall(false)
    expect(core.getState().error).toMatch(/failed its hash check/)
    expect(await tree(platform, ROOT)).toEqual(game)
    // The first copy failed its check and went; none was written after it, so nothing is left to be taken for a good copy next time.
    expect(await platform.listFiles(BACKUPS)).toEqual([])
    expect((await readDeployment(platform, ROOT))?.status).toBe('complete')
  })

  it('can rely on the folder’s name staying its own: a second game folder with the same name gets another, even after the copy is cleared', async () => {
    const other = 'D:\\XIV'
    const platform = createFakePlatform(machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), vanillaGame(other), xivLauncher(ROOT), existingSetup(ROOT, 'reshade'), existingSetup(other, 'reshade')))
    const core = createCore(platform)
    await core.scan(); await core.review(); await core.deploy(); core.finish()
    await core.clearBackups(['xiv'])
    expect(await platform.listFiles(BACKUPS)).toEqual([])
    platform.answerPicker(other)
    await core.changeGameFolder()
    await core.review(); await core.deploy(); core.finish()
    expect(core.getState()).toMatchObject({ error: null, deployment: { gameFolder: other, backupFolder: 'XIV (2)' } })
  })
})

describe('a list that went stale before the player pressed Clear', () => {
  it('leaves a folder that became the only copy since it was shown, such as after a vanilla Uninstall in another window', async () => {
    const { platform, core } = await deployed(existingSetup(ROOT, 'reshade'))
    await core.refreshStorage()
    expect(core.getState().storage!.backups.groups).toMatchObject([{ folder: 'xiv', kind: 'install' }])
    // Another window uninstalls with the vanilla choice: the install copy is now all there is of the files left out.
    const other = createCore(platform)
    await other.scan()
    await other.uninstall(false)
    const before = await tree(platform, BACKUPS)
    await core.clearBackups(['xiv'])
    expect(await tree(platform, BACKUPS)).toEqual(before)
    expect(core.getState().notice).toBe('There was nothing to clear from backup copies. xiv changed since the list was shown and was left; open Clear again to see what it holds now.')
  })

  it('leaves a copy whose game folder went away while Settings was open', async () => {
    const { platform, core } = await deployed(existingSetup(ROOT, 'reshade'))
    await core.refreshStorage()
    await platform.removeFile(`${GAME}\\ffxiv_dx11.exe`)
    const before = await tree(platform, BACKUPS)
    await core.clearBackups(['xiv'])
    expect(await tree(platform, BACKUPS)).toEqual(before)
    expect(core.getState().notice).toMatch(/xiv changed since the list was shown and was left/)
  })

  it('still removes the other folders ticked with it, and a folder the player ticked knowing it was the only copy', async () => {
    const { platform, core } = await deployed(existingSetup(ROOT, 'reshade'))
    await platform.writeText(`${BACKUPS}\\${RESET}\\game\\ReShade.ini`, '[GENERAL]\n')
    await core.uninstall(false)
    await core.refreshStorage()
    expect(core.getState().storage!.backups.groups.map(({ folder, kind }) => [folder, kind])).toEqual([['xiv', 'kept'], [RESET.toLowerCase(), 'reset']])
    await core.clearBackups(['xiv', RESET.toLowerCase()])
    expect(await platform.listFiles(BACKUPS)).toEqual([])
    expect(core.getState().notice).not.toMatch(/changed since/)
  })
})

describe('a folder Lucent cannot list', () => {
  it('shows the other folder’s size, and nothing to clear for the one it can’t read', async () => {
    const { platform, core } = await deployed(existingSetup(ROOT, 'reshade'))
    const list = platform.listFiles.bind(platform)
    platform.listFiles = async (root) => { if (root === CACHE) throw new PlatformError('access-denied', 'A link to a drive that is gone', root); return list(root) }
    await core.refreshStorage()
    expect(core.getState().storage).toMatchObject({ cache: { path: CACHE, files: 0, bytes: 0, unreadable: true }, backups: { groups: [{ folder: 'xiv', kind: 'install' }] } })
    expect(core.getState().storage!.backups).not.toHaveProperty('unreadable')
    expect(core.getState().backupsFolder).toBe(BACKUPS)
  })
})
