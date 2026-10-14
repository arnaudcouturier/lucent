import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream, createWriteStream } from 'node:fs'
import { access, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { assertGamePath, parseManifest, RESOLUTION_COLUMNS, validateManifest, type Component, type ContentFile, type ContentVersion, type IniSetting, type Manifest, type Step, type TierRecipe } from '../src/shared/manifest'
import { fileKey, planDeployment } from '../src/core/planner'
import { runCommand } from './command'
import { activeEffects, unusedShaderFiles } from './shader-usage'

type ContentSource = ({ folder: string; archive?: never } | { archive: string; folder?: never }) & {
  component: string; to?: string; subdirectory?: string; when?: 'reshade'
}
interface PublishTier extends Omit<TierRecipe, 'recipe'> {
  sources: ContentSource[]
  /** Copy file identifiers are paths in the combined source folders, rather than hashes. */
  recipe?: Step[]
  /**
   * `used` (the default) ships only the shaders the presets turn on, with their includes and textures; `all` ships
   * every shader and texture in the sources. Ignored with an explicit `recipe`.
   */
  shaders?: 'used' | 'all'
}
export interface PublishInput extends Omit<ContentVersion, 'files' | 'tiers'> {
  knownUserShaders?: string[]
  tiers: Record<string, PublishTier>
}
export interface StagedFile extends ContentFile { stagedPath: string }
export interface ContentRelease { id: number; tag: string; draft: boolean; files: ContentFile[] }
/** GitHub is the only remote boundary; tests publish to an in-memory release host. */
export interface PublishHost {
  listContentReleases(): Promise<ContentRelease[]>
  createDraft(tag: string, content: ContentVersion): Promise<number>
  upload(id: number, file: StagedFile): Promise<void>
  publish(id: number): Promise<void>
}
export interface PublishResult {
  release: string
  uploads: ContentFile[]
  manifestText: string
}
export interface PublishOptions { manifestPath: string; dryRun?: boolean; dryRunFilesDirectory?: string; host?: PublishHost; sevenZip?: string }

/** Local validation and an offline preview use exactly the manifest consumed by the app. */
export async function publishContent(inputPath: string, options: PublishOptions): Promise<PublishResult> {
  const scratch = await mkdtemp(join(tmpdir(), 'lucent-publish-'))
  try {
    const original = await readFile(options.manifestPath, 'utf8')
    const manifest = parseManifest(original)
    const input: PublishInput = JSON.parse((await readFile(inputPath, 'utf8')).replace(/^\uFEFF/, ''))
    if (options.dryRunFilesDirectory && !options.dryRun) throw new Error('Local dry-run files can only be materialized in dry-run mode.')
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(input.id) || new Date(`${input.id.replace(/\./g, '-')}T00:00:00Z`).toISOString().slice(0, 10) !== input.id.replace(/\./g, '-')) throw new Error('Content version must be a real date in YYYY.MM.DD form.')
    if (!Object.keys(input.tiers).length) throw new Error('Content needs at least one tested tier.')
    if (new Set(input.components.map((c) => c.name)).size !== input.components.length) throw new Error('Component names must be unique.')
    if (manifest.versions.some((v) => v.id === input.id)) throw new Error(`Content version ${input.id} already exists.`)
    const release = `content-${input.id}`
    const knownUserShaders = new Set((input.knownUserShaders ?? []).map((path) => { assertGamePath(path); return shaderKey(path) }))
    const userShader = (path: string) => knownUserShaders.has(shaderKey(path)) || knownUserShaders.has(fileKey(path).split('/').at(-1)!)
    const staged = new Map<string, StagedFile>()
    const copyComponents = new Map<string, Map<number, Component>>()
    const shaders = new Map<string, string>()
    const tiers: Record<string, TierRecipe> = Object.create(null)
    const published = new Map(manifest.versions.flatMap((v) => v.files.map((f) => [f.sha256, f] as const)))
    for (const [tierId, tier] of Object.entries(input.tiers)) {
      for (const step of tier.recipe ?? []) {
        const paths = step.kind === 'copy' ? [step.to] : step.kind === 'rename' ? [step.from, step.to]
          : step.kind === 'delete' ? [step.path] : [step.file]
        for (const path of paths) {
          if (userShader(path)) throw new Error(`Recipe must not touch user-supplied shader: ${path}`)
        }
      }
      const files = new Map<string, { path: string; hash: string; component: Component; when?: 'reshade' }>()
      for (const source of tier.sources) {
        const component = input.components.find((c) => c.name === source.component)
        if (!component) throw new Error(`Unknown component: ${source.component}`)
        const root = await sourceFolder(source, dirname(inputPath), scratch, options.sevenZip)
        for (const relative of await folderFiles(root)) {
          const path = source.to ? `${source.to}/${relative}` : relative
          assertGamePath(path)
          // A tested folder may contain the player's paid effects; declaring them never publishes their bytes.
          if (userShader(path)) continue
          assertOptiScalerSource(path, component)
          const file = await stageFile(join(root, relative), scratch, release)
          if (file.size === 0) throw new Error(`Source file ${path} is empty; GitHub release assets must be at least 1 byte, so an empty file cannot be published. Give the file content or remove it from the source folder.`)
          assertShader(path, file.sha256, shaders)
          staged.set(file.sha256, file)
          files.set(fileKey(path), { path, hash: file.sha256, component, when: source.when })
        }
      }
      if (!tier.recipe && tier.shaders !== 'all') {
        const unused = await unusedShaderFiles([...files.values()].map((f) => ({ path: f.path, read: () => readFile(staged.get(f.hash)!.stagedPath, 'utf8') })))
        for (const path of unused) files.delete(fileKey(path))
      }
      const components = new Map<number, Component>()
      copyComponents.set(tierId, components)
      const recipe: Step[] = tier.recipe ? tier.recipe.map((step, index) => {
        if (step.kind !== 'copy') return step
        const file = files.get(fileKey(step.file))
        if (!file) throw new Error(`Recipe source file is missing: ${step.file}`)
        assertOptiScalerSource(step.to, file.component)
        components.set(index, file.component)
        const when = step.when ?? file.when
        return { ...step, file: file.hash, ...(when ? { when } : {}) }
      }) : [...files.values()].map((f, index) => {
        components.set(index, f.component)
        return { kind: 'copy', file: f.hash, to: f.path, ...(f.when ? { when: f.when } : {}) }
      })
      tiers[tierId] = {
        recipe, entryFiles: tier.entryFiles, ownedConfigs: tier.ownedConfigs, shippedPresets: tier.shippedPresets,
        generatedFiles: tier.generatedFiles, overlay: tier.overlay, performanceProfiles: tier.performanceProfiles,
        performanceProfilesV2: tier.performanceProfilesV2, frameGenerationOptions: tier.frameGenerationOptions,
        screenDerivedSettings: tier.screenDerivedSettings, hdrOptions: tier.hdrOptions, resetKeys: tier.resetKeys,
      }
    }
    // Only what a recipe copies is published; a source file no tier deploys is never uploaded.
    const copied = new Set(Object.values(tiers).flatMap((t) => t.recipe.flatMap((step) => step.kind === 'copy' ? [step.file] : [])))
    const files: ContentFile[] = [...staged.values()].filter((f) => copied.has(f.sha256)).sort((a, b) => a.sha256.localeCompare(b.sha256)).map(({ sha256, size }) => {
      const old = published.get(sha256)
      if (old && old.size !== size) throw new Error(`Published size differs for ${sha256}.`)
      return { sha256, size, release: old?.release ?? release }
    })
    const content: ContentVersion = {
      id: input.id, channel: input.channel, minAppVersion: input.minAppVersion, changelog: input.changelog,
      knownBrokenGameVersions: input.knownBrokenGameVersions, components: input.components, files, tiers,
    }
    const next = validateManifest({ ...manifest, versions: [...manifest.versions, content] })
    for (const tier of next.tiers) {
      if (!content.tiers[tier.id]) continue
      const recipe = next.versions.at(-1)!.tiers[tier.id]
      for (const key of recipe.resetKeys ?? []) {
        if (!recipe.ownedConfigs.some((p) => fileKey(p.path) === fileKey(key.file))) throw new Error(`Reset key must target an owned config: ${key.file}`)
      }
      for (const includeReShade of tier.requiresReShade ? [true] : [true, false]) {
        const plan = planDeployment(content, tier, includeReShade, { files: [], ownedFiles: [], cachedFiles: [] })
        const deployed = new Map<string, { hash: string; component: Component; settings: IniSetting[] }>()
        for (const [index, step] of recipe.recipe.entries()) {
          if (step.when && !includeReShade) continue
          if (step.kind === 'copy') {
            assertShader(step.to, step.file, shaders)
            deployed.set(fileKey(step.to), { hash: step.file, component: copyComponents.get(tier.id)!.get(index)!, settings: [] })
          }
          else if (step.kind === 'rename') {
            const file = deployed.get(fileKey(step.from))!
            assertOptiScalerSource(step.to, file.component)
            assertShader(step.to, file.hash, shaders)
            deployed.set(fileKey(step.to), file)
            deployed.delete(fileKey(step.from))
          } else if (step.kind === 'delete') deployed.delete(fileKey(step.path))
          else {
            // Config steps retain their source bytes for preset validation after INI edits.
            const setting = step as IniSetting
            deployed.get(fileKey(setting.file))!.settings.push(setting)
          }
        }
        for (const file of plan.expectedFiles) {
          if (userShader(file.path)) throw new Error(`Recipe must not write user-supplied shader: ${file.path}`)
        }
        const available = new Set(knownUserShaders)
        for (const f of plan.expectedFiles.filter((f) => /\.fx$/i.test(f.path))) {
          available.add(shaderKey(f.path))
          available.add(fileKey(f.path).split('/').at(-1)!)
        }
        for (const f of plan.expectedFiles.filter((f) => /\.ini$/i.test(f.path) && (fileKey(f.path).startsWith('reshade-presets/') || plan.recipe.shippedPresets.some((p) => fileKey(p.path) === fileKey(f.path))))) {
          const file = deployed.get(fileKey(f.path))!
          const text = await readFile(staged.get(file.hash)!.stagedPath, 'utf8')
          const profileScenarios: IniSetting[][] = recipe.performanceProfilesV2 !== undefined
            ? recipe.performanceProfilesV2.length
              ? recipe.performanceProfilesV2.flatMap((profile) => RESOLUTION_COLUMNS.map((column) => profile.settings.map((setting) => ({
                ...setting, value: typeof setting.value === 'string' ? setting.value : setting.value[column],
              }))))
              : [[]]
            : recipe.performanceProfiles?.length ? recipe.performanceProfiles.map((profile) => profile.settings) : [[]]
          for (const profileSettings of profileScenarios) {
            const settings = [...file.settings, ...profileSettings.filter((s) => fileKey(s.file) === fileKey(f.path))]
            for (const shader of presetShaders(text, settings)) {
              if (!available.has(shaderKey(shader))) throw new Error(`Preset ${f.path} references missing shader: ${shader} (${tier.id})`)
            }
          }
        }
      }
    }
    // GitHub allows at most 1,000 assets per release, so a large content
    // version spans the main release plus numbered overflow releases. The
    // manifest already records which release holds each file.
    const MAX_ASSETS_PER_RELEASE = 1000
    const spanReleases = (uploads: ContentFile[]) => {
      // Even a recipe-only version needs its own immutable date and release notes.
      const groups = new Map<string, ContentFile[]>([[release, []]])
      uploads.forEach((file, index) => {
        const tag = index < MAX_ASSETS_PER_RELEASE ? release : `${release}-${Math.floor(index / MAX_ASSETS_PER_RELEASE) + 1}`
        file.release = tag
        groups.set(tag, [...(groups.get(tag) ?? []), file])
      })
      return groups
    }
    let uploads = next.versions.at(-1)!.files.filter((f) => f.release === release)
    if (options.dryRun) spanReleases(uploads)
    if (options.dryRunFilesDirectory) {
      await mkdir(options.dryRunFilesDirectory, { recursive: true })
      for (const file of next.versions.at(-1)!.files) {
        const source = staged.get(file.sha256)
        if (!source || source.size !== file.size) throw new Error(`Local dry-run asset was not staged: ${file.sha256}`)
        const destination = join(options.dryRunFilesDirectory, file.sha256)
        try { await copyFile(source.stagedPath, destination, constants.COPYFILE_EXCL) }
        catch (error) {
          if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error
          const existing = await readFile(destination)
          if (existing.length !== file.size || createHash('sha256').update(existing).digest('hex') !== file.sha256) {
            throw new Error(`Local dry-run asset already exists with different bytes: ${destination}`)
          }
        }
      }
    }
    if (!options.dryRun) {
      const host = options.host
      if (!host) throw new Error('A GitHub release host is required to publish.')
      const releases = await host.listContentReleases()
      if (releases.some((r) => r.tag === release)) throw new Error(`Release ${release} already exists; content versions are immutable.`)
      const remoteFiles = releases.filter((r) => !r.draft).flatMap((r) => r.files)
      const version = next.versions.at(-1)!
      for (const file of version.files) {
        const matching = remoteFiles.filter((f) => f.sha256 === file.sha256)
        if (matching.some((f) => f.size !== file.size)) throw new Error(`Published size differs for ${file.sha256}.`)
        file.release = matching.find((f) => f.release === file.release)?.release ?? matching[0]?.release ?? release
      }
      uploads = version.files.filter((f) => f.release === release)
      const groups = spanReleases(uploads)
      for (const tag of groups.keys()) {
        if (tag !== release && releases.some((r) => r.tag === tag)) throw new Error(`Release ${tag} already exists; content versions are immutable.`)
      }
      await assertManifestUnchanged(options.manifestPath, original)
      const drafts = new Map<string, number>()
      for (const [tag, group] of groups) {
        const id = await host.createDraft(tag, version)
        drafts.set(tag, id)
        for (const file of group) await host.upload(id, staged.get(file.sha256)!)
      }
      await assertManifestUnchanged(options.manifestPath, original)
      for (const id of drafts.values()) await host.publish(id)
      await assertManifestUnchanged(options.manifestPath, original)
      await replaceManifest(options.manifestPath, serialize(next))
    }
    const manifestText = serialize(next)
    return { release, uploads, manifestText }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

async function folderFiles(root: string, prefix = ''): Promise<string[]> {
  if ((await lstat(root)).isSymbolicLink()) throw new Error(`Source links are not supported: ${root}`)
  const result: string[] = []
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) throw new Error(`Source links are not supported: ${path}`)
    if (entry.isDirectory()) result.push(...await folderFiles(join(root, entry.name), path))
    else if (entry.isFile()) result.push(path)
    else throw new Error(`Unsupported source file: ${path}`)
  }
  return result
}

