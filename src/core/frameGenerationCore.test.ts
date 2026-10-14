import { expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform } from '../platform/fake'
import { frameGenerationContentHost, graphicsCard, MACHINES, machine } from '../platform/fixtures'
import { FRAME_GENERATION_MANIFEST } from '../platform/contentFixture'
import { MANIFEST_URL } from './manifest'
import { statusCard } from './statusCard'

const GAME = 'D:\\SteamLibrary\\steamapps\\common\\FINAL FANTASY XIV Online\\game'

async function deployed(refresh: 60 | 144, gpu: 'rtx30' | 'rtx40' = 'rtx40') {
  const screen = refresh === 60 ? MACHINES.screen60Sdr : MACHINES.screen144Hdr
  const gpuName = gpu === 'rtx30' ? 'NVIDIA GeForce RTX 3080' : 'NVIDIA GeForce RTX 4080'
  const m = machine(screen, frameGenerationContentHost(), graphicsCard(gpuName))
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  expect(core.getState().error).toBeNull()
  return { core, platform, m }
}

async function reopen(platform: FakePlatform) {
  const core = createCore(platform)
  await core.scan()
  return core
}

it('defaults to Off below 120 Hz and filters choices for the detected GPU', async () => {
  const { core } = await deployed(60, 'rtx30')
  expect(core.getState().frameGenerationMode).toBe('off')
  expect(core.getState().deployment?.recipe.frameGenerationOptions?.map(({ id }) => id)).toEqual(['off', '2x'])
})

it('defaults to 2x at 120 Hz or above and offers only the matching RTX 40 modes', async () => {
  const { core } = await deployed(144)
  expect(core.getState().frameGenerationMode).toBe('2x')
  expect(core.getState().deployment?.recipe.frameGenerationOptions?.map(({ id }) => id)).toEqual(['off', '2x', '3x', '4x', '5x', '6x', 'dynamic'])
})

it('reads the disk mode on reopen and keeps it through profile changes and Repair', async () => {
  const { core, platform } = await deployed(144)
  await core.selectFrameGenerationMode('4x')
  await core.selectProfile('balanced')
  expect(core.getState().frameGenerationMode).toBe('4x')
  expect(await platform.readText(`${GAME}\\OptiScaler.ini`)).toMatch(/Mode\s*=\s*4x/)

  const reopened = await reopen(platform)
  expect(reopened.getState().frameGenerationMode).toBe('4x')
  await platform.writeText(`${GAME}\\winmm.dll`, 'game patch')
  await reopened.repair()
  expect(reopened.getState().frameGenerationMode).toBe('4x')
  expect(statusCard(reopened.getState())).toEqual({ kind: 'healthy' })
})

it('shows unmatched config as Custom, preserves it until a mode is selected, then refreshes from disk', async () => {
  const { platform } = await deployed(144)
  const configPath = `${GAME}\\OptiScaler.ini`
  const config = await platform.readText(configPath)
  await platform.writeText(configPath, config.replace(/(Mode\s*=\s*)(?:off|[2-6]x|dynamic)/i, '$1third-party'))

  const reopened = await reopen(platform)
  expect(reopened.getState().frameGenerationMode).toBeNull()
  expect(await platform.readText(configPath)).toMatch(/Mode\s*=\s*third-party/)
  await reopened.selectFrameGenerationMode('2x')
  expect(reopened.getState().frameGenerationMode).toBe('2x')
  expect(await platform.readText(configPath)).toMatch(/Mode\s*=\s*2x/)

  await platform.writeText(configPath, (await platform.readText(configPath)).replace(/Mode\s*=\s*2x/i, 'Mode=third-party'))
  await reopened.refreshFrameGenerationMode()
  expect(reopened.getState().frameGenerationMode).toBeNull()
})

it('keeps a supported mode through a content update and clears it when the new tier has no options', async () => {
  const { core, platform, m } = await deployed(144)
  await core.selectFrameGenerationMode('4x')
  const original = FRAME_GENERATION_MANIFEST.versions[0]
  const newer = { ...original, id: '2026.10.20', changelog: ['Inert frame-generation update.'] }
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...FRAME_GENERATION_MANIFEST, versions: [original, newer] })
  const update = await reopen(platform)
  expect(statusCard(update.getState())).toMatchObject({ kind: 'update' })
  await update.update()
  expect(update.getState().error).toBeNull()
  expect(update.getState().frameGenerationMode).toBe('4x')
  expect(await platform.readText(`${GAME}\\OptiScaler.ini`)).toMatch(/Mode\s*=\s*4x/)

  m.gpus = graphicsCard('AMD Radeon RX 7900 XTX', 0x1002).gpus
  const changedTier = await reopen(platform)
  await changedTier.switchTier()
  expect(changedTier.getState().error).toBeNull()
  expect(changedTier.getState().frameGenerationMode).toBeNull()
  expect(changedTier.getState().deployment?.recipe.frameGenerationOptions).toEqual([])
})
