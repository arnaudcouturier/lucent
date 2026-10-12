// Shared by the app and the publish tool. No framework or Platform dependencies.
export const MANIFEST_SCHEMA_VERSION = 2

export type TierStatus = 'stable' | 'experimental' | 'community-verified'

export interface GpuMatchRule {
  /** Numeric PCI vendor ID, e.g. 4318 (0x10de) for NVIDIA. */
  vendorId: number
  /** Case-insensitive regular expressions. Any pattern may match the adapter name. */
  deviceNamePatterns: string[]
}

export interface Tier {
  id: string
  label: string
  status: TierStatus
  /** Rules are ORed; within a rule both vendor and name must match. Only the last tier is "any". */
  gpuMatch: GpuMatchRule[] | 'any'
  neuralRendering: boolean
  requiresReShade: boolean
}

export interface Manifest {
  schemaVersion: number
  tiers: Tier[]
  versions: ContentVersion[]
  existingSetups: ExistingSetupSignature[]
}

/**
 * Mod files Lucent did not deploy. Every list holds game-folder patterns: `*` matches within one folder
 * and `**` matches any number of folders. A setup is found when any marker matches a file.
 */
export interface ExistingSetupSignature {
  id: string
  label: string
  markers: string[]
  /** Backed up and removed by the deployment. */
  files: string[]
  /** Copied into Lucent's preset folder as user files. */
  presets: string[]
  /** Left in place, such as its shaders, unless the deployment ships a file at the same path. */
  kept: string[]
}

export interface ContentFile { sha256: string; size: number; release: string }
export interface Component { name: string; upstream: string; licence: string; source: string }
export interface ConditionalPath { path: string; when?: 'reshade' }
export interface IniKey { file: string; section: string; key: string }
export interface IniSetting extends IniKey { value: string }
/** Also the order of the radio rows. */
export const PROFILE_IDS = ['fidelity', 'balanced', 'performance'] as const
export type ProfileId = typeof PROFILE_IDS[number]
export const DEFAULT_PROFILE: ProfileId = 'fidelity'
export interface PerformanceProfile {
  id: ProfileId
  label: string
  description: string
  settings: IniSetting[]
}
export type Step = (
  | { kind: 'copy'; file: string; to: string }
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'delete'; path: string }
  | ({ kind: 'ini_set' } & IniSetting)
) & { when?: 'reshade' }
export interface TierRecipe {
  recipe: Step[]
  entryFiles: ConditionalPath[]
  ownedConfigs: ConditionalPath[]
  shippedPresets: ConditionalPath[]
  generatedFiles: ConditionalPath[]
  overlay: 'neural-rendering' | 'upscaling' | null
  performanceProfiles?: PerformanceProfile[]
  resetKeys?: IniKey[]
}
export interface ContentVersion {
  id: string
  channel: 'stable' | 'beta'
  minAppVersion: string
  changelog: string[]
  components: Component[]
  files: ContentFile[]
  tiers: Record<string, TierRecipe>
}

/** Deliberately rejects Windows aliases, device names and alternate data streams as well as traversal. */
export function assertGamePath(path: string): void {
  const parts = path.replace(/\\/g, '/').split('/')
  if (!path || parts.some((p) => !p || p === '.' || p === '..' || /[<>:"|?*\u0000-\u001f]/.test(p)
    || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(p))) {
    throw new ManifestError('invalid', `Unsafe game-folder path: ${path}`)
  }
}

export class ManifestError extends Error {
  constructor(readonly kind: 'invalid' | 'update-required', message: string, readonly schemaVersion?: number) {
    super(message)
    this.name = 'ManifestError'
  }
}

export function parseManifest(text: string): Manifest {
  let value: unknown
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    invalid('The manifest is not valid JSON.')
  }
  return validateManifest(value)
}

