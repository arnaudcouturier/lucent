import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { customProfileSummary } from './customProfile'
import { createFakePlatform } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { dataPaths, readDeployment } from './deployment'

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
    expect(core.getState().customProfile).toMatchObject({ basedOn: 'fidelity', changed: [{ file: 'OptiScaler.ini', section: 'DlssNr', key: 'Passes', value: '3' }] })
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

  it('ignores profile keys owned by frame-generation modes', async () => {
    const platform = await deployed()
    const record = (await readDeployment(platform, ROOT))!
    record.recipe.frameGenerationOptions = [{ id: 'off', settings: [{ file: 'OptiScaler.ini', section: 'DlssNr', key: 'Passes', value: '2' }] }]
    await platform.writeText((await dataPaths(platform, ROOT)).record, JSON.stringify(record))
    await edit(platform, 'Passes = 2', 'Passes = 3')
    expect((await reopen(platform)).getState().customProfile).toBeNull()
  })

  it('is not Custom when an overlay saves the same values in another spelling', async () => {
    const platform = await deployed()
    await edit(platform, 'Passes = 2\r\nSpatialCompression = false', 'Passes = 2.000000\r\nSpatialCompression = False')
    expect((await reopen(platform)).getState().customProfile).toBeNull()
  })

  it('counts a deleted profile key as changed', async () => {
    const platform = await deployed()
    await edit(platform, 'ResidualFG = false\r\n', '')
    const core = await reopen(platform)
    expect(core.getState().customProfile?.changed).toEqual([{ file: 'OptiScaler.ini', section: 'DlssNr', key: 'ResidualFG', value: undefined }])
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
    expect(core.getState().customProfile).toMatchObject({ basedOn: 'fidelity', changed: [{ file: 'OptiScaler.ini', section: 'DlssNr', key: 'SpatialCompression', value: 'true' }] })
  })
})

describe('customProfileSummary', () => {
  const key = (file: string, name: string, value: string | undefined = '1') => ({ file, section: 'S', key: name, value })
  it('shows the changed setting and its on-disk value', () => {
    expect(customProfileSummary([key('OptiScaler.ini', 'Passes', '2')])).toBe('Passes set to 2')
  })
  it('lists multiple changes compactly', () => {
    expect(customProfileSummary([key('OptiScaler.ini', 'Passes', '2'), key('OptiScaler.ini', 'SpatialCompression', 'true')])).toBe('Passes set to 2, SpatialCompression set to true')
  })
  it('describes removed and cleared values', () => {
    expect(customProfileSummary([key('OptiScaler.ini', 'Passes', ''), { file: 'ReShade.ini', section: 'S', key: 'Preset', value: undefined }])).toBe('Passes cleared, Preset removed')
  })
})
