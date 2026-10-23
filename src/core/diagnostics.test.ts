import { expect, it } from 'vitest'
import { createCore } from './core'
import { PlatformError } from './platform'
import { createFakePlatform } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { PROFILE_MANIFEST } from '../platform/contentFixture'
import { collectDiagnostics } from './diagnostics'
import { dataPaths, readDeployment } from './deployment'

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

it('copies the player’s versions, tier, GPU driver, Windows and health check, and only counts the files that match', async () => {
  const { platform, core } = await deployed()
  await core.copyDiagnostics()
  expect(platform.clipboard).toEqual(expect.stringContaining([
    `App version: ${__APP_VERSION__}`,
    'Content version: 2026.10.12',
    'Channel: Stable',
  ].join('\n')))
  const files = Object.keys(core.getState().deployment!.files).length
  for (const field of ['RTX 4090', 'Tier status: Stable', 'GPU driver: 32.0.15.6094',
    'Windows: Windows 11 24H2 (build 26100.2033)', 'Game version: 2026.09.30.0000.0000',
    'Health check: Healthy', `File hashes (SHA-256): ${files} of ${files} files match what Lucent deployed.`]) {
    expect(platform.clipboard).toContain(field)
  }
  // A matching file needs no line of its own.
  expect(platform.clipboard).not.toContain('f1a59411e0090ae0608b2e78d73533a7f6ba41442589345f46631822f2dbae02')
})

it('copies the stored first-install choices, the launcher and auto-repair', async () => {
  const { platform, core } = await deployed()
  await core.copyDiagnostics()
  const { profile } = core.getState().deployment!
  expect(platform.clipboard).toMatch(new RegExp(`First-install choices: ${profile ? `\\w+ profile, ` : ''}.*ReShade included\\n`, 'i'))
  expect(platform.clipboard).toContain('Launch XIV with: Square Enix launcher')
  expect(platform.clipboard).toContain('XIVLauncher auto-repair: Off')
  await core.setAutoRepair(true)
  await core.copyDiagnostics()
  expect(platform.clipboard).toContain('XIVLauncher auto-repair: On')
})

it('leaves the Windows account name out of every path', async () => {
  const { platform, core } = await deployed()
  await platform.writeText(`${GAME}\\OptiScaler.log`, 'Loaded C:\\Users\\Arnaud Couturier\\AppData\\Local\\Temp\\x.dll\nSaved to c:/users/arnaud/Pictures/shot.png')
  await core.copyDiagnostics()
  expect(platform.clipboard).toContain('Loaded C:\\Users\\<user>\\AppData\\Local\\Temp\\x.dll')
  expect(platform.clipboard).toContain('Saved to c:/users/<user>/Pictures/shot.png')
  expect(platform.clipboard).not.toMatch(/arnaud/i)
})

it('stays under GitHub’s issue size limit by keeping only the newest log lines that fit', async () => {
  const { platform, core } = await deployed()
  const line = (i: number) => `Log line ${i} ${'x'.repeat(400)}`
  await platform.writeText(`${GAME}\\OptiScaler.log`, Array.from({ length: 300 }, (_, i) => line(i + 1)).join('\n'))
  await core.copyDiagnostics()
  const text = platform.clipboard!
  expect(text.length).toBeLessThan(65_536)
  expect(text).toMatch(/OptiScaler log \(last \d+ lines\):/)
  expect(text.endsWith(line(300))).toBe(true)
  expect(text).not.toContain(`${line(1)}\n`)
})

it('lists only the first files that differ when nearly everything does', async () => {
  const { platform, core } = await deployed()
  const record = (await readDeployment(platform, ROOT))!
  for (let i = 0; i < 2000; i++) record.files[`reshade-shaders\\Shaders\\Generated ${i} with a long enough name.fx`] = { ...record.files['winmm.dll'], sha256: 'a'.repeat(64) }
  const text = await collectDiagnostics(platform, { ...core.getState(), deployment: record }, '0.1.0', 'stable')
  expect(text.length).toBeLessThan(65_536)
  expect(text).toMatch(/and \d[\d,]* more files differ/)
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
  expect(url.searchParams.get('title')).toContain('RTX 20/30/40')
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

it('collecting diagnostics from an older UI snapshot never persists its health stamps over a newer journal', async () => {
  const { platform, core } = await deployed()
  const stale = core.getState()
  const current = (await readDeployment(platform, ROOT))!
  current.contentVersion = '2026.10.13'
  current.profile = 'balanced'
  const path = (await dataPaths(platform, ROOT)).record
  const text = JSON.stringify(current, null, 2)
  await platform.writeText(path, text)
  platform.setModifiedTime(`${GAME}\\winmm.dll`, 1000)
  await platform.writeText(`${GAME}\\ffxivgame.ver`, '2026.10.20.0000.0000')
  const diagnostics = await collectDiagnostics(platform, stale, '0.1.0', 'stable')
  expect(diagnostics).toContain('Health check: Healthy')
  expect(await platform.readText(path)).toBe(text)
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

it('reports a disabled deployment and user config changes as healthy, naming the changed configs apart from mismatches', async () => {
  const { platform, core } = await deployed()
  await core.setEnabled(false)
  await platform.writeText(`${GAME}\\ReShade.ini`, '[GENERAL]\nPresetPath=MyPreset.ini\n')
  await core.copyDiagnostics()
  const files = Object.keys(core.getState().deployment!.files).length
  expect(platform.clipboard).toContain('Deployment: Disabled')
  expect(platform.clipboard).toContain('Health check: Healthy')
  // The renamed entry files match; the player's own config is theirs to change, not a mismatch.
  expect(platform.clipboard).toContain(`File hashes (SHA-256): ${files - 1} of ${files} files match what Lucent deployed.`)
  expect(platform.clipboard).toContain('Changed since deployed (the player’s own): ReShade.ini')
  expect(platform.clipboard).not.toContain('Actual: d65d092a44dd23e73dc548bcf704b0abb0633a76e2c0fcb9fefe1b370f304989')
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
  manifest.tiers = manifest.tiers.filter((tier) => tier.id !== 'rtx-20-30-40')
  for (const version of manifest.versions) delete version.tiers['rtx-20-30-40']
  platform.fetchText = async () => JSON.stringify(manifest)
  await core.scan()
  await core.reportBug()
  expect(platform.clipboard).toContain('Tier: rtx-20-30-40')
  expect(new URL(platform.openedUrls[0]).searchParams.get('title')).toContain('rtx-20-30-40')
})
