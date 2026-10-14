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
/** What an update does to a config file the player already has. Absent means `keep`. */
export const CONFIG_UPDATE_RULES = ['keep', 'addMissingKeys', 'replace'] as const
export type ConfigUpdateRule = typeof CONFIG_UPDATE_RULES[number]
export interface ConfigPath extends ConditionalPath { update?: ConfigUpdateRule }
export interface IniKey { file: string; section: string; key: string }
export interface IniSetting extends IniKey { value: string }
export interface ScreenDerivedSetting extends IniKey { value: 'frameCap' | 'peakNits' }
/** Also the order of the HDR choices. */
export const HDR_MODES = ['off', 'hdr', 'scene-hdr'] as const
export type HdrMode = typeof HDR_MODES[number]
export interface HdrOption { id: HdrMode; experimental?: boolean; settings: IniSetting[] }
/** Also the order of the frame-generation choices. */
export const FRAME_GENERATION_IDS = ['off', '2x', '3x', '4x', '5x', '6x', 'dynamic'] as const
export type FrameGenerationId = typeof FRAME_GENERATION_IDS[number]
export interface FrameGenerationOption {
  id: FrameGenerationId
  /** Case-insensitive regular expressions matched against the player's GPU name. */
  gpuNamePatterns?: string[]
  experimental?: boolean
  settings: IniSetting[]
  /** Values that replace these keys when the active display has HDR enabled. */
  hdrSettings?: IniSetting[]
}
/** Also the order of the profile rows and segmented-control options. */
export const PROFILE_IDS = ['ultra', 'fidelity', 'balanced', 'performance'] as const
export type ProfileId = typeof PROFILE_IDS[number]
export const LEGACY_PROFILE_IDS = ['fidelity', 'balanced', 'performance'] as const
export type LegacyProfileId = typeof LEGACY_PROFILE_IDS[number]
/** Fallback for new content when no GPU recommendation matches. */
export const DEFAULT_PROFILE: ProfileId = 'balanced'
/** The 0.1.x `performanceProfiles` field keeps its original default and meaning. */
export const LEGACY_DEFAULT_PROFILE: LegacyProfileId = 'fidelity'
export const RESOLUTION_COLUMNS = ['1080p', '1440p', '4k+'] as const
export type ResolutionColumn = typeof RESOLUTION_COLUMNS[number]
export type ResolutionProfileValue = string | Record<ResolutionColumn, string>
export interface ProfileSetting extends IniKey { value: ResolutionProfileValue }
export interface LegacyPerformanceProfile {
  id: LegacyProfileId
  label: string
  description: string
  settings: IniSetting[]
}
export interface PerformanceProfile {
  id: ProfileId
  label: string
  description: string
  /** Optional short line; resolution-aware content can describe the resolved upscaling mode. */
  summary?: ResolutionProfileValue
  /** Case-insensitive regular expressions matched against the graphics card's name. */
  gpuNamePatterns?: string[]
  settings: ProfileSetting[]
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
  /** The config files, each with the rule an update applies to it; older apps ignore `update`. */
  ownedConfigs: ConfigPath[]
  shippedPresets: ConditionalPath[]
  generatedFiles: ConditionalPath[]
  overlay: 'neural-rendering' | 'upscaling' | null
  /** Legacy 0.1.x profiles: Fidelity, Balanced and Performance with scalar values. */
  performanceProfiles?: LegacyPerformanceProfile[]
  /** Four profiles with resolution-aware values; safely ignored by Lucent 0.1.x. */
  performanceProfilesV2?: PerformanceProfile[]
  /** Optional frame-generation choices; unknown to apps that predate this field. */
  frameGenerationOptions?: FrameGenerationOption[]
  /** Settings computed from XIV's current monitor; unknown to Lucent 0.1.x. */
  screenDerivedSettings?: ScreenDerivedSetting[]
  /** HDR mode choices, absent from older content versions. */
  hdrOptions?: HdrOption[]
}
export interface ContentVersion {
  id: string
  channel: 'stable' | 'beta'
  minAppVersion: string
  changelog: string[]
  /** Exact game versions on which this content is known broken. Advisory only. */
  knownBrokenGameVersions?: string[]
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
function configPaths(value: unknown): ConfigPath[] {
  const rules = array(value, 'Owned configs').map((v) => object(v, 'Owned configs').update)
  return paths(value, 'Owned configs').map((p, i) => {
    const rule = rules[i]
    if (rule === undefined) return p
    if (!CONFIG_UPDATE_RULES.includes(rule as ConfigUpdateRule)) invalid(`Unknown config update rule: ${p.path}`)
    return { ...p, update: rule as ConfigUpdateRule }
  })
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
function screenDerivedSetting(value: unknown): ScreenDerivedSetting {
  const setting = object(value, 'Screen-derived setting')
  if (setting.value !== 'frameCap' && setting.value !== 'peakNits') invalid('Unknown screen-derived value.')
  return { ...iniKey(setting), value: setting.value }
}
function frameGenerationOption(value: unknown): FrameGenerationOption {
  const option = object(value, 'Frame-generation option')
  if (!FRAME_GENERATION_IDS.includes(option.id as FrameGenerationId)) invalid('Unknown frame-generation option id.')
  if (option.experimental !== undefined && typeof option.experimental !== 'boolean') invalid('Frame-generation experimental must be a boolean.')
  let gpuNamePatterns: string[] | undefined
  if (option.gpuNamePatterns !== undefined) {
    gpuNamePatterns = array(option.gpuNamePatterns, 'Frame-generation GPU name patterns').map((value) => {
      const pattern = nonemptyString(value, 'Frame-generation GPU name pattern')
      try { new RegExp(pattern, 'i') } catch { invalid(`Invalid frame-generation GPU name pattern: ${pattern}`) }
      return pattern
    })
    if (!gpuNamePatterns.length) invalid('Frame-generation GPU name patterns cannot be empty.')
  }
  const settings = array(option.settings, 'Frame-generation settings').map((value) => iniSetting(object(value, 'Frame-generation setting')))
  if (!settings.length) invalid('A frame-generation option needs settings.')
  const settingKey = (setting: IniKey) => JSON.stringify([pathKey(setting.file), setting.section.toLowerCase(), setting.key.toLowerCase()])
  unique(settings.map(settingKey), 'Frame-generation setting keys')
  let hdrSettings: IniSetting[] | undefined
  if (option.hdrSettings !== undefined) {
    hdrSettings = array(option.hdrSettings, 'HDR frame-generation settings').map((value) => iniSetting(object(value, 'HDR frame-generation setting')))
    unique(hdrSettings.map(settingKey), 'HDR frame-generation setting keys')
    const baseSettingKeys = new Set(settings.map(settingKey))
    if (hdrSettings.some((setting) => !baseSettingKeys.has(settingKey(setting)))) {
      invalid('HDR frame-generation settings must override keys declared in the normal frame-generation settings.')
    }
  }
  return { id: option.id as FrameGenerationId, ...(gpuNamePatterns ? { gpuNamePatterns } : {}),
    ...(option.experimental !== undefined ? { experimental: option.experimental } : {}), settings,
    ...(hdrSettings !== undefined ? { hdrSettings } : {}) }
}
function hdrOption(value: unknown): HdrOption {
  const option = object(value, 'HDR option')
  if (!(HDR_MODES as readonly string[]).includes(option.id as string)) invalid('Unknown HDR mode.')
  if (option.experimental !== undefined && typeof option.experimental !== 'boolean') invalid('HDR option experimental must be a boolean.')
  const settings = array(option.settings, 'HDR settings').map((setting) => iniSetting(object(setting, 'HDR setting')))
  if (!settings.length) invalid('An HDR option needs settings.')
  unique(settings.map((setting) => JSON.stringify([pathKey(setting.file), setting.section.toLowerCase(), setting.key.toLowerCase()])), 'HDR option keys')
  return { id: option.id as HdrMode, ...(option.experimental === undefined ? {} : { experimental: option.experimental }), settings }
}
function singleLine(value: unknown, field: string): string {
  if (/[\r\n]/.test(nonemptyString(value, field))) invalid(`${field} must be a single line.`)
  return value as string
}
function profile(value: unknown): LegacyPerformanceProfile {
  const p = object(value, 'Performance profile')
  if (!LEGACY_PROFILE_IDS.includes(p.id as LegacyProfileId)) invalid('Unknown legacy performance profile.')
  const settings = array(p.settings, 'Profile settings').map((value) => iniSetting(object(value, 'Profile setting')))
  unique(settings.map((s) => JSON.stringify([pathKey(s.file), s.section.toLowerCase(), s.key.toLowerCase()])), 'Profile keys')
  if (!settings.length) invalid('A performance profile needs settings.')
  return { id: p.id as LegacyProfileId, label: singleLine(p.label, 'Profile label'), description: singleLine(p.description, 'Profile description'), settings }
}
function profileValue(value: unknown): ResolutionProfileValue {
  if (typeof value === 'string') {
    if (/[\r\n\0]/.test(value)) invalid('Profile values must be single-line strings.')
    return value
  }
  const columns = object(value, 'Resolution profile values')
  if (Object.keys(columns).length !== RESOLUTION_COLUMNS.length || RESOLUTION_COLUMNS.some((column) => !(column in columns))) {
    invalid('Resolution profile values need 1080p, 1440p and 4k+ columns.')
  }
  const result = Object.fromEntries(RESOLUTION_COLUMNS.map((column) => {
    const entry = columns[column]
    if (typeof entry !== 'string' || /[\r\n\0]/.test(entry)) invalid('Resolution profile values must be single-line strings.')
    return [column, entry]
  })) as Record<ResolutionColumn, string>
  return result
}
function performanceProfileSetting(value: unknown): ProfileSetting {
  const setting = object(value, 'Profile setting')
  return { ...iniKey(setting), value: profileValue(setting.value) }
}
function performanceProfile(value: unknown): PerformanceProfile {
  const p = object(value, 'Performance profile')
  if (!PROFILE_IDS.includes(p.id as ProfileId)) invalid('Unknown performance profile.')
  const settings = array(p.settings, 'Profile settings').map(performanceProfileSetting)
  unique(settings.map((s) => JSON.stringify([pathKey(s.file), s.section.toLowerCase(), s.key.toLowerCase()])), 'Profile keys')
  if (!settings.length) invalid('A performance profile needs settings.')
  let gpuNamePatterns: string[] | undefined
  if (p.gpuNamePatterns !== undefined) {
    gpuNamePatterns = array(p.gpuNamePatterns, 'Profile GPU-name patterns').map((value) => {
      const pattern = nonemptyString(value, 'Profile GPU-name pattern')
      try { new RegExp(pattern, 'i') } catch { invalid(`Invalid profile GPU-name pattern: ${pattern}`) }
      return pattern
    })
    if (!gpuNamePatterns.length) invalid('Profile GPU-name patterns must not be empty when supplied.')
  }
  const summary = p.summary === undefined ? undefined : profileValue(p.summary)
  return { id: p.id as ProfileId, label: singleLine(p.label, 'Profile label'), description: singleLine(p.description, 'Profile description'),
    ...(summary !== undefined ? { summary } : {}),
    ...(gpuNamePatterns ? { gpuNamePatterns } : {}), settings }
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
    if (!/^content-\d{4}\.\d{2}\.\d{2}(?:-\d+)?$/.test(release)) invalid('Invalid content release tag.')
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
    recipes[id] = { recipe, entryFiles: paths(r.entryFiles, 'Entry files'), ownedConfigs: configPaths(r.ownedConfigs), shippedPresets: paths(r.shippedPresets, 'Shipped presets'), generatedFiles: paths(r.generatedFiles, 'Generated files'), overlay: r.overlay }
    if (r.performanceProfiles !== undefined) {
      const profiles = array(r.performanceProfiles, 'Performance profiles').map(profile)
      unique(profiles.map((p) => p.id), 'Performance profile ids')
      if (profiles.length && profiles.length !== LEGACY_PROFILE_IDS.length) invalid('A legacy tier must offer Fidelity, Balanced and Performance together.')
      recipes[id].performanceProfiles = profiles.sort((a, b) => LEGACY_PROFILE_IDS.indexOf(a.id) - LEGACY_PROFILE_IDS.indexOf(b.id))
    }
    if (r.performanceProfilesV2 !== undefined) {
      const profiles = array(r.performanceProfilesV2, 'Resolution-aware performance profiles').map(performanceProfile)
      unique(profiles.map((p) => p.id), 'Performance profile ids')
      if (profiles.length && profiles.length !== PROFILE_IDS.length) invalid('A resolution-aware tier must offer Ultra, Fidelity, Balanced and Performance together.')
      recipes[id].performanceProfilesV2 = profiles.sort((a, b) => PROFILE_IDS.indexOf(a.id) - PROFILE_IDS.indexOf(b.id))
    }
    if (r.frameGenerationOptions !== undefined) {
      const options = array(r.frameGenerationOptions, 'Frame-generation options').map(frameGenerationOption)
      // Variants may share an id for different GPU models, but two generic or identical variants are ambiguous.
      const variantKeys = options.map((option) => JSON.stringify([option.id, option.gpuNamePatterns?.map((pattern) => pattern.toLowerCase()).sort() ?? null]))
      unique(variantKeys, 'Frame-generation option variants')
      recipes[id].frameGenerationOptions = options
    }
    if (r.screenDerivedSettings !== undefined) {
      const settings = array(r.screenDerivedSettings, 'Screen-derived settings').map(screenDerivedSetting)
      unique(settings.map((s) => JSON.stringify([pathKey(s.file), s.section.toLowerCase(), s.key.toLowerCase()])), 'Screen-derived keys')
      recipes[id].screenDerivedSettings = settings
    }
    if (r.hdrOptions !== undefined) {
      const options = array(r.hdrOptions, 'HDR options').map(hdrOption)
      const modes = options.map((option) => option.id)
      unique(modes, 'HDR option modes')
      if (options.length !== 3 || !(['off', 'hdr', 'scene-hdr'] as const).every((mode) => modes.includes(mode))) {
        invalid('HDR options must include Off, HDR and Scene HDR together.')
      }
      recipes[id].hdrOptions = options
    }
    if (!recipes[id].entryFiles.length) invalid('A tier recipe needs entry files.')
    const ownedConfig = (file: string) => recipes[id].ownedConfigs.find((c) => pathKey(c.path) === pathKey(file)) ?? invalid(`INI settings must target an owned config: ${file}`)
    for (const s of recipe) {
      // A step without a condition would fail to plan whenever its conditional config is excluded.
      if (s.kind === 'ini_set' && ownedConfig(s.file).when !== s.when) invalid('INI steps must use their owned config condition.')
    }
    for (const s of (recipes[id].performanceProfiles ?? []).flatMap((p) => p.settings)) ownedConfig(s.file)
    for (const s of (recipes[id].performanceProfilesV2 ?? []).flatMap((p) => p.settings)) ownedConfig(s.file)
    for (const option of recipes[id].frameGenerationOptions ?? []) {
      for (const setting of [...option.settings, ...(option.hdrSettings ?? [])]) ownedConfig(setting.file)
    }
    for (const s of (recipes[id].screenDerivedSettings ?? [])) ownedConfig(s.file)
    for (const s of (recipes[id].hdrOptions ?? []).flatMap((option) => option.settings)) ownedConfig(s.file)
  }
  const knownBrokenGameVersions = v.knownBrokenGameVersions === undefined ? undefined
    : array(v.knownBrokenGameVersions, 'Known-broken game versions').map((version) => singleLine(version, 'Known-broken game version'))
  if (knownBrokenGameVersions) unique(knownBrokenGameVersions, 'Known-broken game versions')
  return { id, channel: v.channel, minAppVersion, changelog, components, files, tiers: recipes,
    ...(knownBrokenGameVersions ? { knownBrokenGameVersions } : {}) }
}