function invalid(message: string): never {
  throw new ManifestError('invalid', message)
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${field} must be an object.`)
  return value as Record<string, unknown>
}

function nonemptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(`${field} must be a nonempty string.`)
  return value
}

function matchRule(value: unknown): GpuMatchRule {
  const rule = object(value, 'GPU match rule')
  if (typeof rule.vendorId !== 'number' || !Number.isInteger(rule.vendorId) || rule.vendorId < 0 || rule.vendorId > 0xffff) {
    invalid('GPU match rule vendorId must be a PCI vendor ID (0–65535).')
  }
  if (!Array.isArray(rule.deviceNamePatterns) || !rule.deviceNamePatterns.length) invalid('GPU match rule needs device-name patterns.')
  const patterns = rule.deviceNamePatterns.map((p) => {
    const pattern = nonemptyString(p, 'Device-name pattern')
    try {
      new RegExp(pattern, 'i')
    } catch {
      invalid(`Invalid device-name pattern: ${pattern}`)
    }
    return pattern
  })
  return { vendorId: rule.vendorId, deviceNamePatterns: patterns }
}

function tier(value: unknown, last: boolean): Tier {
  const t = object(value, 'Tier')
  const id = nonemptyString(t.id, 'Tier id')
  const label = nonemptyString(t.label, 'Tier label')
  if (t.status !== 'stable' && t.status !== 'experimental' && t.status !== 'community-verified') invalid(`Invalid tier status: ${id}`)
  if (typeof t.neuralRendering !== 'boolean' || typeof t.requiresReShade !== 'boolean') invalid(`Tier capabilities must be booleans: ${id}`)
  let gpuMatch: Tier['gpuMatch']
  if (last) {
    if (t.gpuMatch !== 'any') invalid('The last tier must match any GPU.')
    gpuMatch = 'any'
  } else {
    if (!Array.isArray(t.gpuMatch) || !t.gpuMatch.length) invalid(`Tier needs GPU match rules: ${id}`)
    gpuMatch = t.gpuMatch.map(matchRule)
  }
  return { id, label, status: t.status, gpuMatch, neuralRendering: t.neuralRendering, requiresReShade: t.requiresReShade }
}

/** Validates an object too, so the publish tool can validate before serializing. */
export function validateManifest(value: unknown): Manifest {
  const m = object(value, 'Manifest')
  if (typeof m.schemaVersion !== 'number' || !Number.isSafeInteger(m.schemaVersion) || m.schemaVersion < 1) invalid('Invalid manifest schema version.')
  // Read the envelope before the versioned contents. A future schema may change the tier structure.
  if (m.schemaVersion > MANIFEST_SCHEMA_VERSION) {
    throw new ManifestError('update-required', 'This content needs a newer Lucent app. Update Lucent to continue.', m.schemaVersion)
  }
  if (!Array.isArray(m.tiers) || !m.tiers.length) invalid('The manifest needs tiers.')
  const tiers = m.tiers.map((t, i, all) => tier(t, i === all.length - 1))
  if (new Set(tiers.map((t) => t.id)).size !== tiers.length) invalid('Tier ids must be unique.')
  if (m.schemaVersion === 2 && !Array.isArray(m.versions)) invalid('The manifest needs content versions (an empty list is allowed before publishing).')
  const versions = array(m.versions ?? [], 'Content versions').map((v) => contentVersion(v, tiers))
  unique(versions.map((v) => v.id), 'Content version ids')
  const existingSetups = array(m.existingSetups ?? [], 'Existing setups').map(existingSetup)
  unique(existingSetups.map((s) => s.id), 'Existing setup ids')
  return { schemaVersion: m.schemaVersion, tiers, versions, existingSetups }
}

/** Checks a pattern as a game path, with `**` standing for whole folders and `*` for part of a name. */
export function assertGamePattern(pattern: string): void {
  const parts = pattern.replace(/\\/g, '/').split('/')
  if (parts.at(-1) === '**' || parts.some((p) => p.includes('**') && p !== '**')) throw new ManifestError('invalid', `Unsafe game-folder pattern: ${pattern}`)
  assertGamePath(parts.map((p) => p === '**' ? 'x' : p.replace(/\*/g, 'x')).join('/'))
}

function patterns(value: unknown, field: string): string[] {
  return array(value, field).map((v) => {
    const pattern = nonemptyString(v, field)
    assertGamePattern(pattern)
    return pattern
  })
}
function existingSetup(value: unknown): ExistingSetupSignature {
  const s = object(value, 'Existing setup')
  const markers = patterns(s.markers, 'Existing setup markers')
  if (!markers.length) invalid('An existing setup needs markers.')
  return {
    id: nonemptyString(s.id, 'Existing setup id'), label: singleLine(s.label, 'Existing setup label'), markers,
    files: patterns(s.files, 'Existing setup files'), presets: patterns(s.presets, 'Existing setup presets'), kept: patterns(s.kept, 'Existing setup kept files'),
  }
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${field} must be an array.`)
  return value
}
function unique(values: string[], field: string) {
  if (new Set(values).size !== values.length) invalid(`${field} must be unique.`)
}
function condition(v: Record<string, unknown>): { when?: 'reshade' } {
  if (v.when === undefined) return {}
  if (v.when !== 'reshade') invalid('Unknown recipe condition.')
  return { when: 'reshade' }
}
function gamePath(value: unknown): string {
  const path = nonemptyString(value, 'Game-folder path')
  assertGamePath(path)
  return path
}
function paths(value: unknown, field: string): ConditionalPath[] {
  const result = array(value, field).map((v) => {
    const p = object(v, field)
    return { path: gamePath(p.path), ...condition(p) }
  })
  unique(result.map((p) => pathKey(p.path)), field)
  return result
}
const pathKey = (path: string) => path.replace(/\\/g, '/').toLowerCase()
function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid('Files need a lowercase SHA-256.')
  return value
}
function iniKey(value: unknown): IniKey {
  const k = object(value, 'INI key')
  if (typeof k.section !== 'string' || /[\r\n\0\[\]]/.test(k.section) || k.section !== k.section.trim()) invalid('Invalid INI section.')
  const key = nonemptyString(k.key, 'INI key')
  if (/[\r\n\0=;#\[\]]/.test(key) || key !== key.trim()) invalid('Invalid INI key.')
  return { file: gamePath(k.file), section: k.section, key }
}
function iniSetting(s: Record<string, unknown>): IniSetting {
  if (typeof s.value !== 'string' || /[\r\n\0]/.test(s.value)) invalid('INI values must be single-line strings.')
  return { ...iniKey(s), value: s.value }
}
function singleLine(value: unknown, field: string): string {
  if (/[\r\n]/.test(nonemptyString(value, field))) invalid(`${field} must be a single line.`)
  return value as string
}
function profile(value: unknown): PerformanceProfile {
  const p = object(value, 'Performance profile')
  if (!PROFILE_IDS.includes(p.id as ProfileId)) invalid('Unknown performance profile.')
  const settings = array(p.settings, 'Profile settings').map((value) => iniSetting(object(value, 'Profile setting')))
  unique(settings.map((s) => JSON.stringify([pathKey(s.file), s.section.toLowerCase(), s.key.toLowerCase()])), 'Profile keys')
  if (!settings.length) invalid('A performance profile needs settings.')
  return { id: p.id as ProfileId, label: singleLine(p.label, 'Profile label'), description: singleLine(p.description, 'Profile description'), settings }
}
function contentVersion(value: unknown, tiers: Tier[]): ContentVersion {
  const v = object(value, 'Content version')
  const id = nonemptyString(v.id, 'Content version id')
  if (!/^\d{4}\.\d{2}\.\d{2}$/.test(id)) invalid('Content version ids must be YYYY.MM.DD.')
  if (v.channel !== 'stable' && v.channel !== 'beta') invalid('Unknown content channel.')
  const minAppVersion = nonemptyString(v.minAppVersion, 'Minimum app version')
  if (!/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(minAppVersion)) invalid('Invalid minimum app version.')
  const changelog = array(v.changelog, 'Changelog').map((line) => nonemptyString(line, 'Changelog line'))
  const components = array(v.components, 'Components').map((value) => {
    const c = object(value, 'Component')
    const source = nonemptyString(c.source, 'Component source link')
    if (!/^https:\/\//.test(source)) invalid('Component source links must use HTTPS.')
    return { name: nonemptyString(c.name, 'Component name'), upstream: nonemptyString(c.upstream, 'Upstream'), licence: nonemptyString(c.licence, 'Licence'), source }
  })
  const files = array(v.files, 'Files').map((value) => {
    const f = object(value, 'File')
    if (typeof f.size !== 'number' || !Number.isSafeInteger(f.size) || f.size < 0) invalid('File sizes must be nonnegative integers.')
    const release = nonemptyString(f.release, 'Content release')
    if (!/^content-\d{4}\.\d{2}\.\d{2}$/.test(release)) invalid('Invalid content release tag.')
    return { sha256: hash(f.sha256), size: f.size, release }
  })
  unique(files.map((f) => f.sha256), 'File hashes')
  const recipes: Record<string, TierRecipe> = Object.create(null)
  for (const [id, value] of Object.entries(object(v.tiers, 'Content tiers'))) {
    if (!tiers.some((t) => t.id === id)) invalid(`Unknown content tier: ${id}`)
    const r = object(value, 'Tier recipe')
    const recipe = array(r.recipe, 'Recipe').map((value): Step => {
      const s = object(value, 'Step')
      const when = condition(s)
      if (s.kind === 'copy') {
        const file = hash(s.file)
        if (!files.some((f) => f.sha256 === file)) invalid(`Recipe references an unknown file: ${file}`)
        return { kind: 'copy', file, to: gamePath(s.to), ...when }
      }
      if (s.kind === 'rename') return { kind: 'rename', from: gamePath(s.from), to: gamePath(s.to), ...when }
      if (s.kind === 'delete') return { kind: 'delete', path: gamePath(s.path), ...when }
      if (s.kind === 'ini_set') return { kind: 'ini_set', ...iniSetting(s), ...when }
      return invalid('Unknown recipe step.')
    })
    if (!recipe.length) invalid('A tier recipe must contain steps.')
    if (r.overlay !== null && r.overlay !== 'neural-rendering' && r.overlay !== 'upscaling') invalid('Unknown overlay hint.')
    recipes[id] = { recipe, entryFiles: paths(r.entryFiles, 'Entry files'), ownedConfigs: paths(r.ownedConfigs, 'Owned configs'), shippedPresets: paths(r.shippedPresets, 'Shipped presets'), generatedFiles: paths(r.generatedFiles, 'Generated files'), overlay: r.overlay }
    if (r.performanceProfiles !== undefined) {
      const profiles = array(r.performanceProfiles, 'Performance profiles').map(profile)
      unique(profiles.map((p) => p.id), 'Performance profile ids')
      if (profiles.length && profiles.length !== PROFILE_IDS.length) invalid('A tier must offer Fidelity, Balanced and Performance together.')
      recipes[id].performanceProfiles = profiles.sort((a, b) => PROFILE_IDS.indexOf(a.id) - PROFILE_IDS.indexOf(b.id))
    }
    if (r.resetKeys !== undefined) recipes[id].resetKeys = array(r.resetKeys, 'Reset keys').map(iniKey)
    if (!recipes[id].entryFiles.length) invalid('A tier recipe needs entry files.')
    const ownedConfig = (file: string) => recipes[id].ownedConfigs.find((c) => pathKey(c.path) === pathKey(file)) ?? invalid(`INI settings must target an owned config: ${file}`)
    for (const s of recipe) {
      // A step without a condition would fail to plan whenever its conditional config is excluded.
      if (s.kind === 'ini_set' && ownedConfig(s.file).when !== s.when) invalid('INI steps must use their owned config condition.')
    }
    for (const s of (recipes[id].performanceProfiles ?? []).flatMap((p) => p.settings)) ownedConfig(s.file)
  }
  return { id, channel: v.channel, minAppVersion, changelog, components, files, tiers: recipes }
}
