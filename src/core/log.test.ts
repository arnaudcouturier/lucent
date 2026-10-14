import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, DEFAULT_ENV, type FakePlatform } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { runHeadless } from './autoRepair'
import { gameRelative, loggedPort, LUCENT_LOG, logSources, openActivityLog, parseLog, trimActivityLog, type ActivityLog } from './log'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`
const LOG = `${DEFAULT_ENV.LocalAppData}\\Lucent\\lucent.log`
const AT = new Date(2026, 9, 13, 19, 14, 5)

/** The log's lines without their timestamps: `[level] text`. */
const logged = async (platform: FakePlatform) => (await platform.readText(LOG)).trimEnd().split('\n').map((line) => line.slice(20))

async function deployed(includeReShade = true) {
  const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review(includeReShade)
  await core.deploy()
  core.finish()
  return { m, platform, core }
}

describe('the activity log', () => {
  it('tells a first deployment from Scan to the health check, with every file written in the game folder', async () => {
    const { platform, core } = await deployed()
    await core.readLog(LUCENT_LOG)
    const lines = await logged(platform)
    expect(lines[0]).toBe('[info] Lucent 0.1.0 started')
    expect(lines).toEqual(expect.arrayContaining([
      `[info] Game folder: ${ROOT}, game 2026.09.30.0000.0000`,
      '[info] Graphics card: NVIDIA GeForce RTX 4090, RTX 30/40 tier',
      '[info] Manifest: 1 content version',
      '[info] XIVLauncher: found, auto-repair off',
      '[info] Install: content 2026.10.12, RTX 30/40 tier, Fidelity profile',
      '[detail] wrote winmm.dll',
      '[detail] renamed ReShade.download to ReShade64.dll',
      '[info] Health check: healthy, 6 files',
    ]))
    expect(lines.some((line) => /^\[success\] Install finished in \d+ s$/.test(line))).toBe(true)
    // Lucent's own journal, cache and settings are not the game folder's files.
    expect(lines.filter((line) => line.startsWith('[detail]')).every((line) => !line.includes('AppData'))).toBe(true)
    // Each stage is announced before the files it touches.
    const applying = lines.findIndex((line) => /^\[info\] Applying \d+ changes$/.test(line))
    expect(applying).toBeGreaterThan(-1)
    expect(applying).toBeLessThan(lines.indexOf('[detail] wrote winmm.dll'))
  })

  it('records every error and notice the window shows, and each later command', async () => {
    const { m, platform, core } = await deployed()
    await core.checkFiles()
    await core.setEnabled(false)
    m.gameRunning = true
    await core.refreshGameRunning()
    await core.setEnabled(true)
    await core.readLog(LUCENT_LOG)
    const lines = await logged(platform)
    expect(lines).toEqual(expect.arrayContaining([
      '[info] Scan checked 6 files. Everything matches what Lucent deployed.',
      '[detail] renamed winmm.dll to winmm.dll.disabled',
      '[info] Deployment disabled',
      '[info] XIV started',
    ]))
    expect(lines.at(-1)).toBe(`[error] ${core.getState().error}`)
    expect(core.getState().error).toMatch(/XIV/)
  })

  it('says a health result once, until it changes', async () => {
    const { platform, core } = await deployed()
    await core.setEnabled(false)
    await core.setEnabled(true)
    await platform.writeText(`${GAME}\\winmm.dll`, 'patched')
    await core.checkFiles()
    await core.repair()
    await core.readLog(LUCENT_LOG)
    const health = (await logged(platform)).filter((line) => /Health check|Drift/.test(line))
    expect(health).toEqual(['[info] Health check: healthy, 6 files', '[warning] Drift in 1 file: winmm.dll', '[info] Health check: healthy, 6 files'])
  })

  it('is shared by Lucent’s processes: a headless run adds its outcome', async () => {
    const { platform } = await deployed()
    await runHeadless(platform, 'check')
    await platform.writeText(`${GAME}\\winmm.dll`, 'patched')
    await runHeadless(platform, 'check')
    await runHeadless(platform, 'repair')
    expect((await logged(platform)).slice(-3)).toEqual([
      '[info] XIVLauncher started XIV: health check healthy',
      '[warning] XIVLauncher started XIV: drift in 1 file, to repair when XIV closes',
      '[success] XIV closed: repair finished',
    ])
  })

  it('writes lines in order, those of one moment in a single append, and never fails the work it describes', async () => {
    const platform = createFakePlatform()
    const appends: string[] = []
    const log = openActivityLog({ ...platform, appendText: async (path, text) => { appends.push(text); await platform.appendText(path, text) } }, () => AT)
    log.write('info', 'first')
    log.write('detail', 'second\r\n  over two lines')
    await log.flushed()
    log.write('success', 'third')
    await log.flushed()
    expect(appends).toEqual(['2026-10-13 19:14:05 [info] first\n2026-10-13 19:14:05 [detail] second over two lines\n', '2026-10-13 19:14:05 [success] third\n'])

    const broken = openActivityLog({ ...platform, appendText: async () => { throw new Error('disk full') } })
    broken.write('info', 'lost')
    await expect(broken.flushed()).resolves.toBeUndefined()
  })

  it('is cut back to its last lines once it grows past half a megabyte', async () => {
    const platform = createFakePlatform()
    const line = (n: number) => `2026-10-13 19:14:05 [detail] wrote reshade-shaders\\Shaders\\Effect${String(n).padStart(6, '0')}.fx`
    const lines = Array.from({ length: 9000 }, (_, n) => line(n))
    await platform.writeText(LOG, `${lines.slice(0, 100).join('\n')}\n`)
    await trimActivityLog(platform)
    expect((await platform.readText(LOG)).split('\n')).toHaveLength(101)
    await platform.writeText(LOG, `${lines.join('\n')}\n`)
    await trimActivityLog(platform)
    const kept = (await platform.readText(LOG)).trimEnd().split('\n')
    expect(kept).toHaveLength(2000)
    expect(kept.at(-1)).toBe(line(8999))
    // A missing log has nothing to trim.
    await expect(trimActivityLog(createFakePlatform())).resolves.toBeUndefined()
  })
})

describe('the port the log follows', () => {
  function follow() {
    const platform = createFakePlatform({ files: { [`${GAME}\\ffxiv_dx11.exe`]: 'game', 'C:\\Cache\\a': 'a' } })
    const lines: string[] = []
    let flushes = 0
    const log: ActivityLog = { write: (level, text) => { lines.push(`[${level}] ${text}`) }, flushed: async () => { flushes++ } }
    return { platform, lines, port: loggedPort(platform, log, (path) => gameRelative(ROOT, path)), flushes: () => flushes }
  }

  it('notes the game folder’s files only, once the port has changed them', async () => {
    const { platform, lines, port } = follow()
    await port.copyMany([{ from: 'C:\\Cache\\a', to: `${GAME}\\reshade-shaders\\Shaders\\A.fx`, replace: true }, { from: 'C:\\Cache\\a', to: 'C:\\Backups\\a', replace: true }])
    await port.writeText(`${GAME}\\OptiScaler.ini`, '[a]')
    await port.writeText(`${GAME}\\OptiScaler.ini`, '[b]')
    await port.writeText('C:\\Users\\Player\\AppData\\Local\\Lucent\\settings.json', '{}')
    await port.renameFile(`${GAME}\\OptiScaler.ini`, `${GAME}\\OptiScaler.ini.disabled`)
    await port.removeMany([`${GAME}\\reshade-shaders\\Shaders\\A.fx`, 'C:\\Backups\\a'])
    expect(lines).toEqual(['[detail] wrote reshade-shaders\\Shaders\\A.fx', '[detail] wrote OptiScaler.ini', '[detail] renamed OptiScaler.ini to OptiScaler.ini.disabled', '[detail] removed reshade-shaders\\Shaders\\A.fx'])
    expect(await platform.listFiles(GAME)).toEqual(['ffxiv_dx11.exe', 'optiscaler.ini.disabled'])

    await expect(port.copyFile('C:\\Cache\\missing', `${GAME}\\winmm.dll`)).rejects.toThrow()
    expect(lines).toHaveLength(4)
  })

  it('lets the log reach the file before a call that ends the process', async () => {
    const { platform, port, flushes } = follow()
    await port.launchExe('C:\\Lucent.exe')
    await port.requestElevation('C:\\resume.json')
    await port.exitAndRemove([])
    expect(flushes()).toBe(3)
    expect(platform.removedOnExit).toEqual([])
  })

  it('finds a path under the game folder whatever its case or slashes', () => {
    expect(gameRelative(ROOT, 'c:/games/xiv/game/ReShade.ini')).toBe('ReShade.ini')
    expect(gameRelative(ROOT, `${ROOT}\\boot\\ffxivboot.exe`)).toBeNull()
    expect(gameRelative(ROOT, `${ROOT}\\gameplay\\a`)).toBeNull()
    expect(gameRelative(null, `${GAME}\\ReShade.ini`)).toBeNull()
  })
})

describe('the Logs section', () => {
  it('offers Lucent’s log, then each log the deployed tools write', async () => {
    expect(logSources(null)).toEqual([LUCENT_LOG])
    const { core } = await deployed()
    expect(logSources(core.getState().deployment)).toEqual([LUCENT_LOG, { id: 'OptiScaler.log', label: 'OptiScaler', file: 'OptiScaler.log' }, { id: 'ReShade.log', label: 'ReShade', file: 'ReShade.log' }])
    const without = await deployed(false)
    expect(logSources(without.core.getState().deployment).map((source) => source.label)).toEqual(['Lucent', 'OptiScaler'])
  })

  it('reads the end of each log, and says when a tool hasn’t written one', async () => {
    const { platform, core } = await deployed()
    const [, optiScaler, reShade] = logSources(core.getState().deployment)
    const lucent = await core.readLog(LUCENT_LOG)
    expect(lucent![0]).toMatchObject({ level: 'info', text: 'Lucent 0.1.0 started' })
    expect(lucent![0].date).toMatch(/^\d{4}-\d\d-\d\d$/)
    expect(lucent![0].time).toMatch(/^\d\d:\d\d:\d\d$/)
    expect(await core.readLog(optiScaler)).toBeNull()
    await platform.writeText(`${GAME}\\ReShade.log`, '19:10:55:123 [04321] | INFO  | Initializing ReShade\r\n19:10:56:001 [04321] | ERROR | Failed to compile Example.fx\r\n')
    expect(await core.readLog(reShade)).toEqual([
      { date: null, time: null, level: 'info', text: '19:10:55:123 [04321] | INFO  | Initializing ReShade' },
      { date: null, time: null, level: 'error', text: '19:10:56:001 [04321] | ERROR | Failed to compile Example.fx' },
    ])
    platform.deny(`${GAME}\\ReShade.log`)
    expect(await core.readLog(reShade)).toMatchObject([{ level: 'error', text: expect.stringContaining('couldn’t read this log') }])
  })

  it('copies the shown lines as written', async () => {
    const { platform, core } = await deployed()
    const [, optiScaler] = logSources(core.getState().deployment)
    expect(await core.copyLog(optiScaler)).toBe(false)
    expect(platform.clipboard).toBeNull()
    expect(await core.copyLog(LUCENT_LOG)).toBe(true)
    expect(platform.clipboard).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d \[info\] Lucent 0\.1\.0 started\n/)
  })

  it('reads each tool’s own level, and shows a line it can’t parse as it is', () => {
    const levels = (text: string) => parseLog({ id: 'OptiScaler.log', label: 'OptiScaler', file: 'OptiScaler.log' }, text).map((line) => line.level)
    expect(levels('[19:10:55.123] [info] Hooked\n[19:10:55.124] [warning] Slow\n[19:10:55.125] [error] Failed\n[19:10:55.126] [debug] Frame\n\nNo error here')).toEqual(['info', 'warning', 'error', 'detail', 'info'])
    expect(parseLog(LUCENT_LOG, '2026-10-13 19:14:05 [warning] Drift in 1 file: winmm.dll\nnot a Lucent line')).toEqual([
      { date: '2026-10-13', time: '19:14:05', level: 'warning', text: 'Drift in 1 file: winmm.dll' },
      { date: null, time: null, level: 'info', text: 'not a Lucent line' },
    ])
  })
})
