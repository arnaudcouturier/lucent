import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { afterEach, expect, it } from 'vitest'
import { parseManifest } from '../src/shared/manifest'
import { createCore } from '../src/core/core'
import { MANIFEST_URL } from '../src/core/manifest'
import { createFakePlatform } from '../src/platform/fake'
import { graphicsCard, machine, vanillaGame, xivLauncher } from '../src/platform/fixtures'
import { publishContent, type ContentRelease, type PublishHost, type PublishInput } from './publish-content'
import { runCommand } from './command'

const fixture = resolve('scripts/fixtures/publish/valid/publish.json')
const temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

async function manifestFile() {
  const directory = await mkdtemp(resolve(tmpdir(), 'lucent-publish-test-'))
  temporary.push(directory)
  const path = resolve(directory, 'manifest.json')
  // Start from the repo's tiers, not its published versions: these tests add
  // the fixture version to an otherwise empty manifest.
  const base = JSON.parse(await readFile('manifest.json', 'utf8'))
  base.versions = []
  await writeFile(path, JSON.stringify(base))
  return path
}

async function inputFile(manifestPath: string, change: (input: PublishInput) => void) {
  const input: PublishInput = JSON.parse(await readFile(fixture, 'utf8'))
  input.tiers.other.sources[0] = { folder: resolve('scripts/fixtures/publish/valid/files'), component: 'ReShade fixture' }
  change(input)
  const path = resolve(manifestPath, '..', 'publish.json')
  await writeFile(path, JSON.stringify(input))
  return path
}

it('previews hash-named uploads and the shared manifest without GitHub or local manifest changes', async () => {
  const manifestPath = await manifestFile()
  const before = await readFile(manifestPath, 'utf8')
  const localFiles = resolve(manifestPath, '..', 'hash-named-files')
  const host = releaseHost().host
  host.listContentReleases = async () => { throw new Error('Dry run contacted GitHub') }
  const result = await publishContent(fixture, { manifestPath, dryRun: true, dryRunFilesDirectory: localFiles, host })
  expect(result.release).toBe('content-2026.10.12')
  expect(result.uploads).toHaveLength(4)
  expect(result.uploads.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true)
  expect(parseManifest(result.manifestText).versions[0]).toMatchObject({
    id: '2026.10.12', channel: 'stable', changelog: ['Tested fixture content.'],
    tiers: { other: { resetKeys: [{ file: 'ReShade.ini', section: 'GENERAL', key: 'PresetPath' }] } },
  })
  for (const file of parseManifest(result.manifestText).versions[0].files) {
    expect((await readFile(resolve(localFiles, file.sha256))).length).toBe(file.size)
  }
  expect(await readFile(manifestPath, 'utf8')).toBe(before)
})

it('refuses two shaders with different bytes at the same Windows path', async () => {
  const manifestPath = await manifestFile()
  await expect(publishContent(resolve('scripts/fixtures/publish/shader-collision/publish.json'), { manifestPath, dryRun: true })).rejects.toThrow(/shader.*collision/i)
})

it('refuses a preset reference to a shader not shipped or declared user-supplied', async () => {
  const manifestPath = await manifestFile()
  await expect(publishContent(resolve('scripts/fixtures/publish/missing-shader/publish.json'), { manifestPath, dryRun: true })).rejects.toThrow(/shader.*Paid\.fx/i)
})

it.each(['used', 'all'] as const)('never ships declared user-supplied effects from a tested source, including with shaders=%s', async (shaders) => {
  const manifestPath = await manifestFile()
  const input = await inputFile(manifestPath, (value) => {
    value.knownUserShaders = [...value.knownUserShaders ?? [], 'Example.fx']
    value.tiers.other.shaders = shaders
  })
  const result = await publishContent(input, { manifestPath, dryRun: true })
  const content = parseManifest(result.manifestText).versions[0]
  expect(result.uploads).toHaveLength(3)
  expect(content.tiers.other.recipe.some((step) => step.kind === 'copy' && /Example\.fx$/i.test(step.to))).toBe(false)
})

