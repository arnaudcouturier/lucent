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
  await writeFile(path, await readFile('manifest.json'))
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
  const host = releaseHost().host
  host.listContentReleases = async () => { throw new Error('Dry run contacted GitHub') }
  const result = await publishContent(fixture, { manifestPath, dryRun: true, host })
  expect(result.release).toBe('content-2026.10.12')
  expect(result.uploads).toHaveLength(4)
  expect(result.uploads.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true)
  expect(parseManifest(result.manifestText).versions[0]).toMatchObject({
    id: '2026.10.12', channel: 'stable', changelog: ['Tested fixture content.'],
    tiers: { other: { resetKeys: [{ file: 'ReShade.ini', section: 'GENERAL', key: 'PresetPath' }] } },
  })
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
  const result = await publishContent(fixture, { manifestPath, host: remote.host })
  expect(remote.releases).toMatchObject([{ tag: 'content-2026.10.12', draft: false }])
  expect(remote.releases[0].files).toContainEqual({ sha256: '5570478b4db90c4450004ec383ca2f2861b75de9be30863982d5065dc6d0b54f', size: 22, release: 'content-2026.10.12' })
  expect(await readFile(manifestPath, 'utf8')).toBe(result.manifestText)
  const root = 'C:\\Games\\XIV'
  const platform = createFakePlatform(machine(vanillaGame(root), xivLauncher(root), graphicsCard('Intel Arc A770', 0x8086), { remoteText: { [MANIFEST_URL]: result.manifestText, ...remote.assets } }))
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${root}\\game\\dxgi.dll`)).toBe('Inert ReShade fixture\n')
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState().activity).toMatchObject({ kind: 'deployment', drift: null })
})

it('reuses assets from any published content release, including one absent from the manifest', async () => {
  const manifestPath = await manifestFile()
  const remote = releaseHost()
  remote.releases.push({ id: 1, tag: 'content-2026.10.01', draft: false, files: [{ sha256: '5570478b4db90c4450004ec383ca2f2861b75de9be30863982d5065dc6d0b54f', size: 22, release: 'content-2026.10.01' }] })
  const result = await publishContent(fixture, { manifestPath, host: remote.host })
  expect(result.uploads).toHaveLength(3)
  expect(parseManifest(result.manifestText).versions[0].files).toContainEqual({ sha256: '5570478b4db90c4450004ec383ca2f2861b75de9be30863982d5065dc6d0b54f', size: 22, release: 'content-2026.10.01' })
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
  expect((await publishContent(input, { manifestPath, dryRun: true })).uploads).toHaveLength(4)
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
