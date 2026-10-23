// Settings → Game folder → Change…: a second copy of the game (a Steam copy beside an XIVLauncher one) can be looked
// after without uninstalling from the first. Only the remembered folder changes; neither game folder is written.
import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, DEFAULT_ENV, type FakePlatform } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { runHeadless } from './autoRepair'
import { dataPaths } from './deployment'
import { readSettings, writeSettings } from './settings'
import { statusCard } from './statusCard'

/** The copy XIVLauncher launches, which Lucent deploys to first. */
const A = 'C:\\Games\\XIV'
/** A second, vanilla copy. */
const B = 'D:\\Second copy'
const LUCENT = `${DEFAULT_ENV.LocalAppData}\\Lucent`
const SETTINGS = `${LUCENT}\\settings.json`
const XIVLAUNCHER_CONFIG = `${DEFAULT_ENV.AppData}\\XIVLauncher\\launcherConfigV3.json`

const twoCopies = () => machine(fixtureContentHost(), graphicsCard(), vanillaGame(A), vanillaGame(B), xivLauncher(A), { files: { 'F:\\Downloads\\readme.txt': 'hi' } })
const lookingAt = (folder: string, left: string) => `Lucent is now looking at ${folder}. Your setup in ${left} stays in place; choose that folder again to come back to it.`

async function deployedOnA() {
  const m = twoCopies()
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  // Done's keys are read without waiting; the main screen's state is settled once they are.
  await core.refreshKeybinds()
  return { m, platform, core }
}

/** Every file under a folder with its text; a folder that isn't there holds nothing. */
async function tree(platform: FakePlatform, root: string): Promise<Record<string, string>> {
  const files = await platform.listFiles(root).catch(() => [])
  return Object.fromEntries(await Promise.all(files.map(async (file) => [file, await platform.readText(`${root}\\${file}`)])))
}

/** What Lucent keeps for its deployments: records, journals and backups, the content cache and the readable backups. */
const lucentData = async (platform: FakePlatform) =>
  ({ deployments: await tree(platform, `${LUCENT}\\deployments`), cache: await tree(platform, `${LUCENT}\\cache`), backups: await tree(platform, `${LUCENT}\\Backups`) })