it.each([
  { kind: 'copy', file: 'dxgi.dll', to: 'reshade-shaders/Shaders/Paid.fx' },
  { kind: 'rename', from: 'dxgi.dll', to: 'reshade-shaders/Shaders/Paid.fx' },
  { kind: 'delete', path: 'reshade-shaders/Shaders/Paid.fx' },
  { kind: 'ini_set', file: 'reshade-shaders/Shaders/Paid.fx', section: 'GENERAL', key: 'Value', value: '1' },
] as const)('refuses a recipe step that touches a declared user-supplied shader: $kind', async (step) => {
  const manifestPath = await manifestFile()
  const input = await inputFile(manifestPath, (value) => { value.tiers.other.recipe = [step] })
  await expect(publishContent(input, { manifestPath, dryRun: true })).rejects.toThrow(/must not touch user-supplied shader.*Paid\.fx/)
})

it('refuses a recipe that escapes the game folder', async () => {
  const manifestPath = await manifestFile()
  await expect(publishContent(resolve('scripts/fixtures/publish/path-escape/publish.json'), { manifestPath, dryRun: true })).rejects.toThrow(/unsafe game-folder path/i)
})

it('refuses an empty source file, which GitHub cannot store as a release asset', async () => {
  const manifestPath = await manifestFile()
  const directory = resolve(manifestPath, '..', 'empty-files')
  await mkdir(resolve(directory, 'reshade-presets'), { recursive: true })
  await mkdir(resolve(directory, 'reshade-shaders', 'Shaders'), { recursive: true })
  for (const name of ['dxgi.dll', 'ReShade.ini', 'reshade-presets/Example.ini', 'reshade-shaders/Shaders/Example.fx']) {
    await writeFile(resolve(directory, name), await readFile(resolve('scripts/fixtures/publish/valid/files', name)))
  }
  await writeFile(resolve(directory, 'Empty.txt'), '')
  const input = await inputFile(manifestPath, (value) => { value.tiers.other.sources = [{ folder: directory, component: 'ReShade fixture' }] })
  await expect(publishContent(input, { manifestPath, dryRun: true })).rejects.toThrow(/Empty\.txt.*empty.*release asset/i)
})

it('refuses an OptiScaler file without a GPL source tag', async () => {
  const manifestPath = await manifestFile()
  await expect(publishContent(resolve('scripts/fixtures/publish/missing-gpl-source/publish.json'), { manifestPath, dryRun: true })).rejects.toThrow(/OptiScaler.*GPL source tag/i)
})

it('keeps vendor DLL provenance when the DLL lives in OptiScaler’s runtime folder', async () => {
  const manifestPath = await manifestFile()
  const vendorFiles = resolve(manifestPath, '..', 'vendor-files')
  await mkdir(resolve(vendorFiles, 'OptiScaler'), { recursive: true })
  await writeFile(resolve(vendorFiles, 'OptiScaler', 'libxess_fg.dll'), 'Unmodified Intel XeSS runtime\n')
  const input = await inputFile(manifestPath, (value) => {
    value.components.push({
      name: 'Intel XeSS frame generation',
      upstream: 'Intel',
      licence: 'Intel Simplified Software License',
      source: 'https://github.com/intel/xess/tree/v1.3.1',
    })
    value.tiers.other.sources.push({ folder: vendorFiles, component: 'Intel XeSS frame generation' })
  })
  const result = await publishContent(input, { manifestPath, dryRun: true })
  const version = parseManifest(result.manifestText).versions[0]
  const xess = version.tiers.other.recipe.find((step) => step.kind === 'copy' && step.to === 'OptiScaler/libxess_fg.dll')
  expect(xess).toBeDefined()
  expect(version.components).toContainEqual(expect.objectContaining({ name: 'Intel XeSS frame generation', licence: 'Intel Simplified Software License' }))
})

function releaseHost() {
  const releases: ContentRelease[] = []
  const assets: Record<string, string> = {}
  const host: PublishHost = {
    async listContentReleases() { return structuredClone(releases) },
    async createDraft(tag) { const id = releases.length + 1; releases.push({ id, tag, draft: true, files: [] }); return id },
    async upload(id, file) {
      const release = releases.find((r) => r.id === id)!
      assets[`https://github.com/arnaudcouturier/lucent/releases/download/${release.tag}/${file.sha256}`] = await readFile(file.stagedPath, 'utf8')
      release.files.push({ sha256: file.sha256, size: file.size, release: release.tag })
    },
    async publish(id) { releases.find((r) => r.id === id)!.draft = false },
  }
  return { host, assets, releases }
}

