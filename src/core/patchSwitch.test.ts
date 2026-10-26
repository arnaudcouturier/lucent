// Settings' "After a game patch" switch: `[FFXIV] FfxivUnknownBuildHooks` in the deployed OptiScaler.ini, set in place through the
// journal, remembered in the record, and written again wherever a baseline replaces the ini.
import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, DEFAULT_ENV, type FakePlatform } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, nextContentHost, vanillaGame, xivLauncher } from '../platform/fixtures'
import { PlatformError } from './platform'
import { readDeployment } from './deployment'
import { gameWriteAccess, takeElevationResume } from './gameAccess'
import { NEEDS_NEWER_CONTENT } from './gamePatch'
import { statusCard } from './statusCard'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`
const INI = `${GAME}\\OptiScaler.ini`
const KEY = /^FfxivUnknownBuildHooks\s*=.*$/m

/** A setup on content 2026.10.30 or newer, whose OptiScaler.ini has the key at its shipped `auto`. */
async function deployed(withKey = true) {
  const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  expect(core.getState().error).toBeNull()
  if (withKey) await platform.writeText(INI, `${await platform.readText(INI)}\r\n[FFXIV]\r\nFfxivUnknownBuildHooks = auto\r\nFfxivForceUnknownBuild = auto\r\n`)
  await core.refreshPatchSwitch()
  return { platform, core, m }
}

async function reopen(platform: FakePlatform) {
  const core = createCore(platform)
  await core.scan()
  await core.refreshPatchSwitch()
  return core
}

describe('reading the switch', () => {
  it('reads auto and false as off, and true as on', async () => {
    const { platform, core } = await deployed()
    expect(core.getState().patchSwitch).toEqual({ status: 'ready', on: false })
    await platform.writeText(INI, (await platform.readText(INI)).replace(KEY, 'FfxivUnknownBuildHooks = true'))
    await core.refreshPatchSwitch()
    expect(core.getState().patchSwitch).toEqual({ status: 'ready', on: true })
    await platform.writeText(INI, (await platform.readText(INI)).replace(KEY, 'FfxivUnknownBuildHooks = false'))
    await core.refreshPatchSwitch()
    expect(core.getState().patchSwitch).toEqual({ status: 'ready', on: false })
  })

  it('is unavailable when the ini predates the key, saying to update the content', async () => {
    const { core } = await deployed(false)
    expect(core.getState().patchSwitch).toEqual({ status: 'unavailable', reason: NEEDS_NEWER_CONTENT })
  })

  it('is unavailable when the ini is missing or not readable, saying which', async () => {
    const { platform, core } = await deployed()
    await platform.removeFile(INI)
    await core.refreshPatchSwitch()
    expect(core.getState().patchSwitch).toEqual({ status: 'unavailable', reason: 'OptiScaler.ini is missing. Repair puts it back.' })
    await platform.writeText(INI, '\0\0\0\0')
    await core.refreshPatchSwitch()
    expect(core.getState().patchSwitch).toEqual({ status: 'unavailable', reason: 'Lucent can’t read OptiScaler.ini.' })
  })

  it('is nothing without a deployment', async () => {
    const core = createCore(createFakePlatform(machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))))
    await core.scan()
    await core.refreshPatchSwitch()
    expect(core.getState().patchSwitch).toBeNull()
  })
})

describe('turning it on and off', () => {
  it('writes true to that one key, in place, and leaves every other byte of the file as it was', async () => {
    const { platform, core } = await deployed()
    const before = await platform.readText(INI)
    await core.setUnknownBuildHooks(true)
    expect(core.getState()).toMatchObject({ error: null, busy: false, patchSwitch: { status: 'ready', on: true }, deployment: { unknownBuildHooks: true } })
    expect(core.getState().notice).toMatch(/stay on, from the next time XIV starts/)
    expect(await platform.readText(INI)).toBe(before.replace(KEY, 'FfxivUnknownBuildHooks = true'))
    expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
  })

  it('writes false, not auto, when it is turned off again, so a later default of on leaves it off', async () => {
    const { platform, core } = await deployed()
    await core.setUnknownBuildHooks(true)
    await core.setUnknownBuildHooks(false)
    expect(await platform.readText(INI)).toMatch(/FfxivUnknownBuildHooks = false/)
    expect(core.getState()).toMatchObject({ patchSwitch: { status: 'ready', on: false }, deployment: { unknownBuildHooks: false } })
  })

  it('does not touch the ini or the record while the player never uses it', async () => {
    const { platform, core } = await deployed()
    expect(await platform.readText(INI)).toMatch(/FfxivUnknownBuildHooks = auto/)
    expect(core.getState().deployment).not.toHaveProperty('unknownBuildHooks')
  })

  it('journals the write, so Uninstall leaves the game folder vanilla', async () => {
    const { platform, core } = await deployed()
    await core.setUnknownBuildHooks(true)
    const record = (await readDeployment(platform, ROOT))!
    expect(record.status).toBe('complete')
    expect(record.journal.at(-1)).toMatchObject({ step: { kind: 'ini_set', section: 'FFXIV', key: 'FfxivUnknownBuildHooks', value: 'true' } })
    await core.uninstall()
    expect(core.getState().error).toBeNull()
    expect(await platform.listFiles(GAME)).toEqual(['ffxiv_dx11.exe', 'ffxivgame.ver'])
  })

  it('records the word of a player who turns it on when the ini already says so', async () => {
    const { platform, core } = await deployed()
    await platform.writeText(INI, (await platform.readText(INI)).replace(KEY, 'FfxivUnknownBuildHooks = true'))
    const journal = (await readDeployment(platform, ROOT))!.journal.length
    await core.setUnknownBuildHooks(true)
    expect((await readDeployment(platform, ROOT))).toMatchObject({ unknownBuildHooks: true, status: 'complete' })
    expect((await readDeployment(platform, ROOT))!.journal).toHaveLength(journal)
  })

  it('refuses while XIV runs, and changes nothing', async () => {
    const { platform, core, m } = await deployed()
    const before = await platform.readText(INI)
    m.gameRunning = true
    await core.setUnknownBuildHooks(true)
    expect(core.getState().error).toBeTruthy()
    expect(await platform.readText(INI)).toBe(before)
    expect((await readDeployment(platform, ROOT))).not.toHaveProperty('unknownBuildHooks')
    expect(core.getState().busy).toBe(false)
  })

  it('says to update the content when the ini has no such key, and writes nothing', async () => {
    const { platform, core } = await deployed(false)
    const before = await platform.readText(INI)
    await core.setUnknownBuildHooks(true)
    expect(core.getState().error).toBe(NEEDS_NEWER_CONTENT)
    expect(await platform.readText(INI)).toBe(before)
  })

  it('does not write over an ini another program holds open', async () => {
    const { platform, core } = await deployed()
    const before = await platform.readText(INI)
    const read = platform.readText.bind(platform)
    platform.readText = async (path) => { if (path === INI) throw new PlatformError('locked', 'In use', path); return read(path) }
    await core.setUnknownBuildHooks(true)
    platform.readText = read
    expect(core.getState().error).toMatch(/in use/i)
    expect(await platform.readText(INI)).toBe(before)
  })
})

describe('keeping it', () => {
  it('writes it again after a Reset, which rewrites OptiScaler.ini from the baseline', async () => {
    const { platform, core } = await deployed()
    await core.setUnknownBuildHooks(true)
    await core.resetSetup()
    await core.review()
    await core.deploy()
    core.finish()
    expect(core.getState()).toMatchObject({ error: null, deployment: { unknownBuildHooks: true } })
    expect(await platform.readText(INI)).toMatch(/FfxivUnknownBuildHooks=true/)
  })

  it('leaves a Reset’s ini without the key while the player never used the switch', async () => {
    const { platform, core } = await deployed()
    await core.resetSetup()
    await core.review()
    await core.deploy()
    core.finish()
    expect(await platform.readText(INI)).not.toMatch(/FfxivUnknownBuildHooks/)
  })

  it('writes it again when Repair puts a missing OptiScaler.ini back', async () => {
    const { platform, core } = await deployed()
    await core.setUnknownBuildHooks(false)
    await platform.removeFile(INI)
    const reopened = await reopen(platform)
    await reopened.repair()
    expect(statusCard(reopened.getState())).toEqual({ kind: 'healthy' })
    expect(await platform.readText(INI)).toMatch(/FfxivUnknownBuildHooks=false/)
  })

  it('writes it again when a new graphics card rewrites the baseline, which starts from the shipped ini', async () => {
    const { platform, core, m } = await deployed()
    await core.setUnknownBuildHooks(true)
    const before = await platform.readText(INI)
    m.gpus = graphicsCard('NVIDIA GeForce RTX 3080').gpus
    const changed = await reopen(platform)
    await changed.switchTier()
    await changed.review()
    await changed.deploy()
    expect(changed.getState()).toMatchObject({ error: null, deployment: { unknownBuildHooks: true } })
    const after = await platform.readText(INI)
    // The ini really was rewritten from the baseline for the new card, and the key is the player's.
    expect(after).not.toBe(before)
    expect(after).toMatch(/FfxivUnknownBuildHooks\s*=\s*true/)
  })

  it('keeps it through a content update, which leaves the player’s ini as it is', async () => {
    const { platform, core, m } = await deployed()
    await core.setUnknownBuildHooks(true)
    Object.assign(m.remoteText!, nextContentHost().remoteText)
    const reopened = await reopen(platform)
    await reopened.update()
    expect(reopened.getState()).toMatchObject({ error: null, deployment: { unknownBuildHooks: true } })
    expect(await platform.readText(INI)).toMatch(/FfxivUnknownBuildHooks = true/)
  })
})

describe('while Lucent and the game folder have other claims', () => {
  it('waits for another Lucent process that holds the lease, and writes nothing', async () => {
    const { platform, core } = await deployed()
    const before = await platform.readText(INI)
    const token = await platform.acquireOperationLock(`${DEFAULT_ENV.LocalAppData}\\Lucent`)
    await core.setUnknownBuildHooks(true)
    await platform.releaseOperationLock(token)
    expect(core.getState().error).toMatch(/Another Lucent operation is using its files/)
    expect(await platform.readText(INI)).toBe(before)
  })

  it('asks for administrator access on a game folder that needs it, and sets the switch once it has it', async () => {
    const { platform, core, m } = await deployed()
    m.readOnlyDirectories = [GAME]
    await core.setUnknownBuildHooks(true)
    expect(platform.elevationRequests).toHaveLength(1)
    expect(JSON.parse(await platform.readText(platform.elevationRequests[0])).request).toMatchObject({ kind: 'unknown-build-hooks', on: true })
    expect(await platform.readText(INI)).toMatch(/FfxivUnknownBuildHooks = auto/)
    m.elevated = true
    const resumed = createCore(platform)
    await resumed.scan()
    expect(resumed.getState().error).toBeNull()
    expect(await platform.readText(INI)).toMatch(/FfxivUnknownBuildHooks = true/)
    expect(resumed.getState().deployment).toMatchObject({ unknownBuildHooks: true })
  })
})

describe('with administrator access', () => {
  const PLAYER = 'S-1-5-21-100-200-300-1001'
  const RESUME = 'C:\\Users\\Player\\AppData\\Local\\Lucent\\resume-123e4567-e89b-12d3-a456-426614174000.json'
  const resumeWith = (request: unknown) => createFakePlatform({ elevated: true, userSid: PLAYER, elevationResumePath: RESUME, files: { [RESUME]: JSON.stringify({ schemaVersion: 2, userSid: PLAYER, request }) } })

  it('asks for it on a game folder that needs it, and the elevated process takes the request back', async () => {
    const original = createFakePlatform({ readOnlyDirectories: [GAME], userSid: PLAYER })
    await expect(gameWriteAccess(original, () => {})({ kind: 'unknown-build-hooks', gameFolder: ROOT, on: true }, ['OptiScaler.ini'])).resolves.toBe(false)
    const path = original.elevationRequests[0]
    const elevated = createFakePlatform({ elevated: true, userSid: 'S-1-5-21-999-999-999-500', elevationResumePath: path, files: { [path]: await original.readText(path) } })
    await expect(takeElevationResume(elevated)).resolves.toMatchObject({ userSid: PLAYER, request: { kind: 'unknown-build-hooks', gameFolder: ROOT, on: true } })
  })

  it('rejects a request whose switch is not a boolean', async () => {
    await expect(takeElevationResume(resumeWith({ kind: 'unknown-build-hooks', gameFolder: ROOT, on: 'yes' }))).rejects.toThrow(/administrator resume request is invalid/)
    await expect(takeElevationResume(resumeWith({ kind: 'unknown-build-hooks', gameFolder: ROOT }))).rejects.toThrow(/administrator resume request is invalid/)
  })
})
