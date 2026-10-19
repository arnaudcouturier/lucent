import { expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform } from '../platform/fake'
import { frameGenerationContentHost, graphicsCard, MACHINES, machine } from '../platform/fixtures'
import { FRAME_GENERATION_MANIFEST } from '../platform/contentFixture'
import { MANIFEST_URL } from './manifest'
import { statusCard } from './statusCard'
import { frameGenerationOptionsForGpu } from './frameGeneration'
import { dataPaths, readDeployment } from './deployment'
import type { ConfigUpdateRule, FrameGenerationId, Manifest } from '../shared/manifest'

const ROOT = 'D:\\SteamLibrary\\steamapps\\common\\FINAL FANTASY XIV Online'
const GAME = `${ROOT}\\game`

/** The frame generation content with the given update rule on OptiScaler.ini, in every version it publishes. */
function manifestWith(rule: ConfigUpdateRule | undefined, extraVersions: Manifest['versions'] = []): Manifest {
  const manifest = structuredClone(FRAME_GENERATION_MANIFEST)
  manifest.versions = [...manifest.versions, ...extraVersions]
  if (rule) for (const version of manifest.versions) version.tiers['rtx-20-30-40'].ownedConfigs.find((c) => c.path === 'OptiScaler.ini')!.update = rule
  return manifest
}

