import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { customProfileSummary } from './customProfile'
import { createFakePlatform } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'

const ROOT = 'C:\\Games\\XIV'
const INI = `${ROOT}\\game\\OptiScaler.ini`
const customMachine = () => machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))

async function deployed(m = customMachine()) {
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  return platform
}
const reopen = async (platform: ReturnType<typeof createFakePlatform>) => {
  const core = createCore(platform)
  await core.scan()
  return core
}
const edit = async (platform: ReturnType<typeof createFakePlatform>, from: string, to: string) =>
  platform.writeText(INI, (await platform.readText(INI)).replace(from, to))

describe('custom profile', () => {
  it('reports Custom with the changed keys when a key of the selected profile changed on disk', async () => {
    const platform = await deployed()
    await edit(platform, 'Passes = 2', 'Passes = 3')
    const core = await reopen(platform)
    expect(core.getState().customProfile).toMatchObject({ basedOn: 'fidelity', changed: [{ file: 'OptiScaler.ini', section: 'DlssNr', key: 'Passes' }] })
    expect(core.getState().customProfile?.changed).toHaveLength(1)
  })

  it('is not Custom when a key outside the profile changed', async () => {
    const platform = await deployed()
    await edit(platform, 'LogToFile = false', 'LogToFile = true')
    expect((await reopen(platform)).getState().customProfile).toBeNull()
  })

  it('is not Custom when nothing changed', async () => {
    expect((await reopen(await deployed())).getState().customProfile).toBeNull()
  })

  it('counts a deleted profile key as changed', async () => {
    const platform = await deployed()
    await edit(platform, 'ResidualFG = false\r\n', '')
    const core = await reopen(platform)
    expect(core.getState().customProfile?.changed).toEqual([{ file: 'OptiScaler.ini', section: 'DlssNr', key: 'ResidualFG' }])
  })

  it('clears Custom and restores the value when another profile is picked', async () => {
    const platform = await deployed()
    await edit(platform, 'Passes = 2', 'Passes = 3')
    const core = await reopen(platform)
    expect(core.getState().customProfile).not.toBeNull()
    await core.selectProfile('balanced')
    expect(core.getState()).toMatchObject({ error: null, customProfile: null, selectedProfile: 'balanced' })
    expect(await platform.readText(INI)).toContain('Passes = 1\r\nSpatialCompression = false\r\nResidualFG = false\r\n')
  })

  it('clears Custom when the profile it is based on is picked again', async () => {
    const platform = await deployed()
    await edit(platform, 'Passes = 2', 'Passes = 3')
    const core = await reopen(platform)
    await core.selectProfile('fidelity')
    expect(core.getState()).toMatchObject({ error: null, customProfile: null, selectedProfile: 'fidelity' })
    expect(await platform.readText(INI)).toContain('Passes = 2\r\n')
    expect((await reopen(platform)).getState().customProfile).toBeNull()
  })

  it('detects a change made in the overlay once the game closes', async () => {
    const m = customMachine()
    const platform = await deployed(m)
    m.gameRunning = true
    const core = await reopen(platform)
    await core.refreshGameRunning()
    expect(core.getState()).toMatchObject({ gameRunning: true, customProfile: null })
    await edit(platform, 'SpatialCompression = false', 'SpatialCompression = true')
    await core.refreshGameRunning()
    expect(core.getState().customProfile).toBeNull()
    m.gameRunning = false
    await core.refreshGameRunning()
    expect(core.getState().customProfile).toMatchObject({ basedOn: 'fidelity', changed: [{ file: 'OptiScaler.ini', section: 'DlssNr', key: 'SpatialCompression' }] })
  })
})

describe('customProfileSummary', () => {
  const key = (file: string, name: string) => ({ file, section: 'S', key: name })
  it('says one setting changed in the OptiScaler overlay', () => {
    expect(customProfileSummary([key('OptiScaler.ini', 'A')])).toBe('1 setting changed in the OptiScaler overlay')
  })
  it('pluralizes settings', () => {
    expect(customProfileSummary([key('OptiScaler.ini', 'A'), key('OptiScaler.ini', 'B'), key('optiscaler.INI', 'C')])).toBe('3 settings changed in the OptiScaler overlay')
  })
  it('names each overlay once, in first-appearance order', () => {
    expect(customProfileSummary([key('OptiScaler.ini', 'A'), key('ReShade.ini', 'B'), key('OptiScaler.ini', 'C')])).toBe('3 settings changed in the OptiScaler and ReShade overlays')
  })
})