it('publishes the fixture and deploys it through the core to a healthy game folder', async () => {
  const manifestPath = await manifestFile()
  const remote = releaseHost()
  const input = await inputFile(manifestPath, (value) => {
    const tier = value.tiers.other
    tier.performanceProfilesV2 = (['ultra', 'fidelity', 'balanced', 'performance'] as const).map((id) => ({
      id, label: id, description: `${id} profile`,
      settings: [{ file: 'ReShade.ini', section: 'GENERAL', key: 'ProfileValue', value: {
        '1080p': `${id}-1080`, '1440p': `${id}-1440`, '4k+': `${id}-4k`,
      } }],
    }))
    tier.frameGenerationOptions = [
      { id: 'off', settings: [{ file: 'ReShade.ini', section: 'GENERAL', key: 'FrameMode', value: 'off' }] },
      { id: '2x', experimental: true, settings: [{ file: 'ReShade.ini', section: 'GENERAL', key: 'FrameMode', value: '2x' }],
        hdrSettings: [{ file: 'ReShade.ini', section: 'GENERAL', key: 'FrameHDRMode', value: '2x' }] },
    ]
    tier.screenDerivedSettings = [
      { file: 'ReShade.ini', section: 'GENERAL', key: 'FrameCap', value: 'frameCap' },
      { file: 'ReShade.ini', section: 'GENERAL', key: 'PeakNits', value: 'peakNits' },
    ]
    tier.hdrOptions = [
      { id: 'off', settings: [{ file: 'ReShade.ini', section: 'GENERAL', key: 'HdrMode', value: 'off' }] },
      { id: 'hdr', settings: [{ file: 'ReShade.ini', section: 'GENERAL', key: 'HdrMode', value: 'hdr' }] },
      { id: 'scene-hdr', experimental: true, settings: [{ file: 'ReShade.ini', section: 'GENERAL', key: 'HdrMode', value: 'scene-hdr' }] },
    ]
  })
  const result = await publishContent(input, { manifestPath, host: remote.host })
  expect(remote.releases).toMatchObject([{ tag: 'content-2026.10.12', draft: false }])
  expect(remote.releases[0].files).toContainEqual({ sha256: '5570478b4db90c4450004ec383ca2f2861b75de9be30863982d5065dc6d0b54f', size: 22, release: 'content-2026.10.12' })
  expect(await readFile(manifestPath, 'utf8')).toBe(result.manifestText)
  const publishedTier = parseManifest(result.manifestText).versions[0].tiers.other
  expect(publishedTier).toMatchObject({
    performanceProfilesV2: [{ id: 'ultra' }, { id: 'fidelity' }, { id: 'balanced', settings: [{ value: { '1080p': 'balanced-1080', '1440p': 'balanced-1440', '4k+': 'balanced-4k' } }] }, { id: 'performance' }],
    frameGenerationOptions: [{ id: 'off' }, { id: '2x', experimental: true, hdrSettings: [{ key: 'FrameHDRMode' }] }],
    screenDerivedSettings: [{ key: 'FrameCap', value: 'frameCap' }, { key: 'PeakNits', value: 'peakNits' }],
    hdrOptions: [{ id: 'off' }, { id: 'hdr' }, { id: 'scene-hdr', experimental: true }],
  })
  const root = 'C:\\Games\\XIV'
  const platform = createFakePlatform(machine(vanillaGame(root), xivLauncher(root), graphicsCard('Intel Arc A770', 0x8086), { remoteText: { [MANIFEST_URL]: result.manifestText, ...remote.assets } }))
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  expect(core.getState().error).toBeNull()
  expect(core.getState().deployment?.recipe).toMatchObject({
    performanceProfilesV2: [{ id: 'ultra' }, { id: 'fidelity' }, { id: 'balanced' }, { id: 'performance' }],
    frameGenerationOptions: [{ id: 'off' }, { id: '2x', hdrSettings: [{ key: 'FrameHDRMode' }] }],
    screenDerivedSettings: [{ key: 'FrameCap', value: 'frameCap' }, { key: 'PeakNits', value: 'peakNits' }],
    hdrOptions: [{ id: 'off' }, { id: 'hdr' }, { id: 'scene-hdr', experimental: true }],
  })
  expect(await platform.readText(`${root}\\game\\ReShade.ini`)).toContain('ProfileValue=balanced-4k')
  expect(await platform.readText(`${root}\\game\\ReShade.ini`)).toContain('FrameMode=off')
  expect(await platform.readText(`${root}\\game\\dxgi.dll`)).toBe('Inert ReShade fixture\n')
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState().activity).toMatchObject({ kind: 'deployment', drift: null })
})

