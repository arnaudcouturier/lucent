import { describe, expect, it, vi } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform } from '../platform/fake'
import { EXISTING_SETUPS, existingSetup, graphicsCard, machine, vanillaGame, xivLauncher, type ExistingSetupFixture } from '../platform/fixtures'
import { CONFIG_HASH, FIXTURE_ASSETS, PROFILE_ASSETS, PROFILE_MANIFEST, TEST_MANIFEST, fixtureUrl } from '../platform/contentFixture'
import { MANIFEST_URL } from './manifest'
import { dataPaths } from './deployment'
import { PlatformError } from './platform'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`
const key = (path: string) => path.replace(/\\/g, '/').toLowerCase()
const keys = (paths: string[]) => paths.map(key).sort()
const carried = (kind: ExistingSetupFixture) => Object.fromEntries(Object.entries(CARRIED[kind]).map(([path, text]) => [key(path), text]))

function setupMachine(kind: ExistingSetupFixture, manifest = TEST_MANIFEST, assets = FIXTURE_ASSETS) {
  return machine(vanillaGame(ROOT), xivLauncher(ROOT), graphicsCard(), existingSetup(ROOT, kind), {
    remoteText: { [MANIFEST_URL]: JSON.stringify(manifest), ...Object.fromEntries(Object.entries(assets).map(([hash, text]) => [fixtureUrl(hash), text])) },
  })
}

async function snapshot(platform: FakePlatform) {
  return Object.fromEntries(await Promise.all((await platform.listFiles(GAME)).sort().map(async (path) => [key(path), await platform.readText(`${GAME}\\${path}`)])))
}

async function deployed(platform: FakePlatform, includeReShade = true) {
  const core = createCore(platform)
  await core.scan()
  await core.review(includeReShade)
  await core.deploy()
  core.finish()
  expect(core.getState()).toMatchObject({ error: null, activity: { kind: 'deployment' } })
  return core
}

/** What Scan reports for each fixture: the files backed up and replaced, and the presets carried over. */
const FOUND: Record<ExistingSetupFixture, { label: string; files: string[]; presets: string[] }> = {
  gshade: {
    label: 'GShade leftovers',
    files: ['GShade.ini', 'dxgi.dll', 'gshade-presets/Custom/Sunset.ini', 'gshade-presets/Example.ini'],
    presets: ['gshade-presets/Custom/Sunset.ini', 'gshade-presets/Example.ini'],
  },
  reshade: { label: 'ReShade', files: ['ReShade.ini', 'dxgi.dll', 'ReShadePreset.ini'], presets: ['ReShadePreset.ini', 'reshade-presets/Mine.ini', 'reshade-presets/Example.ini'] },
  gposingway: { label: 'GPosingway', files: [], presets: ['reshade-presets/GPosingway/Portrait.ini'] },
  optiscaler: { label: 'Another OptiScaler', files: ['OptiScaler.ini', 'OptiScaler.log', 'winmm.dll', 'nvngx.dll'], presets: [] },
  'dlss-swap': { label: 'Swapped DLSS files', files: [], presets: [] },
}

/** The presets that end up as new user files in Lucent's preset folder; the others already live there. */
const CARRIED: Record<ExistingSetupFixture, Record<string, string>> = {
  gshade: { 'reshade-presets/Custom/Sunset.ini': '[Sunset]\nBloom=1\n', 'reshade-presets/Example (previous).ini': '[Their example]\n' },
  reshade: { 'reshade-presets/ReShadePreset.ini': '[Root preset]\n', 'reshade-presets/Example (previous).ini': '[My example edits]\n' },
  gposingway: {},
  optiscaler: {},
  'dlss-swap': {},
}

const KINDS = Object.keys(EXISTING_SETUPS) as ExistingSetupFixture[]

describe('Scan', () => {
  it.each(KINDS)('lists %s with its files and the presets it carries over', async (kind) => {
    const core = createCore(createFakePlatform(setupMachine(kind)))
    await core.scan()
    const found = core.getState().existingSetups
    expect(found).toHaveLength(1)
    expect(found[0].label).toBe(FOUND[kind].label)
    expect(keys(found[0].files)).toEqual(keys(FOUND[kind].files))
    expect(keys(found[0].presets)).toEqual(keys(FOUND[kind].presets))
  })

  it('finds nothing in a vanilla folder', async () => {
    const core = createCore(createFakePlatform(machine(vanillaGame(ROOT), xivLauncher(ROOT), graphicsCard(), { remoteText: { [MANIFEST_URL]: JSON.stringify(TEST_MANIFEST) } })))
    await core.scan()
    expect(core.getState().existingSetups).toEqual([])
  })

  it('lists GPosingway alongside the ReShade it runs on', async () => {
    const core = createCore(createFakePlatform(machine(setupMachine('reshade'), existingSetup(ROOT, 'gposingway'))))
    await core.scan()
    const found = core.getState().existingSetups
    expect(found.map((s) => s.label)).toEqual(['GPosingway', 'ReShade'])
    expect(keys(found[0].presets)).toEqual(keys(FOUND.gposingway.presets))
    expect(keys(found[1].files)).toEqual(keys(FOUND.reshade.files))
  })

  it('looks again in a folder the player picks', async () => {
    const platform = createFakePlatform(machine(setupMachine('optiscaler'), vanillaGame('D:\\Clean')))
    const core = createCore(platform)
    await core.scan()
    platform.answerPicker('D:\\Clean')
    await core.chooseGameFolder()
    expect(core.getState().existingSetups).toEqual([])
  })

  it('does not mistake a deployment for an existing setup', async () => {
    const platform = createFakePlatform(setupMachine('reshade'))
    await deployed(platform)
    const reopened = createCore(platform)
    await reopened.scan()
    expect(reopened.getState()).toMatchObject({ existingSetups: [], activity: { kind: 'deployment', drift: null } })
  })
})

describe('Review', () => {
  it.each([
    ['gshade', 4], ['reshade', 5], ['gposingway', 0], ['optiscaler', 4], ['dlss-swap', 0],
  ] as const)('counts the files of %s it backs up, including colliding shaders and presets', async (kind, backedUp) => {
    const core = createCore(createFakePlatform(setupMachine(kind)))
    await core.scan()
    await core.review(true)
    expect(core.getState().plan).toMatchObject({ unclaimedPaths: [], counts: { backedUp } })
  })

  it.each(KINDS)('backs up exactly the files of %s that Scan listed, and keeps the presets it listed', async (kind) => {
    const core = createCore(createFakePlatform(setupMachine(kind)))
    await core.scan()
    const listed = core.getState().folderChanges!
    await core.review(true)
    const plan = core.getState().plan!
    expect(keys(listed.backedUp.map((f) => f.path))).toEqual(keys(plan.filesToBackup))
    expect(listed.carried).toEqual(plan.steps.flatMap((s) => s.kind === 'carry' ? [{ from: s.from, to: s.to }] : []))
  })

  it('lists on Scan what Include ReShade on the Profile step leaves out', async () => {
    const core = createCore(createFakePlatform(setupMachine('reshade')))
    await core.scan()
    const withReShade = core.getState().folderChanges!.backedUp.length
    await core.continueSetup()
    core.setIncludeReShade(false)
    await vi.waitFor(() => expect(core.getState().folderChanges!.backedUp.length).toBeLessThan(withReShade))
    await core.review()
    expect(core.getState().plan).toMatchObject({ includeReShade: false, counts: { backedUp: core.getState().folderChanges!.backedUp.length } })
  })
})

describe('Deploying over an existing setup', () => {
  it('replaces its files, its configs whole, keeps its shaders and carries its presets over', async () => {
    const platform = createFakePlatform(setupMachine('reshade'))
    await deployed(platform)
    const files = await snapshot(platform)
    expect(files).toMatchObject({
      'reshade.ini': FIXTURE_ASSETS[CONFIG_HASH],
      'reshade-presets/mine.ini': '[Mine]\n',
      'reshade-presets/example.ini': 'Preset',
      'reshade-shaders/shaders/other.fx': 'Other shader',
      'reshade-shaders/shaders/example.fx': 'Shader',
      ...carried('reshade'),
    })
    expect(files).not.toHaveProperty('dxgi.dll')
    expect(files).not.toHaveProperty('reshadepreset.ini')
  })

  it("leaves the game's swapped DLSS in place, since the content doesn't replace it", async () => {
    const platform = createFakePlatform(setupMachine('dlss-swap'))
    await deployed(platform)
    expect(await platform.readText(`${GAME}\\nvngx_dlss.dll`)).toBe('DLSS 310.4')
  })

  it('keeps a colliding shader in the backup', async () => {
    const platform = createFakePlatform(setupMachine('reshade'))
    await deployed(platform)
    const theirs = 'Their example shader'
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(theirs)))].map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(await platform.readText(`${(await dataPaths(platform, ROOT)).backups}\\${hash}`)).toBe(theirs)
  })

  it('keeps a readable copy of each original at its own path until uninstall brings them back', async () => {
    const platform = createFakePlatform(setupMachine('reshade'))
    const before = await snapshot(platform)
    const core = await deployed(platform)
    const readable = `${(await dataPaths(platform, ROOT)).readableBackups}\\XIV\\game`
    const copies = await platform.listFiles(readable)
    expect(keys(copies)).toEqual(keys(['ReShade.ini', 'dxgi.dll', 'ReShadePreset.ini', 'reshade-presets/Example.ini', 'reshade-shaders/Shaders/Example.fx']))
    for (const path of copies) expect(await platform.readText(`${readable}\\${path}`)).toBe(before[key(path)])
    await core.uninstall()
    expect(await snapshot(platform)).toMatchObject(before)
    expect(await platform.stat(readable).then(() => true, () => false)).toBe(false)
  })

  it('removes an existing ReShade even when ReShade is left out, and still carries its presets over', async () => {
    const platform = createFakePlatform(setupMachine('reshade'))
    await deployed(platform, false)
    const files = await snapshot(platform)
    expect(files).not.toHaveProperty('dxgi.dll')
    expect(files).not.toHaveProperty('reshade.ini')
    expect(files['reshade-presets/reshadepreset.ini']).toBe('[Root preset]\n')
    expect(files['reshade-presets/example.ini']).toBe('[My example edits]\n')
  })

  it('leaves the folder as it was, without carried presets, when a later step fails', async () => {
    const platform = createFakePlatform(setupMachine('gshade'))
    const before = await snapshot(platform)
    const rename = platform.renameFile.bind(platform)
    platform.renameFile = async (from, to, replace) => {
      if (to === `${GAME}\\ReShade64.dll`) throw new PlatformError('access-denied', 'Access changed after Review', to)
      await rename(from, to, replace)
    }
    const core = createCore(platform)
    await core.scan()
    await core.review(true)
    await core.deploy()
    expect(core.getState().error).toMatch(/Windows denied access/)
    expect(await snapshot(platform)).toEqual(before)
  })
})

describe('Uninstall', () => {
  it.each(KINDS)('restores %s byte for byte, leaving the carried-over presets as user files', async (kind) => {
    const platform = createFakePlatform(setupMachine(kind))
    const before = await snapshot(platform)
    const core = await deployed(platform)
    await core.uninstall()
    expect(core.getState().error).toBeNull()
    expect(await snapshot(platform)).toEqual({ ...before, ...carried(kind) })
  })

  it('brings back an earlier log after the game wrote a new one', async () => {
    const platform = createFakePlatform(setupMachine('optiscaler'))
    const before = await snapshot(platform)
    const core = await deployed(platform)
    await platform.writeText(`${GAME}\\OptiScaler.log`, 'Lucent’s OptiScaler log')
    await core.uninstall()
    expect(core.getState().error).toBeNull()
    expect(await snapshot(platform)).toEqual(before)
  })

  it('no later command touches a carried-over preset', async () => {
    const platform = createFakePlatform(setupMachine('reshade', PROFILE_MANIFEST, PROFILE_ASSETS))
    const core = await deployed(platform)
    const carried = `${GAME}\\reshade-presets\\ReShadePreset.ini`
    await platform.writeText(carried, '[Root preset]\nTweaked=1\n')
    await core.selectProfile('performance')
    await platform.writeText(`${GAME}\\winmm.dll`, 'Patched by the game')
    await core.repair()
    expect(core.getState()).toMatchObject({ error: null, activity: { drift: null } })
    await core.uninstall()
    expect(core.getState().error).toBeNull()
    expect(await platform.readText(carried)).toBe('[Root preset]\nTweaked=1\n')
    expect(await platform.readText(`${GAME}\\reshade-presets\\Example (previous).ini`)).toBe('[My example edits]\n')
  })
})
