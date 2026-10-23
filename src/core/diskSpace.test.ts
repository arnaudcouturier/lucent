// Review warns when a drive looks too full for the plan: Lucent's data folder takes the downloads, the journal's backups
// and a first deployment's readable copy; the game folder grows by what the plan writes beyond what it overwrites, plus
// one file in flight. A warning only.
import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform, type Machine } from '../platform/fake'
import { existingSetup, fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { fileKey, type Plan } from './planner'
import { spaceLabels, spaceShortfalls } from './diskSpace'
import type { ContentFile } from '../shared/manifest'

const MB = 1024 ** 2
const GB = 1024 ** 3
const C = 'C:\\Games\\XIV'
const D = 'D:\\Games\\XIV'
/** What a drive must have free for `bytes` of writes: a tenth more, and 64 MB. */
const needed = (bytes: number) => Math.ceil(bytes * 1.1) + 64 * MB
/** The content files the plan copies into the game folder, with their sizes. */
const writes = (plan: Plan) => plan.steps.flatMap((step) => step.kind === 'copy' ? [{ path: step.to, size: plan.files.find((f) => f.sha256 === step.file)!.size }] : [])
/** The files from before the plan that it replaces, as they are on disk now; with `writtenOnly`, only those a write lands on. */
const replaced = async (platform: FakePlatform, game: string, plan: Plan, writtenOnly = false) => {
  const destinations = new Set(writes(plan).map((write) => fileKey(write.path)))
  const paths = plan.filesToBackup.filter((path) => !writtenOnly || destinations.has(fileKey(path)))
  return (await Promise.all(paths.map((path) => platform.stat(`${game}\\game\\${path}`)))).reduce((sum, stat) => sum + stat.size, 0)
}
/** What the game folder grows by: the bytes written beyond those they overwrite, and the largest file, written whole before the old one goes. */
const growth = async (platform: FakePlatform, game: string, plan: Plan) => {
  const sizes = writes(plan).map((write) => write.size)
  return Math.max(0, sizes.reduce((a, b) => a + b, 0) - await replaced(platform, game, plan, true)) + Math.max(0, ...sizes)
}

/** A first install up to Review, the game folder holding an old ReShade setup that it backs up. */
async function reviewed(game: string, freeSpace: Machine['freeSpace'] = {}) {
  const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(game), xivLauncher(game), existingSetup(game, 'reshade'), { freeSpace })
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  const plan = core.getState().plan!
  return { m, platform, core, plan, backups: await replaced(platform, game, plan) }
}

describe('Review’s free-space warning', () => {
  it('warns when C: has less room than the install needs, adding up the data folder and the game folder on it', async () => {
    const { platform, core, plan, backups } = await reviewed(C, { 'C:': 10 * MB })
    expect(plan.counts.backedUp).toBeGreaterThan(0)
    expect(plan.downloadSize).toBeGreaterThan(0)
    // The downloads, the journal's backups and the readable copy of the same files, then what the game folder grows by: one need, one margin.
    expect(core.getState().spaceWarning).toEqual([{ drive: 'C:', needed: needed(plan.downloadSize + 2 * backups + await growth(platform, C, plan)), free: 10 * MB }])
    expect(core.getState().activity.kind).toBe('review')
    expect(core.getState().error).toBeNull()
  })

  it('shows nothing when there is room, down to exactly what it needs', async () => {
    const { m, platform, core, plan, backups } = await reviewed(C)
    expect(core.getState().spaceWarning).toBeNull()
    const need = needed(plan.downloadSize + 2 * backups + await growth(platform, C, plan))
    m.freeSpace = { 'C:': need }
    core.backToProfile()
    await core.review()
    expect(core.getState().spaceWarning).toBeNull()
    m.freeSpace = { 'C:': need - 1 }
    core.backToProfile()
    await core.review()
    expect(core.getState().spaceWarning).toEqual([{ drive: 'C:', needed: need, free: need - 1 }])
  })

  it('with the game on another drive, warns for the drive that is short and only that one', async () => {
    const short = await reviewed(D, { 'D:': MB })
    expect(short.core.getState().spaceWarning).toEqual([{ drive: 'D:', needed: needed(await growth(short.platform, D, short.plan)), free: MB }])
    const data = await reviewed(D, { 'C:': MB })
    expect(data.core.getState().spaceWarning).toEqual([{ drive: 'C:', needed: needed(data.plan.downloadSize + 2 * data.backups), free: MB }])
    const both = await reviewed(D, { 'C:': MB, 'D:': MB })
    expect(both.core.getState().spaceWarning?.map((s) => s.drive)).toEqual(['C:', 'D:'])
  })

  it('asks for no download space when the content is already cached, and no readable copy on a Reset', async () => {
    const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(C), xivLauncher(C))
    const platform = createFakePlatform(m)
    const installed = createCore(platform)
    await installed.scan()
    await installed.review()
    await installed.deploy()
    m.freeSpace = { 'C:': MB }
    const core = createCore(platform)
    await core.scan()
    await core.resetSetup()
    await core.review()
    const plan = core.getState().plan!
    expect(core.getState().setupMode).toBe('reset')
    expect(plan.downloadSize).toBe(0)
    // Every deployed file it rewrites is backed up by the journal first; a Reset's readable copy holds only the configs.
    expect(core.getState().spaceWarning).toEqual([{ drive: 'C:', needed: needed(await replaced(platform, C, plan) + await growth(platform, C, plan)), free: MB }])
  })

  it('a Reset with the game on its own drive needs little more than its largest file there, so it doesn’t warn', async () => {
    const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(D), xivLauncher(D))
    const platform = createFakePlatform(m)
    const installed = createCore(platform)
    await installed.scan()
    await installed.review()
    await installed.deploy()
    const core = createCore(platform)
    await core.scan()
    await core.resetSetup()
    await core.review()
    const plan = core.getState().plan!
    const sizes = writes(plan).map((write) => write.size)
    const total = sizes.reduce((a, b) => a + b, 0)
    // It writes over what it wrote before, byte for byte the same size except for the settings it puts in the configs.
    expect(await replaced(platform, D, plan, true)).toBeGreaterThan(total * 0.9)
    const need = needed(await growth(platform, D, plan))
    // Counting every rewritten byte would ask for more than this.
    expect(need).toBeLessThan(needed(total))
    m.freeSpace = { 'D:': need }
    core.backToProfile()
    await core.review()
    expect(core.getState().spaceWarning).toBeNull()
  })

  it('a first install with nothing to replace warns for what it writes, plus its largest file', async () => {
    const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(D), xivLauncher(D), { freeSpace: { 'D:': MB } })
    const platform = createFakePlatform(m)
    const core = createCore(platform)
    await core.scan()
    await core.review()
    const plan = core.getState().plan!
    expect(plan.filesToBackup).toEqual([])
    const sizes = writes(plan).map((write) => write.size)
    expect(core.getState().spaceWarning).toEqual([{ drive: 'D:', needed: needed(sizes.reduce((a, b) => a + b, 0) + Math.max(...sizes)), free: MB }])
  })

  it('shows nothing for a drive whose free space can’t be read', async () => {
    const { core } = await reviewed(D, { 'C:': null, 'D:': null })
    expect(core.getState().spaceWarning).toBeNull()
    const same = await reviewed(C, { 'C:': null })
    expect(same.core.getState().spaceWarning).toBeNull()
  })

  it('never blocks Install nor changes the plan', async () => {
    const roomy = await reviewed(C)
    const { platform, core, plan } = await reviewed(C, { 'C:': MB })
    expect(core.getState().spaceWarning).not.toBeNull()
    expect(plan).toEqual(roomy.plan)
    await core.deploy()
    expect(core.getState().error).toBeNull()
    expect(core.getState().activity.kind).toBe('done')
    expect(core.getState().deployment?.status).toBe('complete')
    await expect(platform.readText(`${C}\\game\\ReShade.ini`)).resolves.not.toContain('Mine.ini')
  })
})