async function sourceFolder(source: ContentSource, base: string, scratch: string, executable?: string): Promise<string> {
  if (!!source.folder === !!source.archive) throw new Error('Each source must specify exactly one folder or archive.')
  if (source.when !== undefined && source.when !== 'reshade') throw new Error('Unknown source condition.')
  let root: string
  if (source.folder) root = resolve(base, source.folder)
  else {
    const archive = resolve(base, source.archive!)
    const sevenZip = executable ?? await findSevenZip()
    const listing = await runCommand(sevenZip, ['l', '-slt', '--', archive])
    const entries = listing.slice(listing.indexOf('----------') + '----------'.length).trim().split(/\r?\n\r?\n/)
    for (const entry of entries) {
      const path = /^Path = (.+)$/m.exec(entry)?.[1].trim()
      if (!path) throw new Error('7-Zip returned an unreadable archive listing.')
      assertGamePath(path)
      if (/^(Symbolic Link|Hard Link) = .+/m.test(entry) || /^Attributes = .*\bl/m.test(entry)) throw new Error(`Archive links are not supported: ${path}`)
    }
    root = await mkdtemp(join(scratch, 'archive-'))
    await runCommand(sevenZip, ['x', '-y', `-o${root}`, '--', archive])
  }
  if (source.subdirectory) { assertGamePath(source.subdirectory); root = join(root, source.subdirectory) }
  return root
}