it('spans a content version with more than 1,000 new files across numbered releases', async () => {
  const manifestPath = await manifestFile()
  const directory = resolve(manifestPath, '..', 'many-files')
  await mkdir(resolve(directory, 'reshade-presets'), { recursive: true })
  await mkdir(resolve(directory, 'reshade-shaders', 'Shaders'), { recursive: true })
  for (const name of ['dxgi.dll', 'ReShade.ini', 'reshade-presets/Example.ini', 'reshade-shaders/Shaders/Example.fx']) {
    await writeFile(resolve(directory, name), await readFile(resolve('scripts/fixtures/publish/valid/files', name)))
  }
  await Promise.all(Array.from({ length: 1001 }, (_, i) => writeFile(resolve(directory, `extra-${i}.txt`), `extra ${i}\n`)))
  const input = await inputFile(manifestPath, (value) => { value.tiers.other.sources = [{ folder: directory, component: 'ReShade fixture' }] })
  const preview = parseManifest((await publishContent(input, { manifestPath, dryRun: true })).manifestText).versions[0]
  expect(preview.files.filter((f) => f.release === 'content-2026.10.12')).toHaveLength(1000)
  expect(preview.files.filter((f) => f.release === 'content-2026.10.12-2')).toHaveLength(5)
  const remote = releaseHost()
  const result = await publishContent(input, { manifestPath, host: remote.host })
  expect(remote.releases.map((r) => [r.tag, r.draft, r.files.length])).toEqual([
    ['content-2026.10.12', false, 1000],
    ['content-2026.10.12-2', false, 5],
  ])
  const version = parseManifest(result.manifestText).versions[0]
  expect(version.files.filter((f) => f.release === 'content-2026.10.12')).toHaveLength(1000)
  expect(version.files.filter((f) => f.release === 'content-2026.10.12-2')).toHaveLength(5)
  expect(result.uploads).toHaveLength(1005)
}, 30_000)

it('reuses assets from any published content release, including one absent from the manifest', async () => {
  const manifestPath = await manifestFile()
  const remote = releaseHost()
  remote.releases.push({ id: 1, tag: 'content-2026.10.01', draft: false, files: [{ sha256: '5570478b4db90c4450004ec383ca2f2861b75de9be30863982d5065dc6d0b54f', size: 22, release: 'content-2026.10.01' }] })
  const result = await publishContent(fixture, { manifestPath, host: remote.host })
  expect(result.uploads).toHaveLength(3)
  expect(parseManifest(result.manifestText).versions[0].files).toContainEqual({ sha256: '5570478b4db90c4450004ec383ca2f2861b75de9be30863982d5065dc6d0b54f', size: 22, release: 'content-2026.10.01' })
})

