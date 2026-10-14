import { expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform } from '../platform/fake'
import { frameGenerationContentHost, graphicsCard, MACHINES, machine } from '../platform/fixtures'
import { FRAME_GENERATION_MANIFEST } from '../platform/contentFixture'
import { MANIFEST_URL } from './manifest'
import { statusCard } from './statusCard'
import { frameGenerationOptionsForGpu } from './frameGeneration'
import { dataPaths, readDeployment } from './deployment'
import type { FrameGenerationId } from '../shared/manifest'

const ROOT = 'D:\\SteamLibrary\\steamapps\\common\\FINAL FANTASY XIV Online'
const GAME = `${ROOT}\\game`

async function deployed(refresh: 60 | 144, gpu: 'rtx30' | 'rtx40' = 'rtx40') {
  const screen = refresh === 60 ? MACHINES.screen60Sdr : MACHINES.screen144Hdr
  const gpuName = gpu === 'rtx30' ? 'NVIDIA GeForce RTX 3080' : 'NVIDIA GeForce RTX 4090'
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

/** A deployment made with another mode, as an earlier build's Home control left it: the config and Lucent's last-written copy both hold it. */
async function deployedWith(platform: FakePlatform, mode: string) {
  const configPath = `${GAME}\\OptiScaler.ini`
  const withMode = (text: string) => text.replace(/Mode\s*=\s*2x/i, `Mode=${mode}`)
  await platform.writeText(configPath, withMode(await platform.readText(configPath)))
  const record = (await readDeployment(platform, ROOT))!
  record.ownedConfigs['OptiScaler.ini'] = withMode(record.ownedConfigs['OptiScaler.ini'])
  record.frameGenerationMode = mode as FrameGenerationId
  await platform.writeText((await dataPaths(platform, ROOT)).record, JSON.stringify(record))
}

it('defaults to Off below 120 Hz and filters choices for the detected GPU', async () => {
  const { core } = await deployed(60, 'rtx30')
  expect(core.getState().deployment?.frameGenerationMode).toBe('off')
  expect(frameGenerationOptionsForGpu(core.getState().deployment?.recipe.frameGenerationOptions ?? [], 'NVIDIA GeForce RTX 3080').map(({ id }) => id)).toEqual(['off', '2x'])
})

it('defaults to 2x at 120 Hz or above and offers only the matching RTX 40 modes', async () => {
  const { core } = await deployed(144)
  expect(core.getState().deployment?.frameGenerationMode).toBe('2x')
  expect(frameGenerationOptionsForGpu(core.getState().deployment?.recipe.frameGenerationOptions ?? [], 'NVIDIA GeForce RTX 4090').map(({ id }) => id)).toEqual(['off', '2x', '3x', '4x', '5x', '6x', 'dynamic'])
})

it('keeps a supported mode when refreshing between GPUs in the same tier', async () => {
  const { platform, m } = await deployed(144)
  await deployedWith(platform, '4x')
  m.gpus = graphicsCard('NVIDIA GeForce RTX 4080').gpus

  const changedGpu = await reopen(platform)
  expect(statusCard(changedGpu.getState())).toMatchObject({ kind: 'switch-tier', sameTier: true })
  await changedGpu.switchTier()

  expect(changedGpu.getState().error).toBeNull()
  expect(changedGpu.getState().deployment).toMatchObject({ frameGenerationMode: '4x', graphics: { name: 'NVIDIA GeForce RTX 4080' } })
  expect(await platform.readText(`${GAME}\\OptiScaler.ini`)).toMatch(/Mode\s*=\s*4x/)
  expect(await platform.readText(`${GAME}\\OptiScaler.ini`)).toMatch(/Backend\s*=\s*rtx40/)
})

it('refreshes a same-tier GPU deliberately, selecting its modes and falling back only when applied', async () => {
  const { platform, m } = await deployed(144)
  await deployedWith(platform, '4x')
  const configPath = `${GAME}\\OptiScaler.ini`
  const before = await platform.readText(configPath)
  m.gpus = graphicsCard('NVIDIA GeForce RTX 3080').gpus

  const changedGpu = await reopen(platform)
  expect(statusCard(changedGpu.getState())).toMatchObject({ kind: 'switch-tier', sameTier: true })
  expect(await platform.readText(configPath)).toBe(before)

  await changedGpu.switchTier()
  expect(changedGpu.getState().error).toBeNull()
  expect(changedGpu.getState().deployment).toMatchObject({ frameGenerationMode: '2x', graphics: { name: 'NVIDIA GeForce RTX 3080' } })
  expect(await platform.readText(configPath)).toMatch(/Mode\s*=\s*2x/)
  expect(await platform.readText(configPath)).toMatch(/Backend\s*=\s*rtx30/)
})

it('preserves custom frame-generation values through a same-tier GPU refresh', async () => {
  const { platform, m } = await deployed(144)
  const configPath = `${GAME}\\OptiScaler.ini`
  const custom = (await platform.readText(configPath)).replace(/Mode\s*=\s*2x/i, 'Mode=third-party')
  await platform.writeText(configPath, custom)
  m.gpus = graphicsCard('NVIDIA GeForce RTX 3080').gpus

  const changedGpu = await reopen(platform)
  expect(statusCard(changedGpu.getState())).toMatchObject({ kind: 'switch-tier', sameTier: true })
  expect(await platform.readText(configPath)).toBe(custom)

  await changedGpu.switchTier()
  expect(changedGpu.getState().error).toBeNull()
  expect(changedGpu.getState().deployment).toMatchObject({ frameGenerationMode: null, graphics: { name: 'NVIDIA GeForce RTX 3080' } })
  expect(await platform.readText(configPath)).toBe(custom)
})

it('leaves the mode in the config alone through Repair', async () => {
  const { platform } = await deployed(144)
  await deployedWith(platform, '4x')
  const configPath = `${GAME}\\OptiScaler.ini`
  const config = await platform.readText(configPath)

  const reopened = await reopen(platform)
  await platform.writeText(`${GAME}\\winmm.dll`, 'game patch')
  await reopened.repair()
  expect(reopened.getState().error).toBeNull()
  expect(await platform.readText(configPath)).toBe(config)
  expect(statusCard(reopened.getState())).toEqual({ kind: 'healthy' })
})

it('uses the changed same-tier GPU variant for regular content updates and rollbacks', async () => {
  const { platform, m } = await deployed(144)
  const original = FRAME_GENERATION_MANIFEST.versions[0]
  const newer = { ...original, id: '2026.10.20', changelog: ['Inert frame-generation update.'] }
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...FRAME_GENERATION_MANIFEST, versions: [original, newer] })
  m.gpus = graphicsCard('NVIDIA GeForce RTX 3080').gpus

  const update = await reopen(platform)
  expect(statusCard(update.getState())).toMatchObject({ kind: 'switch-tier', sameTier: true })
  expect(await platform.readText(`${GAME}\\OptiScaler.ini`)).toMatch(/Backend\s*=\s*rtx40/)
  await update.applyVersion(newer.id)

  expect(update.getState().error).toBeNull()
  expect(update.getState().deployment).toMatchObject({ contentVersion: newer.id, frameGenerationMode: '2x', graphics: { name: 'NVIDIA GeForce RTX 3080' } })
  const config = await platform.readText(`${GAME}\\OptiScaler.ini`)
  expect(config).toMatch(/Mode\s*=\s*2x/)
  expect(config).toMatch(/Backend\s*=\s*rtx30/)

  m.gpus = graphicsCard('NVIDIA GeForce RTX 4090').gpus
  const rollback = await reopen(platform)
  expect(statusCard(rollback.getState())).toMatchObject({ kind: 'switch-tier', sameTier: true })
  await rollback.applyVersion(original.id)

  expect(rollback.getState().error).toBeNull()
  expect(rollback.getState().deployment).toMatchObject({ contentVersion: original.id, frameGenerationMode: '2x', graphics: { name: 'NVIDIA GeForce RTX 4090' } })
  expect(await platform.readText(`${GAME}\\OptiScaler.ini`)).toMatch(/Backend\s*=\s*rtx40/)
})

it('keeps a supported mode through a content update and clears it when the new tier has no options', async () => {
  const { platform, m } = await deployed(144)
  await deployedWith(platform, '4x')
  const original = FRAME_GENERATION_MANIFEST.versions[0]
  const newer = { ...original, id: '2026.10.20', changelog: ['Inert frame-generation update.'] }
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...FRAME_GENERATION_MANIFEST, versions: [original, newer] })
  const update = await reopen(platform)
  expect(statusCard(update.getState())).toMatchObject({ kind: 'update' })
  await update.update()
  expect(update.getState().error).toBeNull()
  expect(update.getState().deployment?.frameGenerationMode).toBe('4x')
  expect(await platform.readText(`${GAME}\\OptiScaler.ini`)).toMatch(/Mode\s*=\s*4x/)

  m.gpus = graphicsCard('AMD Radeon RX 7900 XTX', 0x1002).gpus
  const changedTier = await reopen(platform)
  await changedTier.switchTier()
  expect(changedTier.getState().error).toBeNull()
  expect(changedTier.getState().deployment?.frameGenerationMode).toBeNull()
  expect(changedTier.getState().deployment?.recipe.frameGenerationOptions).toEqual([])
})
