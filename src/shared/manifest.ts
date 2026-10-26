// Shared by the app and the publish tool. No framework or Platform dependencies.
import { StarterSetError, validateStarterSet, type StarterSet } from './starterSet'
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
  /** The Mods section's plugins and mods; absent from older manifests, and unknown to apps before the Mods section. */
  starterSet?: StarterSet
  /**
   * Why a `starterSet` in the document was dropped. The set is edited by hand and a typo in it must not take DLSS deploys
   * down with it, so it is validated apart from the rest; the publish tool refuses to rewrite a manifest that has this.
   */
  starterSetError?: string
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
/**
 * A key an update sets in a config the player already has, whatever their value, while the rest of the file stays. With `ifPath`
 * it sets the key only when its current value is that path (compared as a path: case, slashes and a leading `.\` don't matter).
 */
export interface ConfigKeySetting { section: string; key: string; value: string; ifPath?: string }
/** `setKeys` apply with `keep` and `addMissingKeys`, once per key: an update to a version that carries a key the deployed version already carried leaves it alone. Older apps ignore them. */
export interface ConfigPath extends ConditionalPath { update?: ConfigUpdateRule; setKeys?: ConfigKeySetting[] }
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
/** What keeps an option from being picked: an earlier choice holding one of the named options, or HDR being on. */
export interface SettingChoiceBlock {
  /** Shown under the control while the option is unavailable. */
  reason: string
  /** Unavailable while this earlier choice of the tier holds one of these options. */
  choice?: { id: string; options: string[] }
  /** Unavailable while the HDR choice is anything but Off. */
  hdr?: true
}
export interface SettingChoiceOption {
  id: string
  label: string
  /** The line under the control while this option is picked. */
  description: string
  experimental?: boolean
  settings: IniSetting[]
  blockedWhen?: SettingChoiceBlock[]
}
/**
 * Where the Graphics step shows a choice that doesn't get a card of its own: inside the Neural Rendering card. Choices that name the
 * same `group` share one collapsed disclosure under that title, with the first one's `note` under it; none names no disclosure.
 */
export interface SettingChoicePlacement { in: 'neural-rendering'; group?: string; note?: string }
/**
 * A first-install choice whose options each write a set of ini keys, such as the DLSS-G render preset. Choices are listed in the
 * order they appear, and an option may only be blocked by a choice above it. Unknown to apps that predate this field, which ignore it.
 */