it('creates an immutable dated release for a recipe-only version whose assets are all reused', async () => {
  const manifestPath = await manifestFile()
  const remote = releaseHost()
  await publishContent(fixture, { manifestPath, host: remote.host })
  const input = await inputFile(manifestPath, (value) => {
    value.id = '2026.10.13'
    value.changelog = ['Updated recipe using the existing tested files.']
    value.tiers.other.recipe = [
      { kind: 'copy', file: 'dxgi.dll', to: 'dxgi.dll' },
      { kind: 'copy', file: 'ReShade.ini', to: 'ReShade.ini' },
      { kind: 'copy', file: 'reshade-presets/Example.ini', to: 'reshade-presets/Example.ini' },
      { kind: 'copy', file: 'reshade-shaders/Shaders/Example.fx', to: 'reshade-shaders/Shaders/Example.fx' },
      { kind: 'ini_set', file: 'ReShade.ini', section: 'GENERAL', key: 'PerformanceMode', value: '1' },
    ]
  })
  const result = await publishContent(input, { manifestPath, host: remote.host })
  expect(result.uploads).toEqual([])
  expect(remote.releases).toMatchObject([
    { tag: 'content-2026.10.12', draft: false },
    { tag: 'content-2026.10.13', draft: false, files: [] },
  ])
  expect(parseManifest(result.manifestText).versions[1].files.every((file) => file.release === 'content-2026.10.12')).toBe(true)
  // A checkout without the new manifest entry still cannot republish that immutable date.
  await expect(publishContent(input, { manifestPath: await manifestFile(), host: remote.host })).rejects.toThrow(/already exists/i)
})

it('preserves known-broken game versions in the candidate and published manifests', async () => {
  const manifestPath = await manifestFile()
  const knownBrokenGameVersions = ['2026.10.20.0000.0000']
  const input = await inputFile(manifestPath, (value) => { value.knownBrokenGameVersions = knownBrokenGameVersions })
  const preview = await publishContent(input, { manifestPath, dryRun: true })
  expect(parseManifest(preview.manifestText).versions[0].knownBrokenGameVersions).toEqual(knownBrokenGameVersions)
  await publishContent(input, { manifestPath, host: releaseHost().host })
  expect(parseManifest(await readFile(manifestPath, 'utf8')).versions[0].knownBrokenGameVersions).toEqual(knownBrokenGameVersions)
})

it('leaves the manifest unchanged when an upload fails and keeps the release unpublished', async () => {
  const manifestPath = await manifestFile()
  const before = await readFile(manifestPath, 'utf8')
  const remote = releaseHost()
  remote.host.upload = async () => { throw new Error('Upload failed') }
  await expect(publishContent(fixture, { manifestPath, host: remote.host })).rejects.toThrow('Upload failed')
  expect(await readFile(manifestPath, 'utf8')).toBe(before)
  expect(remote.releases).toMatchObject([{ draft: true }])
})

const sevenZip = process.platform === 'win32' ? 'C:\\Program Files\\7-Zip\\7z.exe' : '7z'
it.skipIf(process.platform === 'win32' && !existsSync(sevenZip))('unpacks an upstream archive with 7-Zip and produces the same content as the tested folder', async () => {
  const manifestPath = await manifestFile()
  const directory = resolve(manifestPath, '..')
  const archive = resolve(directory, 'upstream.zip')
  await runCommand(sevenZip, ['a', '-tzip', archive, `${resolve('scripts/fixtures/publish/valid/files')}/*`])
  const input = JSON.parse(await readFile(fixture, 'utf8'))
  input.tiers.other.sources = [{ archive, component: 'ReShade fixture' }]
  const inputPath = resolve(directory, 'publish.json')
  await writeFile(inputPath, JSON.stringify(input))
  const fromArchive = await publishContent(inputPath, { manifestPath, dryRun: true, sevenZip })
  const fromFolder = await publishContent(fixture, { manifestPath, dryRun: true })
  expect(parseManifest(fromArchive.manifestText)).toEqual(parseManifest(fromFolder.manifestText))
})

it('deduplicates identical files across tiers and source folders', async () => {
  const manifestPath = await manifestFile()
  const input = await inputFile(manifestPath, (input) => {
    input.tiers.other.sources.push(input.tiers.other.sources[0])
    input.tiers.radeon = structuredClone(input.tiers.other)
  })
  const result = await publishContent(input, { manifestPath, dryRun: true })
  expect(result.uploads).toHaveLength(4)
  expect(Object.keys(parseManifest(result.manifestText).versions[0].tiers)).toEqual(['other', 'radeon'])
})