describe('the game drive’s need at real sizes', () => {
  // A 750 MB deployment whose largest file is the 300 MB runtime, as the fake can't hold: the files on disk report these sizes.
  const SIZES = { 'nvngx_dlssnr.dll': 300 * MB, 'OptiScaler\\models.bin': 250 * MB, 'reshade-shaders\\pack.bin': 200 * MB }
  const content: ContentFile[] = Object.values(SIZES).map((size, i) => ({ sha256: String(i).repeat(64), size, release: 'content-2026.10.23' }))
  const plan = (replacing: boolean) => ({
    files: content, downloadSize: 0,
    steps: Object.keys(SIZES).map((to, i) => ({ kind: 'copy' as const, file: content[i].sha256, to })),
    filesToBackup: replacing ? Object.keys(SIZES) : [],
  }) as unknown as Plan
  const onDrive = (freeSpace: Machine['freeSpace']) => {
    const fake = createFakePlatform({ directories: [`${D}\\game`], freeSpace })
    const sizes = new Map(Object.entries(SIZES).map(([path, size]) => [fileKey(`${D}\\game\\${path}`), size]))
    return { ...fake, statMany: async (paths: string[]) => paths.map((path) => sizes.has(fileKey(path)) ? { kind: 'file' as const, size: sizes.get(fileKey(path))!, modifiedMs: 0, readOnly: false } : null) }
  }
  const folders = { data: 'C:\\Users\\Player\\AppData\\Local\\Lucent', game: D }

  it('rewriting the same files in place asks for one file in flight, not every byte', async () => {
    const need = needed(300 * MB)
    expect(need).toBeLessThan(400 * MB)
    // Counting every rewritten byte would have warned at 400 MB.
    expect(needed(750 * MB)).toBeGreaterThan(400 * MB)
    await expect(spaceShortfalls(onDrive({ 'D:': 400 * MB }), plan(true), folders, false)).resolves.toEqual([])
    await expect(spaceShortfalls(onDrive({ 'D:': need - 1 }), plan(true), folders, false)).resolves.toEqual([{ drive: 'D:', needed: need, free: need - 1 }])
  })

  it('a first install onto nothing asks for all it writes, plus its largest file', async () => {
    await expect(spaceShortfalls(onDrive({ 'D:': 400 * MB }), plan(false), folders, true)).resolves.toEqual([{ drive: 'D:', needed: needed(1050 * MB), free: 400 * MB }])
  })
})

describe('the warning’s figures', () => {
  it('round the need up and the free space down, so a short drive never reads as having enough', () => {
    expect(spaceLabels({ drive: 'C:', needed: Math.round(1.41 * GB), free: Math.round(1.39 * GB) })).toEqual({ needed: '1.5 GB', free: '1.3 GB' })
    expect(spaceLabels({ drive: 'C:', needed: 64 * MB + 500, free: 10 * MB })).toEqual({ needed: '64.1 MB', free: '10.0 MB' })
    // Just under a gigabyte, rounded up, is a gigabyte.
    expect(spaceLabels({ drive: 'C:', needed: GB - 1, free: GB - 2 })).toEqual({ needed: '1.0 GB', free: '1023.9 MB' })
    for (const free of [0, 1, MB - 1, MB, 64 * MB, GB - 1, GB, GB + 1, Math.round(1.4 * GB), 10 * GB, 2 ** 40]) {
      const labels = spaceLabels({ drive: 'C:', needed: free + 1, free })
      expect(labels.needed, `${free}`).not.toBe(labels.free)
    }
  })
})