export interface SettingChoice {
  id: string
  label: string
  /** Case-insensitive regular expressions matched against the card's name; absent offers the choice to every card. */
  gpuNamePatterns?: string[]
  /** Offered only while frame generation is on. */
  needsFrameGeneration?: boolean
  /** Shown only while the Neural Rendering passes are at least this many; the pick is written either way, as with frame generation Off. */
  minPasses?: 2 | 3
  /** Absent: a card of its own. */
  placement?: SettingChoicePlacement
  options: SettingChoiceOption[]
  defaultOption: string
  /** The option whose settings are written for a card the choice isn't offered to; absent writes nothing for it. */
  unofferedOption?: string
}
/** Also the order of the profile rows and segmented-control options. */
export const PROFILE_IDS =['ultra', 'fidelity', 'balanced', 'performance'] as const
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
/** The DLSS presets OptiScaler can force on the game, in the order the choices are listed. */
export const NR_PRESET_IDS = ['dlaa', 'ultra-quality', 'quality', 'balanced', 'performance', 'ultra-performance'] as const
export type NrPresetId = typeof NR_PRESET_IDS[number]
/** What fraction of the frame Neural Rendering works at, in percent. Above 100 the model supersamples. */
export const NR_SCALES = [75, 100, 125] as const
export type NrScale = typeof NR_SCALES[number]
export const NR_PASSES = [1, 2, 3] as const
export type NrPasses = typeof NR_PASSES[number]
/** One DLSS preset: its upscaling ratio and the value `ForcePerfQuality` takes. */
export interface NrPresetOption { id: NrPresetId; label: string; ratio: number; value: string }
export interface NrToggle { key: IniKey; label: string; description: string; experimental?: boolean }
export interface NrDefault {
  /** Case-insensitive regular expressions matched against the graphics card's name. The last default has none. */
  gpuNamePatterns?: string[]
  preset: NrPresetId
  passes: NrPasses
}
/** The player's Neural Rendering picks. */
export interface NeuralRenderingChoice {
  preset: NrPresetId
  passes: NrPasses
  scale: NrScale
  spatialCompression: boolean
  residualFg: boolean
}
/** The Neural Rendering controls a tier offers, replacing the performance profiles. */
export interface NeuralRenderingControls {
  presetKey: IniKey
  presets: NrPresetOption[]
  passesKey: IniKey
  scaleKey: IniKey
  spatialCompression: NrToggle
  /** Only offered on these cards, and only with frame generation on. */
  residualFg: NrToggle & { gpuNamePatterns: string[] }
  /** The first default whose patterns match the card applies; the last one matches every card. */
  defaults: NrDefault[]
}
/** A separate switch for the experimental multi-frame generation unlock. */
export interface MfgUnlock {
  gpuNamePatterns: string[]
  label: string
  description: string
  /** Frame-generation modes that only work with the unlock on. */
  gates: FrameGenerationId[]
  /** Written after the frame-generation settings when the unlock is on. */
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
  /** The config files, each with the rule an update applies to it; older apps ignore `update`. */
  ownedConfigs: ConfigPath[]
  shippedPresets: ConditionalPath[]
  generatedFiles: ConditionalPath[]
  overlay: 'neural-rendering' | 'upscaling' | null
  /** Legacy 0.1.x profiles: Fidelity, Balanced and Performance with scalar values. */
  performanceProfiles?: LegacyPerformanceProfile[]
  /** Four profiles with resolution-aware values; safely ignored by Lucent 0.1.x. */
  performanceProfilesV2?: PerformanceProfile[]
  /** Specific Neural Rendering controls in place of profiles; unknown to apps before 0.3.0. */
  neuralRenderingControls?: NeuralRenderingControls
  /** The experimental multi-frame generation unlock, offered as its own switch. */
  mfgUnlock?: MfgUnlock
  /** Optional frame-generation choices; unknown to apps that predate this field. */
  frameGenerationOptions?: FrameGenerationOption[]
  /** Settings computed from XIV's current monitor; unknown to Lucent 0.1.x. */
  screenDerivedSettings?: ScreenDerivedSetting[]
  /** HDR mode choices, absent from older content versions. */
  hdrOptions?: HdrOption[]
  /** Further first-install choices, such as the DLSS-G render preset; apps that predate this field ignore it. */
  settingChoices?: SettingChoice[]
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
  return { schemaVersion: m.schemaVersion, tiers, versions, existingSetups, ...starterSetField(m.starterSet) }
}