describe('Change… in Settings → Game folder', () => {
  it('moves to a vanilla second copy without writing to either copy or to the deployment, and Scan’s Change comes back to it intact', async () => {
    const { platform, core } = await deployedOnA()
    // Only the game folder setting may change; this one must survive.
    await writeSettings(platform, { ...await readSettings(platform), skippedApp: ['9.9.9'] })
    // What Scan said about this copy must not stay up for the next one.
    await core.checkFiles()
    expect(core.getState().notice).toMatch(/Everything matches/)
    const record = (await dataPaths(platform, A)).record
    const deployed = core.getState().deployment!
    const before = { record: await platform.readText(record), a: await tree(platform, A), b: await tree(platform, B), data: await lucentData(platform) }
    const unchanged = async () => {
      expect(await platform.readText(record)).toBe(before.record)
      expect(await tree(platform, A)).toEqual(before.a)
      expect(await tree(platform, B)).toEqual(before.b)
      expect(await lucentData(platform)).toEqual(before.data)
    }

    platform.answerPicker(B)
    await core.changeGameFolder()
    expect(core.getState()).toMatchObject({ error: null, notice: lookingAt(B, A), activity: { kind: 'scan' }, gameFolder: { status: 'found', path: B, source: 'picked' }, deployment: null, rejectedFolder: null })
    expect(await readSettings(platform)).toMatchObject({ gameFolder: B, skippedApp: ['9.9.9'] })
    await unchanged()

    platform.answerPicker(A)
    await core.chooseGameFolder()
    expect(core.getState()).toMatchObject({ error: null, activity: { kind: 'deployment', drift: null }, gameFolder: { status: 'found', path: A },
      deployment: { gameFolder: A, status: 'complete', contentVersion: deployed.contentVersion, enabled: true } })
    expect(core.getState().deployment!.files).toEqual(deployed.files)
    expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
    expect(await readSettings(platform)).toMatchObject({ gameFolder: A, skippedApp: ['9.9.9'] })
    await unchanged()
  })

  it('opens a copy that has its own deployment on that deployment, leaving the other one as it was', async () => {
    const { platform, core } = await deployedOnA()
    platform.answerPicker(B)
    await core.changeGameFolder()
    await core.review()
    await core.deploy()
    core.finish()
    expect(core.getState()).toMatchObject({ error: null, deployment: { gameFolder: B, status: 'complete' } })
    const records = [(await dataPaths(platform, A)).record, (await dataPaths(platform, B)).record]
    const before = { records: await Promise.all(records.map((path) => platform.readText(path))), a: await tree(platform, A), b: await tree(platform, B) }

    platform.answerPicker(A)
    await core.changeGameFolder()
    expect(core.getState()).toMatchObject({ error: null, notice: lookingAt(A, B), activity: { kind: 'deployment', drift: null, operation: null }, gameFolder: { status: 'found', path: A, source: 'picked' },
      deployment: { gameFolder: A, status: 'complete' } })
    expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
    expect(await Promise.all(records.map((path) => platform.readText(path)))).toEqual(before.records)
    expect(await tree(platform, A)).toEqual(before.a)
    expect(await tree(platform, B)).toEqual(before.b)
  })

  it('refuses a pick that doesn’t hold the game, and stays on the folder it had', async () => {
    const { platform, core } = await deployedOnA()
    await writeSettings(platform, await readSettings(platform))
    const settings = await platform.readText(SETTINGS)

    platform.answerPicker('F:\\Downloads')
    await core.changeGameFolder()

    expect(core.getState()).toMatchObject({ rejectedFolder: 'F:\\Downloads', error: null, activity: { kind: 'deployment' }, gameFolder: { status: 'found', path: A }, deployment: { gameFolder: A } })
    expect(await platform.readText(SETTINGS)).toBe(settings)
  })

  it('does nothing when the pick is the folder already in use, however it is spelled', async () => {
    const { platform, core } = await deployedOnA()
    const before = core.getState()

    platform.answerPicker(`${A.toLowerCase()}\\game\\`)
    await core.changeGameFolder()

    expect(core.getState()).toEqual(before)
    expect((await readSettings(platform)).gameFolder).toBeNull()
  })

  it('changes nothing when the player cancels the picker', async () => {
    const { platform, core } = await deployedOnA()
    const before = core.getState()

    platform.answerPicker(null)
    await core.changeGameFolder()

    expect(core.getState()).toEqual(before)
    expect((await readSettings(platform)).gameFolder).toBeNull()
  })

  it('stays on the folder it had when the choice can’t be saved, since Scan would only return to it', async () => {
    const { platform, core } = await deployedOnA()
    platform.deny(SETTINGS)

    platform.answerPicker(B)
    await core.changeGameFolder()

    expect(core.getState()).toMatchObject({ error: expect.stringMatching(/couldn’t read its settings file/), activity: { kind: 'deployment' }, gameFolder: { status: 'found', path: A }, deployment: { gameFolder: A } })
  })

  it('waits while another command is running, without asking for a folder', async () => {
    const { platform, core } = await deployedOnA()
    let started!: () => void
    let release!: () => void
    const running = new Promise<void>((resolve) => { started = resolve })
    const held = new Promise<void>((resolve) => { release = resolve })
    const processCheck = platform.isGameRunning.bind(platform)
    platform.isGameRunning = async () => { started(); await held; return processCheck() }
    const scanning = core.scan()
    await running
    expect(core.getState().busy).toBe(true)

    platform.answerPicker(B)
    await core.changeGameFolder()
    release()
    await scanning

    // The picker never opened: the answer is still waiting.
    expect(await platform.pickFolder({ title: 'Choose the game folder' })).toBe(B)
    expect(core.getState()).toMatchObject({ gameFolder: { status: 'found', path: A }, deployment: { gameFolder: A } })
    expect((await readSettings(platform)).gameFolder).toBeNull()
  })

  it('waits while recovery is required, without asking for a folder', async () => {
    const { m, platform, core } = await deployedOnA()
    // XIV starts partway through an uninstall, which leaves the journal for recovery.
    const remove = platform.removeFile.bind(platform)
    platform.removeFile = async (path) => {
      await remove(path)
      if (path.startsWith(`${A}\\game`)) m.gameRunning = true
    }
    await core.uninstall()
    platform.removeFile = remove
    expect(core.getState().recoveryRequired).toBe(true)
    m.gameRunning = false

    platform.answerPicker(B)
    await core.changeGameFolder()

    expect(await platform.pickFolder({ title: 'Choose the game folder' })).toBe(B)
    expect(core.getState()).toMatchObject({ recoveryRequired: true, gameFolder: { status: 'found', path: A } })
    expect((await readSettings(platform)).gameFolder).toBeNull()
  })

  it('leaves XIVLauncher’s auto-repair on the folder XIVLauncher launches, whichever folder the window looks after', async () => {
    const { platform, core } = await deployedOnA()
    platform.answerPicker(B)
    await core.changeGameFolder()
    expect((await readSettings(platform)).gameFolder).toBe(B)
    const b = await tree(platform, B)

    await platform.writeText(`${A}\\game\\winmm.dll`, 'Patched')
    expect(await runHeadless(platform, 'repair')).toEqual({ kind: 'repaired' })

    expect(await platform.readText(`${A}\\game\\winmm.dll`)).toBe('OptiScaler')
    expect(await tree(platform, B)).toEqual(b)
  })

  it('starts the other copy’s first-run flow from the first-install defaults, not from the picks made for the first', async () => {
    const platform = createFakePlatform(twoCopies())
    const core = createCore(platform)
    await core.scan()
    await core.continueSetup()
    const first = core.getState()
    const defaults = { activity: { kind: 'profile' }, setupMode: 'install', includeReShade: true, addToStartMenu: true, selectedProfile: first.selectedProfile,
      profiles: first.profiles, frameGenerationMode: first.frameGenerationMode, hdrMode: first.hdrMode, neuralRendering: first.neuralRendering, mfgUnlocked: first.mfgUnlocked }
    expect(first).toMatchObject(defaults)
    const other = first.profiles.find((profile) => profile.id !== first.selectedProfile)!.id
    await core.selectProfile(other)
    core.setIncludeReShade(false)
    core.setAddToStartMenu(false)
    await core.review()
    await core.deploy()
    core.finish()
    expect(core.getState()).toMatchObject({ error: null, selfInstalled: false, deployment: { gameFolder: A, includeReShade: false, profile: other } })

    platform.answerPicker(B)
    await core.changeGameFolder()
    await core.continueSetup()

    expect(core.getState()).toMatchObject({ ...defaults, error: null, gameFolder: { path: B }, deployment: null, resetBackupPath: null })
  })
})