it('checks shader collisions introduced by recipe destinations', async () => {
  const manifestPath = await manifestFile()
  const input = await inputFile(manifestPath, (input) => {
    input.tiers.other.recipe = [
      { kind: 'copy', file: 'dxgi.dll', to: 'dxgi.dll' },
      { kind: 'copy', file: 'dxgi.dll', to: 'reshade-shaders/Shaders/Example.fx' },
    ]
    input.tiers.other.ownedConfigs = []
    input.tiers.other.shippedPresets = []
    input.tiers.other.resetKeys = []
  })
  await expect(publishContent(input, { manifestPath, dryRun: true })).rejects.toThrow(/shader.*collision/i)
})

it('validates presets against the final recipe rather than unused source shaders', async () => {
  const manifestPath = await manifestFile()
  const input = await inputFile(manifestPath, (input) => {
    input.tiers.other.recipe = [
      { kind: 'copy', file: 'dxgi.dll', to: 'dxgi.dll' },
      { kind: 'copy', file: 'ReShade.ini', to: 'ReShade.ini' },
      { kind: 'copy', file: 'reshade-presets/Example.ini', to: 'reshade-presets/Example.ini' },
    ]
  })
  await expect(publishContent(input, { manifestPath, dryRun: true })).rejects.toThrow(/missing shader: Example\.fx/i)
})

it('preserves all performance profiles and reset keys in the shared manifest', async () => {
  const manifestPath = await manifestFile()
  const input = await inputFile(manifestPath, (input) => {
    input.tiers.other.performanceProfiles = ['fidelity', 'balanced', 'performance'].map((id) => ({
      id: id as 'fidelity' | 'balanced' | 'performance', label: id, description: `${id} description`,
      settings: [{ file: 'ReShade.ini', section: 'GENERAL', key: 'Example', value: '1' }],
    }))
  })
  const result = await publishContent(input, { manifestPath, dryRun: true })
  expect(parseManifest(result.manifestText).versions[0].tiers.other).toMatchObject({
    performanceProfiles: [
      { id: 'fidelity', settings: [{ file: 'ReShade.ini', section: 'GENERAL', key: 'Example', value: '1' }] },
      { id: 'balanced' }, { id: 'performance' },
    ],
    resetKeys: [{ file: 'ReShade.ini', section: 'GENERAL', key: 'PresetPath' }],
  })
})

it('refuses an existing date in the manifest or the release host', async () => {
  const manifestPath = await manifestFile()
  const remote = releaseHost()
  remote.releases.push({ id: 1, tag: 'content-2026.10.12', draft: true, files: [] })
  await expect(publishContent(fixture, { manifestPath, host: remote.host })).rejects.toThrow(/already exists/i)
  remote.releases.length = 0
  await publishContent(fixture, { manifestPath, host: remote.host })
  await expect(publishContent(fixture, { manifestPath, host: remote.host })).rejects.toThrow(/already exists/i)
})

it('does not overwrite manifest edits made during publication', async () => {
  const manifestPath = await manifestFile()
  const remote = releaseHost()
  const edited = `${await readFile(manifestPath, 'utf8')}\n`
  remote.host.upload = async () => { await writeFile(manifestPath, edited) }
  await expect(publishContent(fixture, { manifestPath, host: remote.host })).rejects.toThrow(/manifest changed/i)
  expect(await readFile(manifestPath, 'utf8')).toBe(edited)
  expect(remote.releases[0].draft).toBe(true)
})

it('requires GPL provenance when a recipe renames a file to an OptiScaler entry file', async () => {
  const manifestPath = await manifestFile()
  const input = await inputFile(manifestPath, (input) => {
    input.tiers.other.recipe = [{ kind: 'copy', file: 'dxgi.dll', to: 'staging.dll' }, { kind: 'rename', from: 'staging.dll', to: 'winmm.dll' }]
    input.tiers.other.entryFiles = [{ path: 'winmm.dll' }]
    input.tiers.other.ownedConfigs = []
    input.tiers.other.shippedPresets = []
    input.tiers.other.resetKeys = []
  })
  await expect(publishContent(input, { manifestPath, dryRun: true })).rejects.toThrow(/OptiScaler.*GPL source tag/i)
})

