import { expect, it } from 'vitest'
import { createCore } from './core'
import { PlatformError } from './platform'
import { createFakePlatform } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { PROFILE_MANIFEST } from '../platform/contentFixture'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`

async function deployed() {
  const fixture = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))
  fixture.gpus!.forEach((gpu) => { gpu.driverVersion = '32.0.15.6094' })
  const platform = createFakePlatform(fixture)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  return { platform, core }
}

it('copies the player’s versions, tier, GPU driver, Windows and health check with file hashes', async () => {
  const { platform, core } = await deployed()
  await core.copyDiagnostics()
  expect(platform.clipboard).toEqual(expect.stringContaining([
    'App version: 0.1.0',
    'Content version: 2026.10.12',
    'Channel: Stable',
  ].join('\n')))
  for (const field of ['RTX 4090', 'Tier status: Stable', 'GPU driver: 32.0.15.6094',
    'Windows: Windows 11 24H2 (build 26100.2033)', 'Game version: 2026.09.30.0000.0000',
    'Health check: Healthy', 'winmm.dll', 'f1a59411e0090ae0608b2e78d73533a7f6ba41442589345f46631822f2dbae02']) {
    expect(platform.clipboard).toContain(field)
  }
})

it('copies only the last 300 OptiScaler log lines, including logs ending with CRLF', async () => {
  const { platform, core } = await deployed()
  await platform.writeText(`${GAME}\\OptiScaler.log`, Array.from({ length: 305 }, (_, i) => `Log line ${i + 1}`).join('\r\n') + '\r\n')
  await core.copyDiagnostics()
  const log = platform.clipboard!.split('OptiScaler log (last 300 lines):\n')[1]
  expect(log?.split('\n')).toHaveLength(300)
  expect(log?.split('\n')[0]).toBe('Log line 6')
  expect(log?.split('\n').at(-1)).toBe('Log line 305')
})

it('copies diagnostics before opening a bug report template that asks the player to paste them', async () => {
  const { platform, core } = await deployed()
  await platform.writeText(`${GAME}\\OptiScaler.log`, 'Player log stays on the clipboard')
  await core.reportBug()
  expect(platform.clipboard).toContain('Player log stays on the clipboard')
  expect(platform.openedUrls).toHaveLength(1)
  const url = new URL(platform.openedUrls[0])
  expect(url.origin + url.pathname).toBe('https://github.com/arnaudcouturier/lucent/issues/new')
  expect(url.searchParams.get('body')).toContain('Paste the diagnostics from your clipboard')
  expect(url.searchParams.get('body')).toContain('Steps to reproduce')
  expect(url.searchParams.get('title')).toContain('RTX 30/40')
  expect(url.searchParams.get('title')).toContain('RTX 4090')
  expect(url.href).not.toContain('Player%20log')
})

it('checks current file bytes and game version rather than copying the old healthy result', async () => {
  const { platform, core } = await deployed()
  const original = await platform.stat(`${GAME}\\winmm.dll`)
  await platform.writeText(`${GAME}\\winmm.dll`, 'ChangedDLL')
  platform.setModifiedTime(`${GAME}\\winmm.dll`, original.modifiedMs)
  await platform.writeText(`${GAME}\\ffxivgame.ver`, '2026.10.20.0000.0000')
  await core.copyDiagnostics()
  expect(platform.clipboard).toContain('Game version: 2026.10.20.0000.0000')
  expect(platform.clipboard).toContain('Health check: Drift')
  expect(platform.clipboard).toContain('Drift: winmm.dll')
  expect(platform.clipboard).toContain('Actual: e43fc7c4f19085e3af24d5bbbbaef088056e63d8420a7ff015d71a70657bd6c0')
})

it('does not open an issue when Windows refuses to copy diagnostics', async () => {
  const { platform, core } = await deployed()
  platform.copyText = async () => { throw new PlatformError('locked', 'Clipboard is in use') }
  await core.reportBug()
  expect(platform.openedUrls).toEqual([])
  expect(core.getState().error).toContain('Clipboard is in use')
  expect(core.getState().busy).toBe(false)
})

it('still copies usable diagnostics when a deployed file is missing and the log cannot be read', async () => {
  const { platform, core } = await deployed()
  await platform.removeFile(`${GAME}\\winmm.dll`)
  platform.deny(`${GAME}\\OptiScaler.log`)
  await core.copyDiagnostics()
  expect(core.getState().error).toBeNull()
  expect(platform.clipboard).toContain('Health check: Drift')
  expect(platform.clipboard).toContain('Drift: winmm.dll')
  expect(platform.clipboard).toContain('Actual: Unavailable')
  expect(platform.clipboard).toContain('OptiScaler log: Unavailable')
  expect(platform.clipboard).toContain('Expected: f1a59411e0090ae0608b2e78d73533a7f6ba41442589345f46631822f2dbae02')
})

it('reports a disabled deployment and user config changes as healthy while including their current hashes', async () => {
  const { platform, core } = await deployed()
  await core.setEnabled(false)
  await platform.writeText(`${GAME}\\ReShade.ini`, '[GENERAL]\nPresetPath=MyPreset.ini\n')
  await core.copyDiagnostics()
  expect(platform.clipboard).toContain('Deployment: Disabled')
  expect(platform.clipboard).toContain('Health check: Healthy')
  expect(platform.clipboard).toContain('winmm.dll.disabled')
  expect(platform.clipboard).toContain('Actual: d65d092a44dd23e73dc548bcf704b0abb0633a76e2c0fcb9fefe1b370f304989')
})

it('can copy a report with explicit unavailable fields before a deployment exists', async () => {
  const platform = createFakePlatform()
  platform.getWindowsVersion = async () => { throw new PlatformError('unknown', 'Windows info unavailable') }
  const core = createCore(platform)
  await core.scan()
  await core.copyDiagnostics()
  expect(core.getState().error).toBeNull()
  expect(platform.clipboard).toContain('Content version: None deployed')
  expect(platform.clipboard).toContain('GPU driver: Unavailable')
  expect(platform.clipboard).toContain('Windows: Unavailable')
  expect(platform.clipboard).toContain('Health check: No deployment')
  expect(platform.clipboard).not.toContain('OptiScaler log')
})

it('keeps the deployed tier in the report title when the manifest no longer describes it', async () => {
  const { platform, core } = await deployed()
  const manifest = structuredClone(PROFILE_MANIFEST)
  manifest.tiers = manifest.tiers.filter((tier) => tier.id !== 'rtx-30-40')
  for (const version of manifest.versions) delete version.tiers['rtx-30-40']
  platform.fetchText = async () => JSON.stringify(manifest)
  await core.scan()
  await core.reportBug()
  expect(platform.clipboard).toContain('Tier: rtx-30-40')
  expect(new URL(platform.openedUrls[0]).searchParams.get('title')).toContain('rtx-30-40')
})
