import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { readDeployment } from './deployment'
import { DEFAULT_ENV, createFakePlatform } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { MANIFEST_URL } from './manifest'
import { PROFILE_MANIFEST } from '../platform/contentFixture'
import type { MonitorInfo } from './platform'
import { runHeadless } from './autoRepair'
import { APP_RELEASES_URL } from './appUpdate'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`
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
  manifest.versions[0].tiers['rtx-30-40'].screenDerivedSettings = FRAME_CAPS
  // A content author may also list this key in a profile; the screen-derived value remains authoritative.
  for (const profile of manifest.versions[0].tiers['rtx-30-40'].performanceProfiles!) {
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

describe('screen-derived settings', () => {
  it('applies the frame cap after deployment and includes it in Lucent’s last-written config', async () => {
    const { platform, core } = await deploy()
    expect(core.getState().screen).toMatchObject({ refreshHz: 240, frameCap: 224, width: 3840, height: 2160, hdrSupported: true, hdrOn: false })
    const config = await platform.readText(`${GAME}\\OptiScaler.ini`)
    expect(config).toContain('FramerateLimit=224.000000')
    expect(config).toContain('FramerateTargetDMFG=224.000000')
    expect(config).toContain('DynamicTargetFPS=224.000000')
    expect((await readDeployment(platform, ROOT))?.ownedConfigs['OptiScaler.ini']).toContain('FramerateLimit=224.000000')
    expect((await platform.readText(`${DEFAULT_ENV.LocalAppData}\\Lucent\\lucent.log`))).toContain('Frame cap: 224 fps for a 240 Hz screen, was unset')
    const journalLength = (await readDeployment(platform, ROOT))!.journal.length
    const originalWriteText = platform.writeText.bind(platform)
    let configWrites = 0
    platform.writeText = async (path, text, staging) => {
      if (path.toLowerCase() === `${GAME}\\OptiScaler.ini`.toLowerCase()) configWrites++
      await originalWriteText(path, text, staging)
    }
    const reopened = createCore(platform)
    await reopened.scan()
    expect((await readDeployment(platform, ROOT))!.journal).toHaveLength(journalLength)
    expect(configWrites).toBe(0)
  })

  it('overwrites an overlay edit on open without reporting drift or Custom', async () => {
    const { platform } = await deploy()
    const config = `${GAME}\\OptiScaler.ini`
    await platform.writeText(config, (await platform.readText(config)).replace('FramerateLimit=224.000000', 'FramerateLimit=88.000000'))
    const reopened = createCore(platform)
    await reopened.scan()
    expect(await platform.readText(config)).toContain('FramerateLimit=224.000000')
    expect(reopened.getState().activity).toMatchObject({ kind: 'deployment', drift: null })
    expect(reopened.getState().customProfile).toBeNull()
  })

  it('keeps Scan available if Windows cannot enumerate monitors', async () => {
    const { platform } = await deploy()
    platform.getMonitors = async () => { throw new Error('monitor lookup failed') }
    const reopened = createCore(platform)
    await reopened.scan()
    expect(reopened.getState()).toMatchObject({ error: null, screen: null, activity: { kind: 'deployment' } })
  })

  it('does not change the cap while XIV is running', async () => {
    const { m, platform, core } = await deploy()
    const config = `${GAME}\\OptiScaler.ini`
    await platform.writeText(config, (await platform.readText(config)).replace('FramerateLimit=224.000000', 'FramerateLimit=88.000000'))
    await platform.writeText(CFG, (await platform.readText(CFG)).replace('Refreshrate 240', 'Refreshrate 144'))
    m.gameRunning = true
    await core.scan()
    expect(await platform.readText(config)).toContain('FramerateLimit=88.000000')
    expect(core.getState().screen).toMatchObject({ refreshHz: 144, frameCap: 138 })
  })

  it('keeps screen-derived config in place while the deployment is Disabled', async () => {
    const { platform, core } = await deploy()
    await core.setEnabled(false)
    await platform.writeText(CFG, (await platform.readText(CFG)).replace('Refreshrate 240', 'Refreshrate 144'))
    const reopened = createCore(platform)
    await reopened.scan()
    expect(reopened.getState().activity).toMatchObject({ kind: 'deployment', enabled: false })
    expect(await platform.readText(`${GAME}\\OptiScaler.ini`)).toContain('DynamicTargetFPS=138.000000')
    expect(await platform.stat(`${GAME}\\winmm.dll.disabled`)).toMatchObject({ kind: 'file' })
  })

  it('refreshes the cap before Launch starts XIV', async () => {
    const { platform, core } = await deploy()
    const config = `${GAME}\\OptiScaler.ini`
    await platform.writeText(config, (await platform.readText(config)).replace('FramerateLimit=224.000000', 'FramerateLimit=88.000000'))
    await platform.writeText(CFG, (await platform.readText(CFG)).replace('Refreshrate 240', 'Refreshrate 144'))
    await core.launchGame()
    expect(core.getState().screen).toMatchObject({ refreshHz: 144, frameCap: 138 })
    expect(await platform.readText(config)).toContain('FramerateLimit=138.000000')
    expect(platform.started).toHaveLength(1)
    expect(core.getState().error).toBeNull()
  })

  it('does not launch while an elevated screen sync is still pending', async () => {
    const { m, platform, core } = await deploy()
    const config = `${GAME}\\OptiScaler.ini`
    await platform.writeText(config, (await platform.readText(config)).replace('FramerateLimit=224.000000', 'FramerateLimit=88.000000'))
    await platform.writeText(CFG, (await platform.readText(CFG)).replace('Refreshrate 240', 'Refreshrate 144'))
    m.readOnlyDirectories = [GAME]
    await core.launchGame()
    expect(platform.started).toEqual([])
    expect(platform.elevationRequests).toHaveLength(1)
    expect(core.getState().notice).toMatch(/reopening with administrator access/)
  })

  it('refreshes screen settings in the headless check when XIV is not running yet', async () => {
    const { platform } = await deploy()
    const config = `${GAME}\\OptiScaler.ini`
    await platform.writeText(config, (await platform.readText(config)).replace('FramerateLimit=224.000000', 'FramerateLimit=88.000000'))
    await platform.writeText(CFG, (await platform.readText(CFG)).replace('Refreshrate 240', 'Refreshrate 144'))
    expect(await runHeadless(platform, 'check')).toEqual({ kind: 'healthy' })
    expect(await platform.readText(config)).toContain('FramerateLimit=138.000000')
  })

  it('leaves headless checks read-only while XIV is running', async () => {
    const { m, platform } = await deploy()
    const config = `${GAME}\\OptiScaler.ini`
    await platform.writeText(config, (await platform.readText(config)).replace('FramerateLimit=224.000000', 'FramerateLimit=88.000000'))
    await platform.writeText(CFG, (await platform.readText(CFG)).replace('Refreshrate 240', 'Refreshrate 144'))
    m.gameRunning = true
    expect(await runHeadless(platform, 'check')).toEqual({ kind: 'healthy' })
    expect(await platform.readText(config)).toContain('FramerateLimit=88.000000')
  })

  it('applies the cap on Repair even when the content health check is otherwise healthy', async () => {
    const { platform, core } = await deploy()
    const config = `${GAME}\\OptiScaler.ini`
    await platform.writeText(config, (await platform.readText(config)).replace('FramerateLimit=224.000000', 'FramerateLimit=88.000000'))
    await core.repair()
    expect(await platform.readText(config)).toContain('FramerateLimit=224.000000')
    expect(core.getState().activity).toMatchObject({ kind: 'deployment', drift: null })
  })

  it('refreshes screen settings in the headless repair after XIV closes', async () => {
    const { platform } = await deploy()
    const config = `${GAME}\\OptiScaler.ini`
    await platform.writeText(config, (await platform.readText(config)).replace('FramerateLimit=224.000000', 'FramerateLimit=88.000000'))
    await platform.writeText(CFG, (await platform.readText(CFG)).replace('Refreshrate 240', 'Refreshrate 144'))
    expect(await runHeadless(platform, 'repair')).toEqual({ kind: 'healthy' })
    expect(await platform.readText(config)).toContain('FramerateLimit=138.000000')
  })

  it('keeps the screen journal when headless repair also stamps a patched game version', async () => {
    const { platform } = await deploy()
    const patchedVersion = '2026.10.20.0000.0000'
    await platform.writeText(`${GAME}\\winmm.dll`, 'Patched by the game')
    await platform.writeText(`${GAME}\\ffxivgame.ver`, patchedVersion)
    await platform.writeText(CFG, (await platform.readText(CFG)).replace('Refreshrate 240', 'Refreshrate 144'))
    expect(await runHeadless(platform, 'repair')).toEqual({ kind: 'repaired' })
    const record = await readDeployment(platform, ROOT)
    expect(record?.gameVersion).toBe(patchedVersion)
    expect(record?.ownedConfigs['OptiScaler.ini']).toContain('FramerateLimit=138.000000')
    expect(record?.journal.some((entry) => entry.step?.kind === 'write' && entry.step.path === 'OptiScaler.ini' && entry.step.text?.includes('DynamicTargetFPS=138.000000'))).toBe(true)

    const reopened = createCore(platform)
    await reopened.scan()
    await reopened.uninstall()
    expect(reopened.getState().error).toBeNull()
    expect((await readDeployment(platform, ROOT))?.status).toBe('rolled-back')
    await expect(platform.stat(`${GAME}\\winmm.dll`)).rejects.toThrow()
  })

  it('reapplies the cap after selecting a profile that names the same key', async () => {
    const { platform, core } = await deploy()
    await core.selectProfile('balanced')
    expect(await platform.readText(`${GAME}\\OptiScaler.ini`)).toContain('FramerateLimit=224.000000')
    expect(core.getState().customProfile).toBeNull()
  })

  it('applies every declared cap after a content update', async () => {
    const { m, platform, core } = await deploy()
    const manifest = JSON.parse(m.remoteText![MANIFEST_URL]) as typeof PROFILE_MANIFEST
    const current = manifest.versions[0]
    manifest.versions.push({ ...structuredClone(current), id: '2026.11.02', changelog: ['Screen cap update.'] })
    m.remoteText![MANIFEST_URL] = JSON.stringify(manifest)
    await platform.writeText(CFG, (await platform.readText(CFG)).replace('Refreshrate 240', 'Refreshrate 144'))
    await core.checkForUpdates()
    expect(core.getState().activity).toMatchObject({ kind: 'deployment', update: { version: '2026.11.02' } })
    await core.update()
    expect(core.getState().error).toBeNull()
    expect(core.getState().deployment?.contentVersion).toBe('2026.11.02')
    const config = await platform.readText(`${GAME}\\OptiScaler.ini`)
    expect(config).toContain('FramerateLimit=138.000000')
    expect(config).toContain('FramerateTargetDMFG=138.000000')
    expect(config).toContain('DynamicTargetFPS=138.000000')
  })

  it('recovers an interrupted standalone screen sync before applying the current cap on open', async () => {
    const { platform, core } = await deploy()
    const config = `${GAME}\\OptiScaler.ini`
    await platform.writeText(config, (await platform.readText(config)).replace('FramerateLimit=224.000000', 'FramerateLimit=88.000000'))
    await platform.writeText(CFG, (await platform.readText(CFG)).replace('Refreshrate 240', 'Refreshrate 144'))
    const write = platform.writeText.bind(platform)
    let reachedCrash!: () => void
    const crashed = new Promise<void>((resolve) => { reachedCrash = resolve })
    platform.writeText = async (path, text, staging) => {
      await write(path, text, staging)
      if (path.toLowerCase() === config.toLowerCase() && text.includes('FramerateLimit=138.000000')) {
        reachedCrash()
        await new Promise<void>(() => {})
      }
    }
    void core.launchGame()
    await crashed
    platform.crash()
    platform.writeText = write
    const reopened = createCore(platform)
    await reopened.scan()
    expect(reopened.getState()).toMatchObject({ recoveryRequired: false, activity: { kind: 'deployment', drift: null } })
    expect((await readDeployment(platform, ROOT))?.status).toBe('complete')
    expect(await platform.readText(config)).toContain('FramerateLimit=138.000000')
  })
})