/** The Starter set is optional, and a bad one is reported on the manifest instead of invalidating it. */
function starterSetField(value: unknown): Pick<Manifest, 'starterSet' | 'starterSetError'> {
  if (value === undefined) return {}
  try { return { starterSet: validateStarterSet(value) } }
  catch (error) {
    if (error instanceof StarterSetError) return { starterSetError: error.message }
    throw error
  }
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
  const entries = array(value, 'Owned configs').map((v) => object(v, 'Owned configs'))
  return paths(value, 'Owned configs').map((p, i) => {
    const { update: rule, setKeys } = entries[i]
    const config: ConfigPath = { ...p }
    if (rule !== undefined) {
      if (!CONFIG_UPDATE_RULES.includes(rule as ConfigUpdateRule)) invalid(`Unknown config update rule: ${p.path}`)
      config.update = rule as ConfigUpdateRule
    }
    if (setKeys !== undefined) {
      const keys = configKeySettings(setKeys)
      if (keys.length) config.setKeys = keys
    }
    return config
  })
}
function configKeySettings(value: unknown): ConfigKeySetting[] {
  const list = array(value, 'Config keys')
  if (list.length > 64) invalid('A config may set at most 64 keys on update.')
  const keys = list.map((v): ConfigKeySetting => {
    const s = object(v, 'Config key')
    if (typeof s.value !== 'string' || /[\r\n\0]/.test(s.value)) invalid('INI values must be single-line strings.')
    if (s.ifPath !== undefined && (typeof s.ifPath !== 'string' || !s.ifPath.trim() || /[\r\n\0]/.test(s.ifPath))) invalid('ifPath must be a single-line path.')
    return { ...iniSectionKey(s), value: s.value, ...(s.ifPath === undefined ? {} : { ifPath: s.ifPath as string }) }
  })
  unique(keys.map((k) => `${k.section}\0${k.key}\0${k.ifPath ?? ''}`.toLowerCase()), 'Config keys')
  return keys
}
function iniSectionKey(k: Record<string, unknown>): { section: string; key: string } {
  if (typeof k.section !== 'string' || /[\r\n\0\[\]]/.test(k.section) || k.section !== k.section.trim()) invalid('Invalid INI section.')
  const key = nonemptyString(k.key, 'INI key')
  if (/[\r\n\0=;#\[\]]/.test(key) || key !== key.trim()) invalid('Invalid INI key.')
  return { section: k.section, key }
}
function iniKey(value: unknown): IniKey {
  const k = object(value, 'INI key')
  const { section, key } = iniSectionKey(k)
  return { file: gamePath(k.file), section, key }
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
const CHOICE_ID = /^[a-z][a-z0-9-]*$/
const iniKeyId = (setting: IniKey) => JSON.stringify([pathKey(setting.file), setting.section.toLowerCase(), setting.key.toLowerCase()])
function settingChoiceBlock(value: unknown): SettingChoiceBlock {
  const block = object(value, 'Choice block')
  const reason = singleLine(block.reason, 'Choice block reason')
  let choice: SettingChoiceBlock['choice']
  if (block.choice !== undefined) {
    const target = object(block.choice, 'Choice block target')
    const options = array(target.options, 'Choice block options').map((option) => nonemptyString(option, 'Choice block option'))
    if (!options.length) invalid('A choice block must name at least one option.')
    choice = { id: nonemptyString(target.id, 'Choice block choice'), options }
  }
  if (block.hdr !== undefined && block.hdr !== true) invalid('A choice block hdr condition must be true.')
  if (!choice && block.hdr === undefined) invalid('A choice block needs a condition.')
  return { reason, ...(choice ? { choice } : {}), ...(block.hdr === true ? { hdr: true as const } : {}) }
}
function settingChoiceOption(value: unknown): SettingChoiceOption {
  const option = object(value, 'Choice option')
  const id = nonemptyString(option.id, 'Choice option id')
  if (!CHOICE_ID.test(id)) invalid('Choice option ids use lowercase letters, digits and hyphens.')
  if (option.experimental !== undefined && typeof option.experimental !== 'boolean') invalid('Choice option experimental must be a boolean.')
  const settings = array(option.settings, 'Choice option settings').map((setting) => iniSetting(object(setting, 'Choice option setting')))
  if (!settings.length) invalid('A choice option needs settings.')
  unique(settings.map(iniKeyId), 'Choice option setting keys')
  const blockedWhen = option.blockedWhen === undefined ? undefined : array(option.blockedWhen, 'Choice option blocks').map(settingChoiceBlock)
  return { id, label: singleLine(option.label, 'Choice option label'), description: singleLine(option.description, 'Choice option description'),
    ...(option.experimental === undefined ? {} : { experimental: option.experimental }), settings, ...(blockedWhen?.length ? { blockedWhen } : {}) }
}
function settingChoice(value: unknown): SettingChoice {
  const choice = object(value, 'Setting choice')
  const id = nonemptyString(choice.id, 'Setting choice id')
  if (!CHOICE_ID.test(id)) invalid('Setting choice ids use lowercase letters, digits and hyphens.')
  let gpuNamePatterns: string[] | undefined
  if (choice.gpuNamePatterns !== undefined) {
    gpuNamePatterns = array(choice.gpuNamePatterns, 'Setting choice GPU name patterns').map((value) => {
      const pattern = nonemptyString(value, 'Setting choice GPU name pattern')
      try { new RegExp(pattern, 'i') } catch { invalid(`Invalid setting choice GPU name pattern: ${pattern}`) }
      return pattern
    })
    if (!gpuNamePatterns.length) invalid('Setting choice GPU name patterns cannot be empty.')
  }
  if (choice.needsFrameGeneration !== undefined && typeof choice.needsFrameGeneration !== 'boolean') invalid('Setting choice needsFrameGeneration must be a boolean.')
  if (choice.minPasses !== undefined && choice.minPasses !== 2 && choice.minPasses !== 3) invalid('Setting choice minPasses must be 2 or 3.')
  let placement: SettingChoicePlacement | undefined
  if (choice.placement !== undefined) {
    const p = object(choice.placement, 'Setting choice placement')
    if (p.in !== 'neural-rendering') invalid('Unknown setting choice placement.')
    const text = (value: unknown, field: string, max: number) => { const line = singleLine(value, field); if (line.length > max) invalid(`${field} is longer than ${max} characters.`); return line }
    placement = { in: 'neural-rendering', ...(p.group === undefined ? {} : { group: text(p.group, 'Setting choice group', 80) }), ...(p.note === undefined ? {} : { note: text(p.note, 'Setting choice note', 240) }) }
  }
  const options = array(choice.options, 'Setting choice options').map(settingChoiceOption)
  if (options.length < 2) invalid('A setting choice needs at least two options.')
  unique(options.map((option) => option.id), 'Setting choice option ids')
  const optionIds = new Set(options.map((option) => option.id))
  const defaultOption = nonemptyString(choice.defaultOption, 'Setting choice default')
  if (!optionIds.has(defaultOption)) invalid('A setting choice default must be one of its options.')
  const unofferedOption = choice.unofferedOption === undefined ? undefined : nonemptyString(choice.unofferedOption, 'Setting choice unoffered option')
  if (unofferedOption !== undefined && !optionIds.has(unofferedOption)) invalid('A setting choice unoffered option must be one of its options.')
  // Every option rewrites the same keys, so switching never leaves another option's value behind.
  const keys = (option: SettingChoiceOption) => option.settings.map(iniKeyId).sort().join('\n')
  if (options.some((option) => keys(option) !== keys(options[0]))) invalid('The options of a setting choice must write the same keys.')
  return { id, label: singleLine(choice.label, 'Setting choice label'), ...(gpuNamePatterns ? { gpuNamePatterns } : {}),
    ...(choice.needsFrameGeneration === undefined ? {} : { needsFrameGeneration: choice.needsFrameGeneration }),
    ...(choice.minPasses === undefined ? {} : { minPasses: choice.minPasses as 2 | 3 }), ...(placement ? { placement } : {}), options, defaultOption,
    ...(unofferedOption === undefined ? {} : { unofferedOption }) }
}
function settingChoices(value: unknown): SettingChoice[] {
  const choices = array(value, 'Setting choices').map(settingChoice)
  unique(choices.map((choice) => choice.id), 'Setting choice ids')
  const owners = new Map<string, string>()
  choices.forEach((choice, index) => {
    for (const key of choice.options[0].settings.map(iniKeyId)) {
      if (owners.has(key) && owners.get(key) !== choice.id) invalid('Two setting choices write the same key.')
      owners.set(key, choice.id)
    }
    for (const block of choice.options.flatMap((option) => option.blockedWhen ?? [])) {
      if (!block.choice) continue
      const above = choices.slice(0, index).find((other) => other.id === block.choice!.id)
      if (!above) invalid(`A setting choice can only be blocked by a choice above it: ${block.choice.id}.`)
      if (block.choice.options.some((id) => !above.options.some((option) => option.id === id))) invalid(`A choice block names an option that ${above.id} lacks.`)
    }
    // One option is always free, so resolving the choices always finds a valid combination.
    if (choice.options.every((option) => option.blockedWhen?.length)) invalid(`Every option of ${choice.id} could be blocked; one must always be free.`)
  })
  return choices
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
function gpuPatterns(value: unknown, field: string): string[] {
  const list = array(value, field).map((v) => {
    const pattern = nonemptyString(v, field)
    try { new RegExp(pattern, 'i') } catch { invalid(`Invalid ${field}: ${pattern}`) }
    return pattern
  })
  if (!list.length) invalid(`${field} cannot be empty.`)
  return list
}
function nrToggle(value: unknown, field: string): NrToggle {
  const t = object(value, field)
  if (t.experimental !== undefined && typeof t.experimental !== 'boolean') invalid(`${field} experimental must be a boolean.`)
  return { key: iniKey(t.key), label: singleLine(t.label, `${field} label`), description: singleLine(t.description, `${field} description`),
    ...(t.experimental === undefined ? {} : { experimental: t.experimental }) }
}
function neuralRenderingControls(value: unknown): NeuralRenderingControls {
  const c = object(value, 'Neural Rendering controls')
  const order = NR_PRESET_IDS as readonly string[]
  const presets = array(c.presets, 'Neural Rendering presets').map((v): NrPresetOption => {
    const p = object(v, 'Neural Rendering preset')
    if (!order.includes(p.id as string)) invalid('Unknown Neural Rendering preset.')
    if (typeof p.ratio !== 'number' || !(p.ratio >= 1 && p.ratio <= 4)) invalid('A preset ratio must be between 1 and 4.')
    const presetValue = nonemptyString(p.value, 'Preset value')
    if (/[\r\n\0]/.test(presetValue)) invalid('Preset values must be single-line strings.')
    return { id: p.id as NrPresetId, label: singleLine(p.label, 'Preset label'), ratio: p.ratio, value: presetValue }
  })
  unique(presets.map((p) => p.id), 'Neural Rendering preset ids')
  if (presets.length !== NR_PRESET_IDS.length) invalid('The Neural Rendering presets must include all six DLSS presets.')
  presets.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  const defaults = array(c.defaults, 'Neural Rendering defaults').map((v): NrDefault => {
    const d = object(v, 'Neural Rendering default')
    if (!order.includes(d.preset as string)) invalid('Unknown default preset.')
    if (!(NR_PASSES as readonly unknown[]).includes(d.passes)) invalid('Default passes must be 1, 2 or 3.')
    return { ...(d.gpuNamePatterns === undefined ? {} : { gpuNamePatterns: gpuPatterns(d.gpuNamePatterns, 'default GPU name pattern') }),
      preset: d.preset as NrPresetId, passes: d.passes as NrPasses }
  })
  if (!defaults.length || defaults.at(-1)!.gpuNamePatterns) invalid('The last Neural Rendering default must match every card.')
  if (defaults.slice(0, -1).some((d) => !d.gpuNamePatterns)) invalid('Only the last Neural Rendering default may match every card.')
  const residual = object(c.residualFg, 'Residual frame generation')
  return { presetKey: iniKey(c.presetKey), presets, passesKey: iniKey(c.passesKey), scaleKey: iniKey(c.scaleKey),
    spatialCompression: nrToggle(c.spatialCompression, 'Spatial compression'),
    residualFg: { ...nrToggle(residual, 'Residual frame generation'), gpuNamePatterns: gpuPatterns(residual.gpuNamePatterns, 'residual GPU name pattern') }, defaults }
}
function mfgUnlock(value: unknown): MfgUnlock {
  const m = object(value, 'Multi-frame unlock')
  const gates = array(m.gates, 'Multi-frame unlock gates').map((id) => {
    if (!FRAME_GENERATION_IDS.includes(id as FrameGenerationId) || id === 'off' || id === '2x') invalid('A multi-frame unlock gates 3× to 6× or Dynamic.')
    return id as FrameGenerationId
  })
  if (!gates.length) invalid('A multi-frame unlock must gate at least one mode.')
  unique(gates, 'Multi-frame unlock gates')
  const settings = array(m.settings, 'Multi-frame unlock settings').map((setting) => iniSetting(object(setting, 'Multi-frame unlock setting')))
  if (!settings.length) invalid('A multi-frame unlock needs settings.')
  return { gpuNamePatterns: gpuPatterns(m.gpuNamePatterns, 'unlock GPU name pattern'), label: singleLine(m.label, 'Unlock label'),
    description: singleLine(m.description, 'Unlock description'), gates, settings }
}
/**
 * A Stable player never gets a beta app, so a Stable content version that needs one would be offered to nobody. The publish
 * tool and a test over manifest.json check this; the parser does not, because the app parses the live manifest and one wrong
 * edit there would make it unreadable for every player.
 */
export function assertStableNeedsStableApp(channel: string, minAppVersion: string): void {
  if (channel === 'stable' && minAppVersion.includes('-beta')) {
    invalid(`A Stable content version cannot require a beta app (${minAppVersion}). Publish it to Beta, or wait for a Stable app that has what it needs.`)
  }
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
    if (r.neuralRenderingControls !== undefined) recipes[id].neuralRenderingControls = neuralRenderingControls(r.neuralRenderingControls)
    if (r.mfgUnlock !== undefined) recipes[id].mfgUnlock = mfgUnlock(r.mfgUnlock)
    if (r.settingChoices !== undefined) recipes[id].settingChoices = settingChoices(r.settingChoices)
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
    const nr = recipes[id].neuralRenderingControls
    if (nr) {
      if (recipes[id].performanceProfilesV2 || recipes[id].performanceProfiles?.length) invalid('A tier offers Neural Rendering controls or performance profiles, not both.')
      for (const key of [nr.presetKey, nr.passesKey, nr.scaleKey, nr.spatialCompression.key, nr.residualFg.key]) ownedConfig(key.file)
    }
    for (const s of recipes[id].mfgUnlock?.settings ?? []) ownedConfig(s.file)
    for (const s of (recipes[id].settingChoices ?? []).flatMap((choice) => choice.options.flatMap((option) => option.settings))) ownedConfig(s.file)
    // A choice placed in the Neural Rendering card, or one that counts its passes, is only ever shown by a tier that has those controls.
    if (!nr && (recipes[id].settingChoices ?? []).some((choice) => choice.placement || choice.minPasses !== undefined)) invalid('A setting choice that is placed in the Neural Rendering card or needs passes needs the tier’s Neural Rendering controls.')
  }
  const knownBrokenGameVersions = v.knownBrokenGameVersions === undefined ? undefined
    : array(v.knownBrokenGameVersions, 'Known-broken game versions').map((version) => singleLine(version, 'Known-broken game version'))
  if (knownBrokenGameVersions) unique(knownBrokenGameVersions, 'Known-broken game versions')
  return { id, channel: v.channel, minAppVersion, changelog, components, files, tiers: recipes,
    ...(knownBrokenGameVersions ? { knownBrokenGameVersions } : {}) }
}