async function findSevenZip(): Promise<string> {
  if (process.platform === 'win32') {
    const path = join(process.env.ProgramFiles ?? 'C:\\Program Files', '7-Zip', '7z.exe')
    try { await access(path); return path } catch { /* Fall back to PATH. */ }
  }
  return '7z'
}

async function stageFile(source: string, directory: string, release: string): Promise<StagedFile> {
  const temporary = join(directory, 'staging')
  const hash = createHash('sha256')
  let size = 0
  const input = createReadStream(source)
  input.on('data', (chunk) => { hash.update(chunk); size += chunk.length })
  await pipeline(input, createWriteStream(temporary))
  const sha256 = hash.digest('hex')
  const stagedPath = join(directory, sha256)
  await rename(temporary, stagedPath)
  return { sha256, size, release, stagedPath }
}

const serialize = (manifest: Manifest) => `${JSON.stringify(manifest, null, 2)}\n`

async function assertManifestUnchanged(path: string, original: string) {
  if (await readFile(path, 'utf8') !== original) throw new Error('The manifest changed during publication; it was not overwritten.')
}

async function replaceManifest(path: string, text: string) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, text, { flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

function assertOptiScalerSource(path: string, component: Component) {
  // Vendor runtimes are shipped in OptiScaler's directory but keep their own
  // provenance and licences. Enforce the pinned GPL source only for files
  // actually named as OptiScaler or the proxy entry point, not every file
  // beneath an `OptiScaler/` source folder.
  const filename = fileKey(path).split('/').at(-1)!
  if (!/(?:optiscaler|winmm\.dll)/i.test(filename)) return
  const tag = /^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:tree|releases\/tag)\/([^?#]+)$/.exec(component.source)
  if (!/^GPL-3\.0(?:-only|-or-later)?$/i.test(component.licence) || !tag || /^(main|master|HEAD|dev|develop)$/i.test(tag[1])) {
    throw new Error(`OptiScaler file ${path} needs a GPL source tag (component ${component.name}).`)
  }
}

function assertShader(path: string, hash: string, shaders: Map<string, string>) {
  if (!/\.(fx|fxh)$/i.test(path)) return
  const previous = shaders.get(fileKey(path))
  if (previous && previous !== hash) throw new Error(`Shader path collision: ${path}`)
  shaders.set(fileKey(path), hash)
}

function shaderKey(path: string) {
  const key = fileKey(path.trim())
  const index = key.indexOf('/shaders/')
  return index < 0 ? key : key.slice(index + '/shaders/'.length)
}

/** The effects a preset turns on, after the INI edits the content applies to it. */
function presetShaders(text: string, settings: IniSetting[]): string[] {
  const edits = settings.filter((s) => s.key.trim().toLowerCase() === 'techniques').map((s) => `Techniques=${presetValue(s.value)}`)
  return activeEffects(edits.length ? edits.join('\n') : text)
}

function presetValue(value: string): string {
  let quote = ''
  for (let i = 0; i < value.length; i++) {
    const character = value[i]
    if (character === '"' || character === "'") quote = quote === character ? '' : quote || character
    if (!quote && /[;#]/.test(character) && i > 0 && /\s/.test(value[i - 1])) return value.slice(0, i).trim()
  }
  return value.trim()
}
