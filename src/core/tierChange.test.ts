import { expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { statusCard } from './statusCard'
import type { ProfileId } from '../shared/manifest'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`
const RADEON = graphicsCard('AMD Radeon RX 7900 XTX', 0x1002).gpus!

async function deployedOnRtx(profile?: ProfileId) {
  const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  if (profile) {
    await core.continueSetup()
    await core.selectProfile(profile)
  }
  await core.review()
  await core.deploy()
  core.finish()
  return { platform, core, m }
}

async function reopen(platform: FakePlatform) {
  const core = createCore(platform)
  await core.scan()
  return core
}

it('offers Switch tier when the graphics card now matches another tier', async () => {
  const { platform, m } = await deployedOnRtx()
  m.gpus = RADEON
  const core = await reopen(platform)
  expect(statusCard(core.getState())).toEqual({ kind: 'switch-tier', gpu: 'AMD Radeon RX 7900 XTX', from: 'RTX 30/40', to: 'Radeon' })
})

it('offers a GPU refresh when another card matches the same tier', async () => {
  const { platform, m } = await deployedOnRtx()
  m.gpus = graphicsCard('NVIDIA GeForce RTX 3080').gpus
  expect(statusCard((await reopen(platform)).getState())).toEqual({
    kind: 'switch-tier', gpu: 'NVIDIA GeForce RTX 3080', from: 'RTX 30/40', to: 'RTX 30/40', sameTier: true,
  })
})

it('Switch tier deploys the Radeon recipe, keeping Disabled and the player’s ReShade changes', async () => {
  const { platform, core: first, m } = await deployedOnRtx()
  await first.setEnabled(false)
  await platform.writeText(`${GAME}\\ReShade.ini`, '[GENERAL]\nPresetPath=.\\reshade-presets\\Mine.ini\n')
  await platform.writeText(`${GAME}\\reshade-presets\\Mine.ini`, '[Mine]\n')
  m.gpus = RADEON
  const core = await reopen(platform)
  await core.switchTier()
  expect(core.getState().activity.kind).toBe('profile')
  expect(core.getState().frameGenerationMode).toBeNull()
  expect(core.getState().hdrMode).toBeNull()
  await core.review()
  await core.deploy()
  core.finish()
  expect(core.getState().error).toBeNull()
  expect(core.getState().deployment).toMatchObject({ tier: 'radeon', graphics: { name: 'AMD Radeon RX 7900 XTX' }, enabled: false, profile: null, recipe: { overlay: 'upscaling' } })
  // The Radeon recipe has no OptiScaler profiles, so that config goes; Reset rewrites ReShade.ini from the tested baseline.
  const files = await platform.listFiles(GAME)
  expect(files).not.toContain('optiscaler.ini')
  expect(await platform.readText(`${GAME}\\winmm.dll.disabled`)).toBe('OptiScaler')
  expect(await platform.readText(`${GAME}\\ReShade64.dll`)).toBe('ReShade')
  expect(await platform.readText(`${GAME}\\reshade-shaders\\Shaders\\Example.fx`)).toBe('Shader')
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toContain('PresetPath=')
  expect(await platform.readText(`${GAME}\\reshade-presets\\Mine.ini`)).toBe('[Mine]\n')
  expect(statusCard(core.getState())).toEqual({ kind: 'disabled' })
  expect(core.getState().profiles).toEqual([])
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'disabled' })
})

it('keeps the profile when the new tier has it', async () => {
  const { platform, m } = await deployedOnRtx('performance')
  m.gpus = graphicsCard('NVIDIA GeForce RTX 5090').gpus
  const core = await reopen(platform)
  expect(statusCard(core.getState())).toMatchObject({ kind: 'switch-tier', from: 'RTX 30/40', to: 'RTX 50' })
  await core.switchTier()
  expect(core.getState().activity.kind).toBe('profile')
  await core.review()
  await core.deploy()
  core.finish()
  expect(core.getState().error).toBeNull()
  expect(core.getState()).toMatchObject({ selectedProfile: 'performance', deployment: { tier: 'rtx-50', profile: 'performance', enabled: true } })
  expect(await platform.readText(`${GAME}\\OptiScaler.ini`)).toMatch(/SpatialCompression = true/)
  expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
})

it('Switch tier waits while the game runs', async () => {
  const { platform, m } = await deployedOnRtx()
  m.gpus = RADEON
  const core = await reopen(platform)
  m.gameRunning = true
  await core.switchTier()
  expect(core.getState().error).toMatch(/Close XIV/)
  expect(core.getState().deployment).toMatchObject({ tier: 'rtx-30-40' })
})
