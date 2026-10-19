import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { readDeployment } from './deployment'
import { DEFAULT_ENV, createFakePlatform, type FakePlatform } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { MANIFEST_URL } from './manifest'
import { PROFILE_MANIFEST } from '../platform/contentFixture'
import type { MonitorInfo } from './platform'
import { runHeadless } from './autoRepair'
import { APP_RELEASES_URL } from './appUpdate'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`
const CONFIG = `${GAME}\\OptiScaler.ini`
const CFG = `${DEFAULT_ENV.Documents}\\My Games\\FINAL FANTASY XIV - A Realm Reborn\\FFXIV.cfg`
const FRAME_CAPS = [
  { file: 'OptiScaler.ini', section: 'Framerate', key: 'FramerateLimit', value: 'frameCap' as const },
  { file: 'OptiScaler.ini', section: 'DLSSG', key: 'FramerateTargetDMFG', value: 'frameCap' as const },
  { file: 'OptiScaler.ini', section: 'XeFG', key: 'DynamicTargetFPS', value: 'frameCap' as const },
]
const monitor = (refreshHz: number): MonitorInfo => ({
  deviceName: '\\\\.\\DISPLAY1', bounds: { left: 0, top: 0, right: 3840, bottom: 2160 }, primary: true,
  refreshHz, width: 3840, height: 2160, hdrSupported: true, hdrOn: false, peakNits: 1000,
})

function screenMachine(refreshHz = 240) {
  const content = fixtureContentHost()
  const manifest = structuredClone(PROFILE_MANIFEST)
  manifest.versions[0].tiers['rtx-20-30-40'].screenDerivedSettings = FRAME_CAPS
  // A content author may also list this key in a profile; the screen-derived value remains authoritative.
  for (const profile of manifest.versions[0].tiers['rtx-20-30-40'].performanceProfiles!) {
    profile.settings.push({ ...FRAME_CAPS[0], value: '120' })
  }
  return machine(content, {
    remoteText: { ...content.remoteText, [MANIFEST_URL]: JSON.stringify(manifest), [APP_RELEASES_URL]: '[]' },
    monitors: [monitor(refreshHz)],
    files: { [CFG]: `<Display Settings>\r\nMainAdapter\r\nScreenLeft 100\r\nScreenTop 100\r\nScreenMode 1\r\nFullScreenWidth 3840\r\nFullScreenHeight 2160\r\nRefreshrate ${refreshHz}\r\n` },
  }, graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))
}

async function deploy(refreshHz = 240) {
  const m = screenMachine(refreshHz)
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  return { m, platform, core }
}

const setRefresh = async (platform: FakePlatform, from: number, to: number) =>
  platform.writeText(CFG, (await platform.readText(CFG)).replace(`Refreshrate ${from}`, `Refreshrate ${to}`))

/** Every way Lucent could put bytes at `path`: a write, a copy, a rename or a removal. */
function trackWrites(platform: FakePlatform, path: string) {
  const writes: string[] = []
  const hits = (...paths: string[]) => paths.some((p) => p.toLowerCase() === path.toLowerCase())
  const wrap = <K extends 'writeText' | 'copyFile' | 'renameFile' | 'removeFile'>(name: K, targets: (...args: Parameters<FakePlatform[K]>) => string[]) => {
    const original = platform[name].bind(platform) as (...args: unknown[]) => Promise<void>
    ;(platform as unknown as Record<string, unknown>)[name] = async (...args: Parameters<FakePlatform[K]>) => {
      if (hits(...targets(...args))) writes.push(name)
      await original(...args)
    }
  }
  wrap('writeText', (to) => [to])
  wrap('copyFile', (_from, to) => [to])
  wrap('renameFile', (from, to) => [from, to])
  wrap('removeFile', (target) => [target])
  const copyMany = platform.copyMany.bind(platform)
  platform.copyMany = async (items, staging) => {
    if (hits(...items.map((item) => item.to))) writes.push('copyMany')
    await copyMany(items, staging)
  }
  const removeMany = platform.removeMany.bind(platform)
  platform.removeMany = async (paths) => {
    if (hits(...paths)) writes.push('removeMany')
    await removeMany(paths)
  }
  return writes
}

describe('screen-derived settings', () => {
  it('writes the frame cap with the baseline', async () => {
    const { platform, core } = await deploy()
    expect(core.getState().screen).toMatchObject({ refreshHz: 240, frameCap: 224, width: 3840, height: 2160, hdrSupported: true, hdrOn: false })
    const config = await platform.readText(CONFIG)
    expect(config).toContain('FramerateLimit=224.000000')
    expect(config).toContain('FramerateTargetDMFG=224.000000')
    expect(config).toContain('DynamicTargetFPS=224.000000')
  })

  it('takes the cap from the screen as it is when the deployment is written', async () => {
    const { m, platform } = await deploy(144)
    expect(await platform.readText(CONFIG)).toContain('FramerateLimit=138.000000')
    expect(m.monitors![0].refreshHz).toBe(144)
  })

  it('keeps Scan available if Windows cannot enumerate monitors', async () => {
    const { platform } = await deploy()
    platform.getMonitors = async () => { throw new Error('monitor lookup failed') }
    const reopened = createCore(platform)
    await reopened.scan()
    expect(reopened.getState()).toMatchObject({ error: null, screen: null, activity: { kind: 'deployment' } })
  })

  describe('after the deployment', () => {
    /** The player tuned the cap in OptiScaler's overlay, and has since changed monitors. */
    async function tuned() {
      const deployed = await deploy()
      const edited = (await deployed.platform.readText(CONFIG)).replace('FramerateLimit=224.000000', 'FramerateLimit=88.000000')
      await deployed.platform.writeText(CONFIG, edited)
      await setRefresh(deployed.platform, 240, 144)
      const journalLength = (await readDeployment(deployed.platform, ROOT))!.journal.length
      const writes = trackWrites(deployed.platform, CONFIG)
      return { ...deployed, edited, journalLength, writes }
    }
    const untouched = async ({ platform, edited, journalLength, writes }: Awaited<ReturnType<typeof tuned>>) => {
      expect(writes).toEqual([])
      expect(await platform.readText(CONFIG)).toBe(edited)
      expect((await readDeployment(platform, ROOT))!.journal).toHaveLength(journalLength)
    }

    it('opening Lucent never writes OptiScaler.ini', async () => {
      const setup = await tuned()
      const reopened = createCore(setup.platform)
      await reopened.scan()
      expect(reopened.getState()).toMatchObject({ error: null, activity: { kind: 'deployment', drift: null }, screen: { refreshHz: 144, frameCap: 138 } })
      await untouched(setup)
    })

    it('opening Lucent while XIV runs never writes it either', async () => {
      const setup = await tuned()
      await createCore(setup.platform).scan()
      setup.m.gameRunning = true
      await createCore(setup.platform).scan()
      await untouched(setup)
    })

    it('Launch XIV never writes OptiScaler.ini', async () => {
      const setup = await tuned()
      await setup.core.launchGame()
      expect(setup.core.getState().error).toBeNull()
      expect(setup.platform.started).toHaveLength(1)
      await untouched(setup)
    })

    it('does not hold Launch XIV for administrator access to a config', async () => {
      const setup = await tuned()
      setup.m.readOnlyDirectories = [GAME]
      await setup.core.launchGame()
      expect(setup.platform.elevationRequests).toEqual([])
      expect(setup.platform.started).toHaveLength(1)
      await untouched(setup)
    })

    it('XIVLauncher’s check and its repair never write OptiScaler.ini', async () => {
      const setup = await tuned()
      expect(await runHeadless(setup.platform, 'check')).toEqual({ kind: 'healthy' })
      expect(await runHeadless(setup.platform, 'repair')).toEqual({ kind: 'healthy' })
      setup.m.gameRunning = true
      expect(await runHeadless(setup.platform, 'check')).toEqual({ kind: 'healthy' })
      await untouched(setup)
    })

    it('Repair puts back a patched file and leaves OptiScaler.ini as it is, headless or not', async () => {
      const setup = await tuned()
      await setup.platform.writeText(`${GAME}\\winmm.dll`, 'Patched by the game')
      expect(await runHeadless(setup.platform, 'repair')).toEqual({ kind: 'repaired' })
      expect(await setup.platform.readText(`${GAME}\\winmm.dll`)).toBe('OptiScaler')

      await setup.platform.writeText(`${GAME}\\winmm.dll`, 'Patched again')
      const reopened = createCore(setup.platform)
      await reopened.scan()
      await reopened.repair()
      expect(reopened.getState()).toMatchObject({ error: null, activity: { kind: 'deployment', drift: null } })
      expect(setup.writes).toEqual([])
      expect(await setup.platform.readText(CONFIG)).toBe(setup.edited)
    })

    it('stamps a patched game version without touching OptiScaler.ini, and uninstall still works', async () => {
      const setup = await tuned()
      const patchedVersion = '2026.10.20.0000.0000'
      await setup.platform.writeText(`${GAME}\\winmm.dll`, 'Patched by the game')
      await setup.platform.writeText(`${GAME}\\ffxivgame.ver`, patchedVersion)
      expect(await runHeadless(setup.platform, 'repair')).toEqual({ kind: 'repaired' })
      expect((await readDeployment(setup.platform, ROOT))?.gameVersion).toBe(patchedVersion)
      expect(setup.writes).toEqual([])

      const reopened = createCore(setup.platform)
      await reopened.scan()
      await reopened.uninstall()
      expect(reopened.getState().error).toBeNull()
      expect((await readDeployment(setup.platform, ROOT))?.status).toBe('rolled-back')
      await expect(setup.platform.stat(`${GAME}\\winmm.dll`)).rejects.toThrow()
    })
  })

  describe('on a content update', () => {
    async function publishUpdate(m: Awaited<ReturnType<typeof deploy>>['m']) {
      const manifest = JSON.parse(m.remoteText![MANIFEST_URL]) as typeof PROFILE_MANIFEST
      manifest.versions.push({ ...structuredClone(manifest.versions[0]), id: '2026.11.02', changelog: ['Screen cap update.'] })
      m.remoteText![MANIFEST_URL] = JSON.stringify(manifest)
    }

    it('keeps the caps Lucent wrote even when the screen has changed, whatever the player tuned', async () => {
      const { m, platform, core } = await deploy()
      await publishUpdate(m)
      await platform.writeText(CONFIG, (await platform.readText(CONFIG)).replace('FramerateLimit=224.000000', 'FramerateLimit=88.000000'))
      await setRefresh(platform, 240, 144)
      await core.checkForUpdates()
      expect(core.getState().activity).toMatchObject({ kind: 'deployment', update: { version: '2026.11.02' } })
      await core.update()
      expect(core.getState().error).toBeNull()
      expect(core.getState().deployment?.contentVersion).toBe('2026.11.02')
      const config = await platform.readText(CONFIG)
      expect(config).toContain('FramerateLimit=88.000000')
      expect(config).toContain('FramerateTargetDMFG=224.000000')
      expect(config).toContain('DynamicTargetFPS=224.000000')
    })

    /** The next version with the given rule on OptiScaler.ini and, for the first cap, a cap the version adds. */
    function publishCapUpdate(m: Awaited<ReturnType<typeof deploy>>['m'], rule: 'addMissingKeys' | 'replace') {
      const manifest = JSON.parse(m.remoteText![MANIFEST_URL]) as typeof PROFILE_MANIFEST
      const added = { file: 'OptiScaler.ini', section: 'Framerate', key: 'FramerateLimitBackup', value: 'frameCap' as const }
      manifest.versions.push({ ...structuredClone(manifest.versions[0]), id: '2026.11.02', changelog: ['A new cap.'] })
      const recipe = manifest.versions[1].tiers['rtx-20-30-40']
      recipe.screenDerivedSettings = [...FRAME_CAPS, added]
      recipe.ownedConfigs.find((c) => c.path === 'OptiScaler.ini')!.update = rule
      m.remoteText![MANIFEST_URL] = JSON.stringify(manifest)
    }

    it('adding missing keys computes the cap the update adds from the screen it runs on, and leaves the caps on disk', async () => {
      const { m, platform, core } = await deploy()
      publishCapUpdate(m, 'addMissingKeys')
      await setRefresh(platform, 240, 144)
      await core.checkForUpdates()
      await core.update()
      expect(core.getState().error).toBeNull()
      const config = await platform.readText(CONFIG)
      expect(config).toContain('FramerateLimitBackup=138.000000')
      expect(config).toContain('FramerateLimit=224.000000')
    })

    it('replacing writes the caps from the screen it runs on', async () => {
      const { m, platform, core } = await deploy()
      publishCapUpdate(m, 'replace')
      await platform.writeText(CONFIG, (await platform.readText(CONFIG)).replace('FramerateLimit=224.000000', 'FramerateLimit=88.000000'))
      await setRefresh(platform, 240, 144)
      await core.checkForUpdates()
      await core.update()
      expect(core.getState().error).toBeNull()
      const config = await platform.readText(CONFIG)
      expect(config).toContain('FramerateLimit=138.000000')
      expect(config).toContain('FramerateLimitBackup=138.000000')
      expect(config).toContain('DynamicTargetFPS=138.000000')
    })

    it('keeps a cap the player tuned when the screen has not changed', async () => {
      const { m, platform, core } = await deploy()
      await publishUpdate(m)
      await platform.writeText(CONFIG, (await platform.readText(CONFIG)).replace('FramerateLimit=224.000000', 'FramerateLimit=88.000000'))
      await core.checkForUpdates()
      await core.update()
      expect(core.getState().error).toBeNull()
      expect(core.getState().deployment?.contentVersion).toBe('2026.11.02')
      expect(await platform.readText(CONFIG)).toContain('FramerateLimit=88.000000')
    })
  })
})
