// Settings' Troubleshooting group: the FG recorder switch in the deployed OptiScaler.ini, the recordings OptiScaler-FFXIV writes
// beside its DLL, and clearing them. Unlike the Game patches switch it is never remembered, so a Reset, a tier switch and
// Repair write the tested setup's own `auto`, off, again.
import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, DEFAULT_ENV, type FakePlatform, type Machine } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, nextContentHost, vanillaGame, xivLauncher } from '../platform/fixtures'
import type { Manifest } from '../shared/manifest'
import { MANIFEST_URL } from './manifest'
import { PlatformError } from './platform'
import { dataPaths, readDeployment } from './deployment'
import { NEEDS_NEWER_CONTENT } from './gamePatch'
import { statusCard } from './statusCard'
import { clearRecordings, readRecorder, readRecordings, RECORDING_FILE, RECORDINGS_FOLDER } from './recorder'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`
const INI = `${GAME}\\OptiScaler.ini`
const FOLDER = `${GAME}\\${RECORDINGS_FOLDER}`
const KEY = /^FgRecorder\s*=.*$/m
const OTHER_LINES = (text: string) => text.split('\r\n').filter((line) => !/^FgRecorder\s*=/.test(line))
const ON_NOTICE = 'OptiScaler-FFXIV records frame generation from the next time XIV starts, into fg-recordings in the game folder.'
const OFF_NOTICE = 'OptiScaler-FFXIV stops recording frame generation from the next time XIV starts.'

/** The recorder's own files: two sessions, the first rotated twice. */
const OWN = {
  'fg-rec-20261030-180000-000-111.jsonl': 'a'.repeat(10),
  'fg-rec-20261030-180000-000-111.jsonl.1': 'b'.repeat(20),
  'fg-rec-20261030-180000-000-111.jsonl.8': 'c'.repeat(30),
  'fg-rec-20261031-090000-500-222.jsonl': 'd'.repeat(40),
}
/** Everything else a player or another tool may leave in the folder; never counted, never removed. */
const STRAYS = {
  'fg-rec-20261031-090000-500-222.jsonl.01': 'e'.repeat(400),
  'fg-rec-20261031-090000-500-222.jsonl.9': 'f'.repeat(400),
  'fg-rec-2026-1031.jsonl': 'g'.repeat(400),
  'fg-rec-20261031-090000-500-.jsonl': 'j'.repeat(400),
  'notes.txt': 'h'.repeat(400),
  'old\\fg-rec-20261031-100000-000-333.jsonl': 'i'.repeat(400),
}

const recordingsPlatform = (files: Record<string, string> = {}, options: { directories?: string[]; gameRunning?: boolean } = {}) =>
  createFakePlatform(machine(vanillaGame(ROOT), {
    files: Object.fromEntries(Object.entries(files).map(([name, text]) => [`${FOLDER}\\${name}`, text])),
    ...options,
  }))

const iniPlatform = (text: string | null) =>
  createFakePlatform(machine(vanillaGame(ROOT), { files: text === null ? {} : { [INI]: text } }))

/** Content 2026.10.31 ships the key at its own `auto`; the fixture's own OptiScaler.ini has no such line. */
const RECORDER_KEY = { file: 'OptiScaler.ini', section: 'FramePacing', key: 'FgRecorder', value: 'auto' } as const

function recorderContentHost(options: { folder?: boolean } = {}): Machine {
  const host = fixtureContentHost()
  const manifest = JSON.parse(host.remoteText![MANIFEST_URL]) as Manifest
  for (const version of manifest.versions) {
    for (const tier of Object.values(version.tiers)) {
      if (!tier.ownedConfigs.some((config) => config.path.toLowerCase() === 'optiscaler.ini')) continue
      tier.recipe.push({ kind: 'ini_set', ...RECORDER_KEY })
      if (options.folder) tier.generatedFiles.push({ path: RECORDINGS_FOLDER })
    }
  }
  return { remoteText: { ...host.remoteText, [MANIFEST_URL]: JSON.stringify(manifest) } }
}

async function deployed(content: Machine = recorderContentHost()) {
  const m = machine(content, graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  expect(core.getState().error).toBeNull()
  await core.refreshRecorder()
  return { platform, core, m }
}

async function reopen(platform: FakePlatform) {
  const core = createCore(platform)
  await core.scan()
  await core.refreshRecorder()
  return core
}

describe('reading the recorder’s switch', () => {
  it.each([['auto', false], ['false', false], ['true', true], [' TRUE ', true]])('reads %s as on %s', async (value, on) => {
    expect(await readRecorder(iniPlatform(`[FramePacing]\r\nFgRecorder = ${value}\r\n`), ROOT)).toEqual({ status: 'ready', on, recordings: null })
  })

  it('is unavailable when the ini predates the key, saying to update the content', async () => {
    expect(await readRecorder(iniPlatform('[FramePacing]\r\nEnebled = true\r\n'), ROOT)).toEqual({ status: 'unavailable', reason: NEEDS_NEWER_CONTENT, recordings: null })
  })

  it('is unavailable when the ini is missing, saying which', async () => {
    expect(await readRecorder(iniPlatform(null), ROOT)).toEqual({ status: 'unavailable', reason: 'OptiScaler.ini is missing. Repair puts it back.', recordings: null })
  })

  it('reads the recordings whatever the ini says', async () => {
    const platform = createFakePlatform(machine(vanillaGame(ROOT), { files: { [`${FOLDER}\\fg-rec-20261031-090000-500-222.jsonl`]: 'abc' } }))
    expect(await readRecorder(platform, ROOT)).toEqual({
      status: 'unavailable', reason: 'OptiScaler.ini is missing. Repair puts it back.',
      recordings: { path: FOLDER, sessions: 1, files: 1, bytes: 3, newest: { name: 'fg-rec-20261031-090000-500-222', files: 1, bytes: 3 } },
    })
  })
})

describe('reading the recordings', () => {
  it('matches only the names the recorder writes itself', () => {
    for (const name of Object.keys(OWN)) expect(RECORDING_FILE.test(name)).toBe(true)
    for (const name of [...Object.keys(STRAYS), 'FG-REC-20261031-090000-500-222.jsonl']) expect(RECORDING_FILE.test(name)).toBe(false)
  })

  it('is nothing without the folder', async () => {
    expect(await readRecordings(createFakePlatform(machine(vanillaGame(ROOT))), ROOT)).toBeNull()
  })

  it('counts the recorder’s own files by session, and names the newest session', async () => {
    const recordings = await readRecordings(recordingsPlatform({ ...OWN, ...STRAYS }), ROOT)
    expect(recordings).toEqual({
      path: FOLDER, sessions: 2, files: 4, bytes: 100,
      newest: { name: 'fg-rec-20261031-090000-500-222', files: 1, bytes: 40 },
    })
  })

  it('names the session with the newest stamp, not the greatest process id', async () => {
    const platform = recordingsPlatform({
      'fg-rec-20261029-235959-999-99999.jsonl': 'older',
      'fg-rec-20261031-090000-500-111.jsonl': 'newer!',
    })
    expect((await readRecordings(platform, ROOT))!.newest).toEqual({ name: 'fg-rec-20261031-090000-500-111', files: 1, bytes: 6 })
  })

  it('breaks a tie between two sessions of the same stamp by the greater name', async () => {
    const platform = recordingsPlatform({
      'fg-rec-20261031-090000-500-1000.jsonl': 'a',
      'fg-rec-20261031-090000-500-999.jsonl': 'bb',
    })
    const recordings = await readRecordings(platform, ROOT)
    expect(recordings).toMatchObject({ sessions: 2, files: 2, bytes: 3 })
    // Plain string comparison: `…-999` sorts above `…-1000`, so the pid is no number to it.
    expect(recordings!.newest).toEqual({ name: 'fg-rec-20261031-090000-500-999', files: 1, bytes: 2 })
  })

  it('keeps the switch and marks only the row unreadable when the folder is a junction Lucent won’t follow', async () => {
    const platform = createFakePlatform(machine(vanillaGame(ROOT), { files: { [INI]: '[FramePacing]\r\nFgRecorder = true\r\n' } }))
    const resolve = platform.resolveGamePath
    platform.resolveGamePath = async (root, relative) => {
      if (relative === RECORDINGS_FOLDER) throw new PlatformError('access-denied', 'A game-folder path contains a junction or symbolic link.')
      return resolve(root, relative)
    }
    expect(await readRecorder(platform, ROOT)).toEqual({
      status: 'ready', on: true, recordings: { path: FOLDER, sessions: 0, files: 0, bytes: 0, newest: null, unreadable: true },
    })
  })

  it('is nothing when a file has the folder’s name', async () => {
    const platform = createFakePlatform(machine(vanillaGame(ROOT), { files: { [FOLDER]: 'not a folder' } }))
    expect(await readRecordings(platform, ROOT)).toBeNull()
    await expect(clearRecordings(platform, ROOT)).resolves.toEqual({ files: 0, bytes: 0 })
    expect(await platform.readText(FOLDER)).toBe('not a folder')
  })

  it('reads an empty folder as no sessions', async () => {
    expect(await readRecordings(recordingsPlatform({}, { directories: [FOLDER] }), ROOT)).toEqual({ path: FOLDER, sessions: 0, files: 0, bytes: 0, newest: null })
  })

  it('says so when the folder can’t be listed', async () => {
    const platform = recordingsPlatform(OWN)
    platform.deny(FOLDER)
    expect(await readRecordings(platform, ROOT)).toEqual({ path: FOLDER, sessions: 0, files: 0, bytes: 0, newest: null, unreadable: true })
  })
})

describe('clearing the recordings', () => {
  it('removes the recorder’s own files and their bytes, and leaves every other file and the folder alone', async () => {
    const platform = recordingsPlatform({ ...OWN, ...STRAYS })
    await expect(clearRecordings(platform, ROOT)).resolves.toEqual({ files: 4, bytes: 100 })
    expect((await platform.listFiles(FOLDER)).sort()).toEqual(Object.keys(STRAYS).sort())
    expect(await readRecordings(platform, ROOT)).toMatchObject({ path: FOLDER, sessions: 0, files: 0, bytes: 0, newest: null })
  })

  it('removes the folder once only the recorder’s own files were in it', async () => {
    const platform = recordingsPlatform(OWN)
    await expect(clearRecordings(platform, ROOT)).resolves.toEqual({ files: 4, bytes: 100 })
    await expect(platform.stat(FOLDER)).rejects.toThrow(/Not found/)
    expect(await readRecordings(platform, ROOT)).toBeNull()
  })

  it('has nothing to do without the folder', async () => {
    await expect(clearRecordings(createFakePlatform(machine(vanillaGame(ROOT))), ROOT)).resolves.toEqual({ files: 0, bytes: 0 })
  })

  it('refuses while XIV runs, and removes nothing', async () => {
    const platform = recordingsPlatform(OWN, { gameRunning: true })
    await expect(clearRecordings(platform, ROOT)).rejects.toThrow(/Close XIV/)
    expect(await platform.listFiles(FOLDER)).toHaveLength(4)
  })
})

describe('turning it on and off', () => {
  it('writes true to that one key, in place, and leaves every other line of the ini as it was', async () => {
    const { platform, core } = await deployed()
    const before = await platform.readText(INI)
    const keys = Object.keys((await readDeployment(platform, ROOT))!).sort()
    await core.setFgRecorder(true)
    const after = await platform.readText(INI)
    expect(core.getState()).toMatchObject({ error: null, busy: false, recorder: { status: 'ready', on: true } })
    expect(core.getState().notice).toBe(ON_NOTICE)
    expect(OTHER_LINES(after)).toEqual(OTHER_LINES(before))
    expect(after).toMatch(/^FgRecorder\s*=\s*true$/m)
    expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
    const record = (await readDeployment(platform, ROOT))!
    expect(record.journal.at(-1)).toMatchObject({ step: { kind: 'ini_set', section: 'FramePacing', key: 'FgRecorder', value: 'true' } })
    expect(Object.keys(record).sort()).toEqual(keys)
    expect(record).not.toHaveProperty('unknownBuildHooks')
    expect(record).not.toHaveProperty('fgRecorder')
  })

  it('writes false, not auto, when it is turned off again', async () => {
    const { platform, core } = await deployed()
    await core.setFgRecorder(true)
    await core.setFgRecorder(false)
    expect(await platform.readText(INI)).toMatch(/^FgRecorder\s*=\s*false$/m)
    expect(core.getState()).toMatchObject({ recorder: { status: 'ready', on: false } })
    expect(core.getState().notice).toBe(OFF_NOTICE)
  })

  it('leaves the ini and the record alone while the player never uses it', async () => {
    const { platform, core } = await deployed()
    expect(await platform.readText(INI)).toMatch(/^FgRecorder\s*=\s*auto$/m)
    expect(core.getState().deployment).not.toHaveProperty('fgRecorder')
  })

  it('writes nothing when the ini already says the value', async () => {
    const { platform, core } = await deployed()
    await platform.writeText(INI, (await platform.readText(INI)).replace(KEY, 'FgRecorder = true'))
    const recordPath = (await dataPaths(platform, ROOT)).record
    const before = await platform.readText(recordPath)
    const writeText = platform.writeText
    const written: string[] = []
    platform.writeText = (path, text) => { written.push(path); return writeText(path, text) }
    await core.setFgRecorder(true)
    platform.writeText = writeText
    expect(core.getState()).toMatchObject({ error: null, recorder: { status: 'ready', on: true } })
    expect(await platform.readText(recordPath)).toBe(before)
    // Not even the same record again: the switch is not remembered, so there is nothing to save.
    expect(written.filter((path) => path.toLowerCase() === recordPath.toLowerCase())).toEqual([])
    expect(await platform.readText(INI)).toMatch(/^FgRecorder\s*=\s*true$/m)
  })

  it('says to update the content when the ini has no such key, and writes nothing', async () => {
    const { platform, core } = await deployed(fixtureContentHost())
    const before = await platform.readText(INI)
    expect(core.getState().recorder).toMatchObject({ status: 'unavailable', reason: NEEDS_NEWER_CONTENT })
    await core.setFgRecorder(true)
    expect(core.getState().error).toBe(NEEDS_NEWER_CONTENT)
    expect(await platform.readText(INI)).toBe(before)
  })

  it('refuses while XIV runs, and changes nothing', async () => {
    const { platform, core, m } = await deployed()
    const before = await platform.readText(INI)
    m.gameRunning = true
    await core.setFgRecorder(true)
    expect(core.getState().error).toMatch(/Close XIV/)
    expect(await platform.readText(INI)).toBe(before)
    expect(core.getState().busy).toBe(false)
  })

  it('does not write over an ini another program holds open', async () => {
    const { platform, core } = await deployed()
    const before = await platform.readText(INI)
    const read = platform.readText.bind(platform)
    platform.readText = async (path) => { if (path === INI) throw new PlatformError('locked', 'In use', path); return read(path) }
    await core.setFgRecorder(true)
    platform.readText = read
    expect(core.getState().error).toMatch(/in use/i)
    expect(await platform.readText(INI)).toBe(before)
  })

  it('undoes a write that fails after the journal saved its backup, leaving the ini and a complete record as they were and no recovery to do', async () => {
    const { platform, core } = await deployed()
    const before = await platform.readText(INI)
    const recordPath = (await dataPaths(platform, ROOT)).record
    const journal = JSON.parse(await platform.readText(recordPath)).journal
    const writeText = platform.writeText
    // The port writes a temporary file and renames it over the ini, so a failed write leaves the old ini whole.
    platform.writeText = async (path, text, ...rest) => {
      if (path.toLowerCase() === INI.toLowerCase()) throw new PlatformError('disk-full', 'The disk is full.', path)
      return writeText(path, text, ...rest)
    }
    await core.setFgRecorder(true)
    platform.writeText = writeText
    expect(core.getState()).toMatchObject({ error: 'There isn’t enough free disk space. Free some space and try again. Lucent restored the game folder to how it was before.', recoveryRequired: false })
    expect(await platform.readText(INI)).toBe(before)
    const record = JSON.parse(await platform.readText(recordPath))
    expect(record.status).toBe('complete')
    expect(record.journal).toEqual(journal)
  })
})

describe('never remembering it', () => {
  it('writes the tested setup’s off again after a Reset, which rewrites OptiScaler.ini from the baseline', async () => {
    const { platform, core } = await deployed()
    await core.setFgRecorder(true)
    await core.resetSetup()
    await core.review()
    await core.deploy()
    core.finish()
    expect(core.getState().error).toBeNull()
    expect(await platform.readText(INI)).toMatch(/^FgRecorder\s*=\s*auto$/m)
    await core.refreshRecorder()
    expect(core.getState().recorder).toMatchObject({ status: 'ready', on: false })
  })

  it('writes the baseline again when a new graphics card rewrites it, which starts from the shipped ini', async () => {
    const { platform, core, m } = await deployed()
    await core.setFgRecorder(true)
    const before = await platform.readText(INI)
    m.gpus = graphicsCard('NVIDIA GeForce RTX 3080').gpus
    const changed = await reopen(platform)
    await changed.switchTier()
    await changed.review()
    await changed.deploy()
    expect(changed.getState().error).toBeNull()
    const after = await platform.readText(INI)
    // The ini really was rewritten from the baseline for the new card, and the key is the content's.
    expect(after).not.toBe(before)
    expect(after).toMatch(/^FgRecorder\s*=\s*auto$/m)
    expect(await readRecorder(platform, ROOT)).toMatchObject({ status: 'ready', on: false })
  })

  it('writes the shipped value again when Repair puts a missing OptiScaler.ini back', async () => {
    const { platform, core } = await deployed()
    await core.setFgRecorder(true)
    await platform.removeFile(INI)
    const reopened = await reopen(platform)
    await reopened.repair()
    expect(statusCard(reopened.getState())).toEqual({ kind: 'healthy' })
    expect(await platform.readText(INI)).toMatch(/^FgRecorder\s*=\s*auto$/m)
    await reopened.refreshRecorder()
    expect(reopened.getState().recorder).toMatchObject({ status: 'ready', on: false })
  })

  it('keeps it through a content update, which leaves the player’s ini as it is', async () => {
    const { platform, core, m } = await deployed()
    await core.setFgRecorder(true)
    Object.assign(m.remoteText!, nextContentHost().remoteText)
    const reopened = await reopen(platform)
    await reopened.update()
    expect(reopened.getState().error).toBeNull()
    expect(await platform.readText(INI)).toMatch(/^FgRecorder\s*=\s*true$/m)
    expect(reopened.getState().recorder).toMatchObject({ status: 'ready', on: true })
  })

  it('journals the write, so Uninstall leaves the game folder vanilla', async () => {
    const { platform, core } = await deployed()
    await core.setFgRecorder(true)
    const record = (await readDeployment(platform, ROOT))!
    expect(record.status).toBe('complete')
    expect(record.journal.at(-1)).toMatchObject({ step: { kind: 'ini_set', section: 'FramePacing', key: 'FgRecorder', value: 'true' } })
    await core.uninstall()
    expect(core.getState().error).toBeNull()
    expect(await platform.listFiles(GAME)).toEqual(['ffxiv_dx11.exe', 'ffxivgame.ver'])
  })

  it('removes the recordings with the rest when Uninstall finishes an updated deployment', async () => {
    const { platform, core, m } = await deployed(recorderContentHost({ folder: true }))
    await platform.writeText(`${FOLDER}\\fg-rec-20261030-180000-000-111.jsonl`, 'first')
    await platform.writeText(`${FOLDER}\\fg-rec-20261030-180000-000-111.jsonl.1`, 'second')
    await core.setFgRecorder(true)
    Object.assign(m.remoteText!, nextContentHost().remoteText)
    const reopened = await reopen(platform)
    await reopened.update()
    expect(reopened.getState().error).toBeNull()
    expect(await readRecordings(platform, ROOT)).toMatchObject({ sessions: 1, files: 2 })
    await reopened.uninstall()
    expect(reopened.getState().error).toBeNull()
    // The content lists `fg-recordings` in generatedFiles, so Uninstall takes the folder and what the recorder wrote in it.
    await expect(platform.stat(FOLDER)).rejects.toThrow(/Not found/)
    expect(await platform.listFiles(GAME)).toEqual(['ffxiv_dx11.exe', 'ffxivgame.ver'])
  })
})

describe('while Lucent and the game folder have other claims', () => {
  it('waits for another Lucent process that holds the lease, and writes nothing', async () => {
    const { platform, core } = await deployed()
    const before = await platform.readText(INI)
    const token = await platform.acquireOperationLock(`${DEFAULT_ENV.LocalAppData}\\Lucent`)
    await core.setFgRecorder(true)
    await platform.releaseOperationLock(token)
    expect(core.getState().error).toMatch(/Another Lucent operation is using its files/)
    expect(await platform.readText(INI)).toBe(before)
  })

  it('asks for administrator access to set the switch, and the elevated process takes the request back', async () => {
    const { platform, core, m } = await deployed()
    m.readOnlyDirectories = [GAME]
    await core.setFgRecorder(true)
    expect(platform.elevationRequests).toHaveLength(1)
    expect(JSON.parse(await platform.readText(platform.elevationRequests[0])).request).toMatchObject({ kind: 'fg-recorder', on: true })
    expect(await platform.readText(INI)).toMatch(/^FgRecorder\s*=\s*auto$/m)
    m.elevated = true
    const resumed = createCore(platform)
    await resumed.scan()
    expect(resumed.getState().error).toBeNull()
    expect(await platform.readText(INI)).toMatch(/^FgRecorder\s*=\s*true$/m)
    expect(resumed.getState().recorder).toMatchObject({ status: 'ready', on: true })
  })

  it('asks for administrator access to clear the recordings, and the elevated process takes the request back', async () => {
    const { platform, core, m } = await deployed()
    await platform.writeText(`${FOLDER}\\fg-rec-20261031-090000-500-222.jsonl`, 'rec')
    await core.refreshRecorder()
    m.readOnlyDirectories = [GAME]
    await core.clearRecordings()
    expect(platform.elevationRequests).toHaveLength(1)
    expect(JSON.parse(await platform.readText(platform.elevationRequests[0])).request).toMatchObject({ kind: 'clear-recordings', gameFolder: ROOT })
    expect(await platform.readText(`${FOLDER}\\fg-rec-20261031-090000-500-222.jsonl`)).toBe('rec')
    m.elevated = true
    const resumed = createCore(platform)
    await resumed.scan()
    expect(resumed.getState().error).toBeNull()
    await expect(platform.stat(FOLDER)).rejects.toThrow(/Not found/)
  })
})

describe('clearing from Settings, when only the recordings folder needs administrator access', () => {
  it('asks for it, because the folder itself is what Clear writes to', async () => {
    const { platform, core, m } = await deployed()
    await platform.writeText(`${FOLDER}\\fg-rec-20261031-090000-500-222.jsonl`, 'rec')
    await core.refreshRecorder()
    m.readOnlyDirectories = [FOLDER]
    await core.clearRecordings()
    expect(platform.elevationRequests).toHaveLength(1)
    expect(await platform.readText(`${FOLDER}\\fg-rec-20261031-090000-500-222.jsonl`)).toBe('rec')
  })
})

describe('clearing from Settings', () => {
  it('says how much it cleared, and reads the recordings again', async () => {
    const { platform, core } = await deployed()
    await platform.writeText(`${FOLDER}\\fg-rec-20261030-180000-000-111.jsonl`, 'abc')
    await platform.writeText(`${FOLDER}\\fg-rec-20261030-180000-000-111.jsonl.1`, 'de')
    await core.refreshRecorder()
    expect(core.getState().recorder).toMatchObject({ recordings: { sessions: 1, files: 2, bytes: 5 } })
    await core.clearRecordings()
    expect(core.getState()).toMatchObject({ error: null, busy: false })
    expect(core.getState().notice).toBe('Cleared 5 B of recordings (2 files).')
    expect(core.getState().recorder).toMatchObject({ status: 'ready', recordings: null })
  })

  it('says so when there were no recordings', async () => {
    const { core } = await deployed()
    await core.clearRecordings()
    expect(core.getState().notice).toBe('There were no recordings to clear.')
  })

  it('is nothing without a deployment', async () => {
    const core = createCore(createFakePlatform(machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))))
    await core.scan()
    await core.refreshRecorder()
    expect(core.getState().recorder).toBeNull()
  })
})
