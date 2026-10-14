import { expect, it } from 'vitest'
import { createCore } from './core'
import { dataPaths, readDeployment } from './deployment'
import { runHeadless } from './autoRepair'
import { LUCENT_LOG } from './log'
import { createFakePlatform, type FakePlatform } from '../platform/fake'
import { firstInstallContentHost, fixtureContentHost, graphicsCard, machine, nextContentHost, vanillaGame, xivLauncher } from '../platform/fixtures'
import { statusCard } from './statusCard'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`

/** A deployment as 0.1.1 left it: its record keeps the text Lucent last wrote to each config file. */
async function deployedBy011(host = fixtureContentHost()) {
  const m = machine(host, graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  expect(core.getState().error).toBeNull()
  const record = (await readDeployment(platform, ROOT))! as unknown as Record<string, unknown>
  record.ownedConfigs = { 'ReShade.ini': '[GENERAL]\nPresetPath=\n', 'OptiScaler.ini': await platform.readText(`${GAME}\\OptiScaler.ini`) }
  delete record.hdrMode
  return { m, platform, record }
}

const save = async (platform: FakePlatform, record: unknown) => platform.writeText((await dataPaths(platform, ROOT)).record, JSON.stringify(record))
const folder = async (platform: FakePlatform) => Object.fromEntries(await Promise.all((await platform.listFiles(GAME)).map(async (f) => [f, await platform.readText(`${GAME}\\${f}`)])))

async function reopen(platform: FakePlatform) {
  const core = createCore(platform)
  await core.scan()
  return core
}

it('drops what a 0.1.1 record kept, leaves every file as it is, and infers the stored choices: old Fidelity becomes Ultra', async () => {
  const { platform, record } = await deployedBy011()
  expect(record.profile).toBe('fidelity')
  // The 0.1.1 content has legacy profiles, so its Fidelity is the two-pass one.
  const tuned = (await platform.readText(`${GAME}\\OptiScaler.ini`)).replace('Passes = 2', 'Passes = 9')
  await platform.writeText(`${GAME}\\OptiScaler.ini`, tuned)
  await platform.writeText(`${GAME}\\ReShade.ini`, '[GENERAL]\nPresetPath=reshade-presets/Mine.ini\n')
  await save(platform, record)
  const files = await folder(platform)

  const core = await reopen(platform)
  expect(core.getState().error).toBeNull()
  expect(await folder(platform)).toEqual(files)
  const migrated = (await readDeployment(platform, ROOT))!
  expect(migrated).not.toHaveProperty('ownedConfigs')
  expect(migrated).toMatchObject({ status: 'complete', profile: 'ultra', frameGenerationMode: null, hdrMode: null })
  expect(core.getState()).toMatchObject({ selectedProfile: 'ultra', frameGenerationMode: null, hdrMode: null })
  expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
  expect((await core.readLog(LUCENT_LOG))!.filter((line) => /^Migrated the deployment record/.test(line.text))).toHaveLength(1)
})

it('keeps Balanced and Performance, and records frame generation Off and HDR Off where the content has them', async () => {
  const { platform, record } = await deployedBy011(firstInstallContentHost())
  Object.assign(record, { profile: 'balanced', frameGenerationMode: '4x', hdrMode: undefined })
  await save(platform, record)

  await reopen(platform)
  expect(await readDeployment(platform, ROOT)).toMatchObject({ profile: 'balanced', frameGenerationMode: 'off', hdrMode: 'off' })
})

it('a four-profile Fidelity is one pass, so it stays Fidelity', async () => {
  const { platform, record } = await deployedBy011(firstInstallContentHost())
  Object.assign(record, { profile: 'fidelity' })
  await save(platform, record)

  await reopen(platform)
  expect(await readDeployment(platform, ROOT)).toMatchObject({ profile: 'fidelity' })
})

it('migrates once: a second open changes nothing and logs nothing', async () => {
  const { platform, record } = await deployedBy011()
  await save(platform, record)
  await reopen(platform)
  const saved = await platform.readText((await dataPaths(platform, ROOT)).record)

  const second = await reopen(platform)
  expect(await platform.readText((await dataPaths(platform, ROOT)).record)).toBe(saved)
  expect((await second.readLog(LUCENT_LOG))!.filter((line) => /^Migrated the deployment record/.test(line.text))).toHaveLength(1)
})

it('migrates a record that XIVLauncher’s headless run opens first', async () => {
  const { platform, record } = await deployedBy011()
  await save(platform, record)
  expect(await runHeadless(platform, 'check')).toEqual({ kind: 'healthy' })
  expect(await readDeployment(platform, ROOT)).not.toHaveProperty('ownedConfigs')
  expect(await readDeployment(platform, ROOT)).toMatchObject({ profile: 'ultra' })
})

it('an update after the migration keeps the tuned configs, and Repair puts back a deleted one from the baseline', async () => {
  const { m, platform, record } = await deployedBy011()
  const tuned = (await platform.readText(`${GAME}\\OptiScaler.ini`)).replace('Passes = 2', 'Passes = 9')
  await platform.writeText(`${GAME}\\OptiScaler.ini`, tuned)
  await save(platform, record)
  Object.assign(m.remoteText!, nextContentHost().remoteText)

  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(core.getState().deployment?.contentVersion).toBe('2026.11.02')
  expect(await platform.readText(`${GAME}\\OptiScaler.ini`)).toBe(tuned)

  await platform.removeFile(`${GAME}\\OptiScaler.ini`)
  const repaired = await reopen(platform)
  await repaired.repair()
  expect(repaired.getState().error).toBeNull()
  // The migrated Fidelity is Ultra, but this content only has the legacy profiles, so the baseline keeps its two passes.
  expect(await platform.readText(`${GAME}\\OptiScaler.ini`)).toContain('Passes = 2')
})
