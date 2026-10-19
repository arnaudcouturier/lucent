import { expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform } from '../platform/fake'
import { graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { FIXTURE_ASSETS, OPTISCALER_HASH, RESHADE_HASH, CONFIG_HASH, TEST_MANIFEST, fixtureUrl } from '../platform/contentFixture'
import { MANIFEST_URL } from './manifest'
import { PlatformError } from './platform'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`

function deploymentMachine(manifest = TEST_MANIFEST, root = ROOT) {
  return machine(vanillaGame(root), xivLauncher(root), graphicsCard(), {
    remoteText: { [MANIFEST_URL]: JSON.stringify(manifest), ...Object.fromEntries(Object.entries(FIXTURE_ASSETS).map(([hash, text]) => [fixtureUrl(hash), text])) },
  })
}

function recoveryMachine() {
  const manifest = structuredClone(TEST_MANIFEST)
  const recipe = manifest.versions[0].tiers['rtx-20-30-40']
  recipe.recipe = [
    { kind: 'copy', file: OPTISCALER_HASH, to: 'winmm.dll' },
    { kind: 'copy', file: RESHADE_HASH, to: 'scratch/nested/staging.dll' },
    { kind: 'copy', file: CONFIG_HASH, to: 'winmm.dll' },
    { kind: 'rename', from: 'scratch/nested/staging.dll', to: 'winmm.dll' },
    { kind: 'delete', path: 'winmm.dll' },
    { kind: 'copy', file: OPTISCALER_HASH, to: 'winmm.dll' },
  ]
  recipe.ownedConfigs = []
  recipe.shippedPresets = []
  return machine(deploymentMachine(manifest), { directories: [`${GAME}\\My empty folder`], files: {
    [`${GAME}\\reshade-presets\\My preset.ini`]: '[User]\nName=éclat\n',
    [`${GAME}\\reshade-shaders\\Paid.fx`]: 'Paid shader\u0000\u00ff',
  } })
}

/** A killed process cannot run its catch/finally blocks, so `crash` never settles. */
function crashPoint(platform: FakePlatform) {
  let reached!: () => void
  const crashed = new Promise<void>((resolve) => { reached = resolve })
  return { crashed, crash: () => { platform.crash(); reached(); return new Promise<never>(() => {}) } }
}

/** Interrupt a game-folder mutation, leaving cache and backup operations available. */
function interruptApply(platform: FakePlatform, boundary: number, interrupt: () => Promise<never>) {
  const copy = platform.copyFile.bind(platform)
  const rename = platform.renameFile.bind(platform)
  const remove = platform.removeFile.bind(platform)
  let step = 0
  let interrupted = false
  const mutate = async (path: string, apply: () => Promise<void>) => {
    if (interrupted || !path.startsWith(`${GAME}\\`)) return apply()
    if (step === boundary) { interrupted = true; await interrupt() }
    await apply()
    step++
    if (step === 6 && boundary === 6) { interrupted = true; await interrupt() }
  }
  platform.copyFile = (from, to, replace) => mutate(to, () => copy(from, to, replace))
  platform.renameFile = (from, to, replace) => mutate(to, () => rename(from, to, replace))
  platform.removeFile = (path) => mutate(path, () => remove(path))
}

it.each(['disk-full', 'locked'] as const)('restores every byte and allows retry after %s at every recipe boundary', async (kind) => {
  for (let boundary = 0; boundary <= 6; boundary++) {
    const platform = createFakePlatform(recoveryMachine())
    const before = await snapshot(platform)
    const core = createCore(platform)
    await core.scan()
    await core.review(false)
    interruptApply(platform, boundary, async () => { throw new PlatformError(kind, 'Windows operation failed') })
    await core.deploy()
    expect(await snapshot(platform), `boundary ${boundary}`).toEqual(before)
    expect(core.getState()).toMatchObject({ busy: false, deployment: null, activity: { kind: 'review' } })
    expect(core.getState().error).toMatch(/restored the game folder/)
    expect(core.getState().error).toMatch(kind === 'disk-full' ? /free.*space/i : /Close XIV/)
    await core.deploy()
    expect(core.getState()).toMatchObject({ error: null, activity: { kind: 'done' } })
  }
})

it.each([0, 1, 2, 3, 4, 5, 6])('recovers a process killed at recipe boundary %i at the next start', async (boundary) => {
  const platform = createFakePlatform(recoveryMachine())
  const before = await snapshot(platform)
  const core = createCore(platform)
  await core.scan()
  await core.review(false)
  const { crashed, crash } = crashPoint(platform)
  interruptApply(platform, boundary, crash)
  void core.deploy()
  await crashed
  const reopened = createCore(platform)
  await reopened.scan()
  expect(await snapshot(platform)).toEqual(before)
  expect(reopened.getState()).toMatchObject({ error: null, busy: false, recoveryRequired: false })
  expect(reopened.getState().notice).toMatch(/unfinished deployment.*restored/)
  await reopened.review(false)
  await reopened.deploy()
  expect(reopened.getState()).toMatchObject({ error: null, activity: { kind: 'done' } })
})

it('blocks other startup work and deployment until recovery can restore a locked file', async () => {
  const platform = createFakePlatform(recoveryMachine())
  const before = await snapshot(platform)
  const core = createCore(platform)
  await core.scan()
  await core.review(false)
  const { crashed, crash } = crashPoint(platform)
  interruptApply(platform, 4, crash)
  void core.deploy()
  await crashed
  const copy = platform.copyFile.bind(platform)
  let locked = true
  platform.copyFile = async (from, to, replace) => {
    if (locked && to.startsWith(`${GAME}\\`)) throw new PlatformError('locked', 'Sharing violation')
    await copy(from, to, replace)
  }
  const fetch = platform.fetchText.bind(platform)
  let fetched = false
  platform.fetchText = (url) => { fetched = true; return fetch(url) }
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState()).toMatchObject({ busy: false, recoveryRequired: true, plan: null })
  expect(reopened.getState().error).toMatch(/Recovery could not finish.*Close XIV/)
  expect(fetched).toBe(false)
  await reopened.review(false)
  await reopened.deploy()
  expect(reopened.getState().plan).toBeNull()
  locked = false
  await reopened.scan()
  expect(await snapshot(platform)).toEqual(before)
  expect(reopened.getState()).toMatchObject({ error: null, recoveryRequired: false })
  expect(reopened.getState().notice).toMatch(/restored/)
})

it('keeps a folder the deployment created once it holds a file Lucent does not own, and still recovers', async () => {
  const platform = createFakePlatform(recoveryMachine())
  const before = await snapshot(platform)
  const core = createCore(platform)
  await core.scan()
  await core.review(false)
  const { crashed, crash } = crashPoint(platform)
  interruptApply(platform, 2, crash)
  void core.deploy()
  await crashed
  await platform.writeText(`${GAME}\\scratch\\notes.txt`, 'Mine')
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState()).toMatchObject({ error: null, recoveryRequired: false })
  expect(await snapshot(platform)).toEqual({
    files: { ...before.files, 'scratch\\notes.txt': await platform.hashFile(`${GAME}\\scratch\\notes.txt`) },
    directories: [...before.directories, 'scratch'].sort(),
  })
})

it('waits for XIV to close when it starts mid-install, then recovers on request', async () => {
  const platform = createFakePlatform(recoveryMachine())
  const before = await snapshot(platform)
  const core = createCore(platform)
  await core.scan()
  await core.review(false)
  let running = false
  platform.isGameRunning = async () => running
  interruptApply(platform, 3, async () => { running = true; throw new PlatformError('locked', 'Sharing violation') })
  await core.deploy()
  expect(core.getState()).toMatchObject({ recoveryRequired: true, plan: null, activity: { kind: 'scan' } })
  expect(core.getState().error).toMatch(/Recovery could not finish/)
  expect(core.getState().error!.match(/A file is in use/g)).toHaveLength(1)
  running = false
  await core.scan()
  expect(await snapshot(platform)).toEqual(before)
  expect(core.getState()).toMatchObject({ error: null, recoveryRequired: false })
  expect(core.getState().notice).toMatch(/restored/)
})

it('a successful retry leaves only its record in the data folder and reopens Healthy', async () => {
  const platform = createFakePlatform(recoveryMachine())
  const core = createCore(platform)
  await core.scan()
  await core.review(false)
  interruptApply(platform, 3, async () => { throw new PlatformError('disk-full', 'Disk full') })
  await core.deploy()
  await core.deploy()
  expect(core.getState().activity.kind).toBe('done')
  const deployments = `${await platform.envFolder('LocalAppData')}\\Lucent\\deployments`
  expect((await platform.listFiles(deployments)).filter((f) => !f.includes('\\backups\\'))).toEqual([expect.stringMatching(/\\record\.json$/)])
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState().activity).toMatchObject({ kind: 'deployment', drift: null })
})

it.each(['offline', 'missing', 'truncated', 'wrong hash'])('a %s download never touches the game folder and can be retried', async (failure) => {
  const m = deploymentMachine()
  const platform = createFakePlatform(m)
  const before = await snapshot(platform)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  const lastHash = Object.keys(FIXTURE_ASSETS).at(-1)!
  const url = fixtureUrl(lastHash)
  if (failure === 'missing') delete m.remoteText![url]
  if (failure === 'truncated') m.remoteText![url] = 'Sh'
  if (failure === 'wrong hash') m.remoteText![url] = 'xxxxxx'
  const download = platform.downloadFile.bind(platform)
  platform.downloadFile = (from, to, progress) => {
    if (failure === 'offline') return Promise.reject(new PlatformError('network', 'Connection lost'))
    return download(from, to, progress)
  }
  const copy = platform.copyFile.bind(platform)
  let touched = false
  platform.copyFile = (from, to, replace) => {
    if (to.startsWith(`${GAME}\\`)) touched = true
    return copy(from, to, replace)
  }
  await core.deploy()
  expect(touched).toBe(false)
  expect(await snapshot(platform)).toEqual(before)
  expect(core.getState()).toMatchObject({ busy: false, activity: { kind: 'review' }, deployment: null })
  expect(core.getState().error).toMatch(/game folder has not been changed/)
  expect(core.getState().error).toMatch(['offline', 'missing'].includes(failure) ? /Check your connection/ : /hash check/)
  m.remoteText![url] = FIXTURE_ASSETS[lastHash]
  platform.downloadFile = download
  await core.deploy()
  expect(core.getState()).toMatchObject({ error: null, activity: { kind: 'done' } })
})

it('a crash while staging an atomic copy leaves no temporary bytes in the game folder', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const before = await snapshot(platform)
  const core = createCore(platform)
  await core.scan()
  await core.review(false)
  const copy = platform.copyFile.bind(platform)
  const { crashed, crash } = crashPoint(platform)
  platform.copyFile = async (from, to, replace, stagingDirectory?: string) => {
    if (to.startsWith(`${GAME}\\`)) {
      const directory = stagingDirectory ?? to.slice(0, to.lastIndexOf('\\'))
      expect(directory.toLowerCase().startsWith(ROOT.toLowerCase())).toBe(false)
      await platform.writeText(`${directory}\\.tmp-interrupted-copy`, 'partial file')
      await crash()
    } else await copy(from, to, replace)
  }
  // Completion wins if the copy fails, so the test cannot wait forever on an assertion failure.
  await Promise.race([crashed, core.deploy()])
  expect(core.getState().error).toBeNull()
  const reopened = createCore(platform)
  await reopened.scan()
  expect(await snapshot(platform)).toEqual(before)
  expect(reopened.getState().notice).toMatch(/restored/)
})

async function snapshot(platform: FakePlatform, root = GAME) {
  return {
    files: Object.fromEntries(await Promise.all((await platform.listFiles(root)).sort().map(async (path) =>
      [path, await platform.hashFile(`${root}\\${path}`)],
    ))),
    directories: (await platform.listDirectories(root)).sort(),
  }
}

it('restores the game even when the journal disk stays full throughout recovery', async () => {
  const root = 'D:\\Games\\XIV'
  const platform = createFakePlatform(deploymentMachine(TEST_MANIFEST, root))
  const before = await snapshot(platform, `${root}\\game`)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  const copy = platform.copyFile.bind(platform)
  const write = platform.writeText.bind(platform)
  let gameWrites = 0
  let diskFull = true
  platform.copyFile = async (from, to, replace, staging) => {
    await copy(from, to, replace, staging)
    if (to.startsWith(`${root}\\game\\`)) gameWrites++
  }
  platform.writeText = (path, text, staging) => {
    if (diskFull && gameWrites >= 2 && path.endsWith('record.json')) return Promise.reject(new PlatformError('disk-full', 'Disk full'))
    return write(path, text, staging)
  }
  await core.deploy()
  expect(await snapshot(platform, `${root}\\game`)).toEqual(before)
  expect(core.getState()).toMatchObject({ recoveryRequired: false, activity: { kind: 'review' } })
  expect(core.getState().error).toMatch(/restored the game folder/)
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState()).toMatchObject({ error: null, recoveryRequired: false })
  diskFull = false
  await reopened.review()
  await reopened.deploy()
  expect(reopened.getState().activity.kind).toBe('done')
})

it('recovers a crash before startup scans, even when the launcher now points to another game folder', async () => {
  const platform = createFakePlatform(deploymentMachine())
  const before = await snapshot(platform)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  const copy = platform.copyFile.bind(platform)
  const { crashed, crash } = crashPoint(platform)
  platform.copyFile = async (from, to, replace) => {
    await copy(from, to, replace)
    if (to.endsWith('ReShade.download')) await crash()
  }
  void core.deploy()
  await crashed
  const other = 'D:\\Another XIV'
  const launcher = machine(xivLauncher(other)).files!
  for (const [path, text] of Object.entries({ ...vanillaGame(other).files, ...launcher })) await platform.writeText(path, text)
  platform.copyFile = copy
  const fetch = platform.fetchText.bind(platform)
  platform.fetchText = async (url) => {
    expect(await snapshot(platform)).toEqual(before)
    return fetch(url)
  }
  const reopened = createCore(platform)
  await reopened.scan()
  expect(await snapshot(platform)).toEqual(before)
  expect(reopened.getState()).toMatchObject({
    busy: false, error: null, gameFolder: { status: 'found', path: other }, manifest: { status: 'ready' },
    notice: expect.stringMatching(/unfinished deployment.*restored/i),
  })
})