it('validates presets edited by every performance profile, including a reference introduced only by Performance', async () => {
  const manifestPath = await manifestFile()
  const makeInput = (missing: boolean) => inputFile(manifestPath, (input) => {
    input.tiers.other.ownedConfigs.push({ path: 'reshade-presets/Example.ini' })
    input.tiers.other.performanceProfiles = (['fidelity', 'balanced', 'performance'] as const).map((id) => ({
      id, label: id, description: `${id} description`,
      settings: [{ file: 'reshade-presets/Example.ini', section: 'GENERAL', key: 'Techniques', value: missing && id === 'performance' ? 'Missing@Missing.fx' : 'Example@Example.fx' }],
    }))
  })
  const valid = await makeInput(false)
  expect((await publishContent(valid, { manifestPath, dryRun: true })).uploads).toHaveLength(4)
  const invalid = await makeInput(true)
  await expect(publishContent(invalid, { manifestPath, dryRun: true })).rejects.toThrow(/missing shader: Missing\.fx/i)
})

it.each(['1080p', '1440p', '4k+'] as const)('validates V2 preset edits at the %s resolution column', async (missingColumn) => {
  const manifestPath = await manifestFile()
  const input = await inputFile(manifestPath, (value) => {
    const tier = value.tiers.other
    tier.ownedConfigs.push({ path: 'reshade-presets/Example.ini' })
    tier.performanceProfilesV2 = (['ultra', 'fidelity', 'balanced', 'performance'] as const).map((id) => ({
      id, label: id, description: `${id} description`,
      settings: [{ file: 'reshade-presets/Example.ini', section: 'GENERAL', key: 'Techniques', value: {
        '1080p': 'Example@Example.fx', '1440p': 'Example@Example.fx', '4k+': 'Example@Example.fx',
        [missingColumn]: id === 'performance' ? 'Missing@Missing.fx' : 'Example@Example.fx',
      } }],
    }))
  })
  await expect(publishContent(input, { manifestPath, dryRun: true })).rejects.toThrow(/missing shader: Missing\.fx/i)
})

it('keeps the selected source component when identical file bytes are shared across tiers', async () => {
  const manifestPath = await manifestFile()
  const input = await inputFile(manifestPath, (input) => {
    input.components.push({ name: 'OptiScaler', upstream: 'Test', licence: 'GPL-3.0', source: 'https://github.com/upstream/OptiScaler/tree/v5.0' })
    const other = input.tiers.other
    other.sources[0].component = 'OptiScaler'
    other.recipe = [{ kind: 'copy', file: 'dxgi.dll', to: 'staging.dll' }, { kind: 'rename', from: 'staging.dll', to: 'winmm.dll' }]
    other.entryFiles = [{ path: 'winmm.dll' }]
    other.ownedConfigs = []; other.shippedPresets = []; other.resetKeys = []
    input.tiers.radeon = { ...structuredClone(other), sources: [{ folder: resolve('scripts/fixtures/publish/valid/files'), component: 'ReShade fixture' }], recipe: [{ kind: 'copy', file: 'dxgi.dll', to: 'dxgi.dll' }], entryFiles: [{ path: 'dxgi.dll' }] }
  })
  // Both tiers copy the same dxgi.dll; source files no recipe copies are never uploaded.
  expect((await publishContent(input, { manifestPath, dryRun: true })).uploads).toHaveLength(1)
})

it.each([' ; comment', ' # comment'])('refuses missing preset shaders even with an inline suffix: %s', async (suffix) => {
  const manifestPath = await manifestFile()
  const input = await inputFile(manifestPath, (input) => {
    input.tiers.other.ownedConfigs.push({ path: 'reshade-presets/Example.ini' })
    input.tiers.other.performanceProfiles = (['fidelity', 'balanced', 'performance'] as const).map((id) => ({
      id, label: id, description: id,
      settings: [{ file: 'reshade-presets/Example.ini', section: 'GENERAL', key: 'Techniques', value: `Missing@Missing.fx${suffix}` }],
    }))
  })
  await expect(publishContent(input, { manifestPath, dryRun: true })).rejects.toThrow(/missing shader: Missing\.fx/i)
})