describe('XIVLauncher auto-repair with a deployment in each copy', () => {
  /** Deployed on A, then on B through Change…, so the window looks after B. */
  async function deployedOnBoth() {
    const deployed = await deployedOnA()
    const { platform, core } = deployed
    platform.answerPicker(B)
    await core.changeGameFolder()
    await core.review()
    await core.deploy()
    core.finish()
    expect(core.getState()).toMatchObject({ error: null, deployment: { gameFolder: B }, xivLauncher: { status: 'found' } })
    return deployed
  }
  const runsAsAdmin = async (platform: FakePlatform) =>
    (JSON.parse(JSON.parse(await platform.readText(XIVLAUNCHER_CONFIG)).AddonList) as { Addon: { RunAsAdmin: boolean } }[]).map((entry) => entry.Addon.RunAsAdmin)

  it('runs as administrator when any deployed copy needs it, not only the one the window looks after', async () => {
    const { m, platform, core } = await deployedOnBoth()
    m.readOnlyDirectories = [`${A}\\game`]

    await core.setAutoRepair(true)

    expect(core.getState()).toMatchObject({ error: null, xivLauncher: { autoRepair: true } })
    expect(await runsAsAdmin(platform)).toEqual([true, true])
  })

  it('runs without administrator access when every deployed copy is writable', async () => {
    const { platform, core } = await deployedOnBoth()

    await core.setAutoRepair(true)

    expect(core.getState()).toMatchObject({ error: null, xivLauncher: { autoRepair: true } })
    expect(await runsAsAdmin(platform)).toEqual([false, false])
  })
})