async function deployed(refresh: 60 | 144, gpu: 'rtx30' | 'rtx40' = 'rtx40', rule?: ConfigUpdateRule) {
  const screen = refresh === 60 ? MACHINES.screen60Sdr : MACHINES.screen144Hdr
  const gpuName = gpu === 'rtx30' ? 'NVIDIA GeForce RTX 3080' : 'NVIDIA GeForce RTX 4090'
  const host = frameGenerationContentHost()
  host.remoteText![MANIFEST_URL] = JSON.stringify(manifestWith(rule))
  const m = machine(screen, host, graphicsCard(gpuName))
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

/** A deployment whose player picked another mode: the config and the stored first-install choice both hold it. */
async function deployedWith(platform: FakePlatform, mode: string) {
  const configPath = `${GAME}\\OptiScaler.ini`
  await platform.writeText(configPath, (await platform.readText(configPath)).replace(/Mode\s*=\s*2x/i, `Mode=${mode}`))
  const record = (await readDeployment(platform, ROOT))!
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

it('rewrites the config from the new card’s choices through a same-tier GPU refresh', async () => {
  const { platform, m } = await deployed(144)
  await deployedWith(platform, '4x')
  const configPath = `${GAME}\\OptiScaler.ini`
  const before = await platform.readText(configPath)
  m.gpus = graphicsCard('NVIDIA GeForce RTX 3080').gpus

  const changedGpu = await reopen(platform)
  expect(statusCard(changedGpu.getState())).toMatchObject({ kind: 'switch-tier', sameTier: true })
  await changedGpu.switchTier()
  await changedGpu.review()
  await changedGpu.deploy()
  expect(changedGpu.getState().error).toBeNull()
  expect(changedGpu.getState().deployment).toMatchObject({ frameGenerationMode: '2x', graphics: { name: 'NVIDIA GeForce RTX 3080' } })
  expect(await platform.readText(configPath)).not.toBe(before)
  expect(await platform.readText(configPath)).toMatch(/Mode\s*=\s*2x/)
})

it('writes the stored mode, or the new card’s default, when the replace rule rewrites the config for a same-tier GPU', async () => {
  const { platform, m } = await deployed(144, 'rtx40', 'replace')
  await deployedWith(platform, '4x')
  const configPath = `${GAME}\\OptiScaler.ini`

  m.gpus = graphicsCard('NVIDIA GeForce RTX 4080').gpus
  const supported = await reopen(platform)
  await supported.switchTier()
  await supported.review()
  await supported.deploy()
  expect(supported.getState().error).toBeNull()
  expect(supported.getState().deployment).toMatchObject({ frameGenerationMode: '4x', graphics: { name: 'NVIDIA GeForce RTX 4080' } })
  expect(await platform.readText(configPath)).toMatch(/Mode\s*=\s*4x/)
  expect(await platform.readText(configPath)).toMatch(/Backend\s*=\s*rtx40/)

  m.gpus = graphicsCard('NVIDIA GeForce RTX 3080').gpus
  const changedGpu = await reopen(platform)
  await changedGpu.switchTier()
  await changedGpu.review()
  await changedGpu.deploy()
  expect(changedGpu.getState().error).toBeNull()
  // 4x isn't offered on this card: the baseline gets its default, and the stored choice stays for Reset to offer.
  expect(changedGpu.getState().deployment).toMatchObject({ frameGenerationMode: '2x', graphics: { name: 'NVIDIA GeForce RTX 3080' } })
  expect(await platform.readText(configPath)).toMatch(/Mode\s*=\s*2x/)
  expect(await platform.readText(configPath)).toMatch(/Backend\s*=\s*rtx30/)
})

it('rewrites values the player set by hand through a same-tier GPU refresh', async () => {
  const { platform, m } = await deployed(144)
  const configPath = `${GAME}\\OptiScaler.ini`
  const custom = (await platform.readText(configPath)).replace(/Mode\s*=\s*2x/i, 'Mode=third-party')
  await platform.writeText(configPath, custom)
  m.gpus = graphicsCard('NVIDIA GeForce RTX 3080').gpus

  const changedGpu = await reopen(platform)
  await changedGpu.switchTier()
  await changedGpu.review()
  await changedGpu.deploy()
  expect(changedGpu.getState().error).toBeNull()
  expect(changedGpu.getState().deployment).toMatchObject({ frameGenerationMode: '2x', graphics: { name: 'NVIDIA GeForce RTX 3080' } })
  expect(await platform.readText(configPath)).not.toBe(custom)
  expect(await platform.readText(configPath)).toMatch(/Mode\s*=\s*2x/)
  expect(await platform.readText(configPath)).toMatch(/Backend\s*=\s*rtx30/)
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

it('uses the changed same-tier GPU variant for regular content updates and rollbacks under the replace rule', async () => {
  const { platform, m } = await deployed(144, 'rtx40', 'replace')
  const original = FRAME_GENERATION_MANIFEST.versions[0]
  const newer = { ...structuredClone(original), id: '2026.10.20', changelog: ['Inert frame-generation update.'] }
  m.remoteText![MANIFEST_URL] = JSON.stringify(manifestWith('replace', [newer]))
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

it('keeps the stored mode through a content update and takes the new tier’s choices on a tier switch', async () => {
  const { platform, m } = await deployed(144, 'rtx40', 'replace')
  await deployedWith(platform, '4x')
  const original = FRAME_GENERATION_MANIFEST.versions[0]
  const newer = { ...structuredClone(original), id: '2026.10.20', changelog: ['Inert frame-generation update.'] }
  m.remoteText![MANIFEST_URL] = JSON.stringify(manifestWith('replace', [newer]))
  const update = await reopen(platform)
  expect(statusCard(update.getState())).toMatchObject({ kind: 'update' })
  await update.update()
  expect(update.getState().error).toBeNull()
  expect(update.getState().deployment?.frameGenerationMode).toBe('4x')
  expect(await platform.readText(`${GAME}\\OptiScaler.ini`)).toMatch(/Mode\s*=\s*4x/)

  m.gpus = graphicsCard('AMD Radeon RX 7900 XTX', 0x1002).gpus
  const changedTier = await reopen(platform)
  await changedTier.switchTier()
  await changedTier.review()
  await changedTier.deploy()
  expect(changedTier.getState().error).toBeNull()
  expect(changedTier.getState().deployment?.frameGenerationMode).toBeNull()
  expect(changedTier.getState().deployment?.recipe.frameGenerationOptions).toEqual([])
})
