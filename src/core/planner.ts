import { assertGamePath, DEFAULT_PROFILE, LEGACY_DEFAULT_PROFILE, type ContentFile, type ContentVersion, type FrameGenerationId, type FrameGenerationOption, type ProfileId, type Step, type Tier, type TierRecipe } from '../shared/manifest'
import type { ExistingSetup } from './existingSetup'
import { profileOwnedElsewhereSettingKeys, profileSettingsForHeight, profilesForRecipe, recommendedProfile } from './profileValues'

export const fileKey = (path: string) => path.replace(/\\/g, '/').toLowerCase()
/** Where a Disabled deployment keeps an entry file, so the game no longer loads it. */
export const disabledName = (path: string) => `${path}.disabled`
/** A deployment keeps its profile where the tier still offers it; otherwise the tier's default applies. */
export const keptProfile = (content: ContentVersion, tier: Tier, profile: ProfileId | null | undefined): ProfileId | null =>
  content.tiers[tier.id] && profilesForRecipe(content.tiers[tier.id]).some((p) => p.id === profile) ? profile! : null
export interface DeploymentScan {
  /** Every file in the game folder, relative to it. */
  files: string[]
  ownedFiles: string[]
  cachedFiles: string[]
  existingSetups?: ExistingSetup[]
}
/** Where carried-over presets go. ReShade lists this folder in its preset picker. */
export const PRESET_FOLDER = 'reshade-presets'
/** A carry copies an existing setup's preset into Lucent's preset folder, where it stays as a user file. */
export type PlanStep = Step | { kind: 'carry'; from: string; to: string } | { kind: 'write'; path: string; text: string }
/** The paths a step mutates; copying a carried-over preset only reads its source. */
export const stepWritePaths = (step: PlanStep): string[] => step.kind === 'rename' ? [step.from, step.to]
  : step.kind === 'copy' || step.kind === 'carry' ? [step.to] : [step.kind === 'ini_set' ? step.file : step.path]
export interface Plan {
  contentVersion: string
  tier: string
  includeReShade: boolean
  profile: ProfileId | null
  frameGenerationMode: FrameGenerationId | null
  steps: PlanStep[]
  files: ContentFile[]
  filesToDownload: ContentFile[]
  /** Every file from before the plan that it overwrites or removes; each is backed up first. */
  filesToBackup: string[]
  /**
   * Files from before the plan that no existing setup claims but that it overwrites or removes, such as a DLSS DLL or a license file.
   * A first deployment backs them up and replaces them like the rest, since Scan lists them; an update refuses instead.
   */
  unclaimedPaths: string[]
  existingSetups: ExistingSetup[]
  /** Existing-setup files the deployment backs up and removes, so it may write over them. */
  takenOver: string[]
  expectedFiles: { path: string; sha256: string | null }[]
  recipe: TierRecipe
  counts: { added: number; backedUp: number; downloads: number }
  downloadSize: number
}

export interface ProfilePlanContext {
  gpuName?: string
  outputHeight?: number
}

/**
 * Pure planning: all facts about the folder and verified cache are supplied by Scan.
 * Planned from a current deployment (its files are `scan.ownedFiles`), the steps also delete the owned files the content no
 * longer deploys, and a Disabled deployment gets its entry files renamed aside.
 */
export interface PlanSelection extends ProfilePlanContext {
  /** Options already filtered to the player's GPU. Omit to keep every manifest variant. */
  frameGenerationOptions?: FrameGenerationOption[]
  frameGenerationMode?: FrameGenerationId | null
}

export function planDeployment(
  content: ContentVersion, tier: Tier, includeReShade: boolean, scan: DeploymentScan,
  profile: ProfileId | null = null, enabled = true, selection: PlanSelection = {},
): Plan {
  const recipe = content.tiers[tier.id]
  if (!recipe) throw new Error('No content is available for this tier yet.')
  includeReShade ||= tier.requiresReShade
  const included = (v: { when?: 'reshade' }) => !v.when || includeReShade
  const includedConfig = (file: string) => recipe.ownedConfigs.some((c) => included(c) && fileKey(c.path) === fileKey(file))
  const recipeSteps = recipe.recipe.filter(included).map((s) => ({ ...s }))
  const profiles = profilesForRecipe(recipe)
  const defaultProfile = recipe.performanceProfilesV2 !== undefined
    ? recommendedProfile(profiles, selection.gpuName ?? '')?.id ?? DEFAULT_PROFILE
    : LEGACY_DEFAULT_PROFILE
  const selected = profiles.length ? profiles.find((p) => p.id === (profile ?? defaultProfile)) : null
  if (profiles.length && !selected) throw new Error('Choose a performance profile for this tier.')
  const frameGenerationOptions = selection.frameGenerationOptions ?? recipe.frameGenerationOptions ?? []
  const selectedFrameGeneration = selection.frameGenerationMode
    ? frameGenerationOptions.find((option) => option.id === selection.frameGenerationMode) ?? null
    : null
  const profileOwnedElsewhereKeys = profileOwnedElsewhereSettingKeys(recipe)
  const resolvedProfileSettings = selected ? profileSettingsForHeight(selected, selection.outputHeight ?? 2160) : []
  const profileSettings = resolvedProfileSettings.filter((setting) =>
    !profileOwnedElsewhereKeys.has(`${fileKey(setting.file)}|${setting.section.toLowerCase()}|${setting.key.toLowerCase()}`))
  // Profiles apply after the recipe; frame generation then owns every key shared with a profile.
  const contentSteps: Step[] = [
    ...recipeSteps,
    ...profileSettings.filter((s) => includedConfig(s.file)).map((s) => ({ kind: 'ini_set' as const, ...s })),
    ...(selectedFrameGeneration?.settings ?? []).filter((s) => includedConfig(s.file)).map((s) => ({ kind: 'ini_set' as const, ...s })),
  ]
  if (!enabled) contentSteps.push(...recipe.entryFiles.filter(included).map((p): Step => ({ kind: 'rename', from: p.path, to: disabledName(p.path) })))
  const initial = new Set(scan.files.map(fileKey))
  const owned = new Set(scan.ownedFiles.map(fileKey))
  const existingSetups = scan.existingSetups ?? []
  const { carries, takenOver } = takeOver(existingSetups, contentSteps, initial)
  for (const path of takenOver) owned.add(fileKey(path))
  const steps: PlanStep[] = [...carries, ...takenOver.map((path) => ({ kind: 'delete' as const, path })), ...contentSteps]
  const present = new Map([...initial].map((p) => [p, null as string | null]))
  const touched = new Map<string, string>()
  const backups = new Map<string, string>()
  const unclaimed = new Map<string, string>()
  const modify = (path: string) => {
    assertGamePath(path)
    const key = fileKey(path)
    if (present.has(key) && !owned.has(key)) unclaimed.set(key, path)
    if (initial.has(key)) backups.set(key, path)
    touched.set(key, path)
    owned.add(key)
  }
  for (const step of steps) {
    if (step.kind === 'carry') {
      assertGamePath(step.from)
      assertGamePath(step.to)
    } else if (step.kind === 'copy') {
      modify(step.to)
      present.set(fileKey(step.to), step.file)
    } else if (step.kind === 'rename') {
      assertGamePath(step.from)
      if (fileKey(step.from) === fileKey(step.to)) throw new Error('A rename must use different paths.')
      if (!present.has(fileKey(step.from))) throw new Error(`Recipe rename source is missing: ${step.from}`)
      modify(step.from)
      modify(step.to)
      present.set(fileKey(step.to), present.get(fileKey(step.from))!)
      present.delete(fileKey(step.from))
    } else if (step.kind === 'ini_set') {
      if (!present.has(fileKey(step.file))) throw new Error(`Recipe config is missing: ${step.file}`)
      if (!includedConfig(step.file)) throw new Error(`INI setting must target an owned config: ${step.file}`)
      modify(step.file)
      present.set(fileKey(step.file), null)
    } else {
      modify(step.path)
      present.delete(fileKey(step.path))
    }
  }
  // Owned files this content doesn't deploy are removed, through the journal like every other step.
  const dropped = scan.ownedFiles.filter((p) => present.has(fileKey(p)) && !touched.has(fileKey(p)))
  for (const path of dropped) {
    steps.push({ kind: 'delete', path })
    modify(path)
    present.delete(fileKey(path))
  }
  const paths = (items: TierRecipe['entryFiles']) => items.filter(included).map((p) => ({ ...p }))
  const filteredRecipe = { ...recipe, recipe: recipeSteps, entryFiles: paths(recipe.entryFiles), ownedConfigs: paths(recipe.ownedConfigs), shippedPresets: paths(recipe.shippedPresets), generatedFiles: paths(recipe.generatedFiles),
    ...(recipe.performanceProfiles ? { performanceProfiles: recipe.performanceProfiles.map((p) => ({ ...p, settings: p.settings.filter((s) => includedConfig(s.file)) })) } : {}),
    ...(recipe.performanceProfilesV2 ? { performanceProfilesV2: recipe.performanceProfilesV2.map((p) => ({ ...p, settings: p.settings.filter((s) => includedConfig(s.file)) })) } : {}),
    ...(recipe.screenDerivedSettings ? { screenDerivedSettings: recipe.screenDerivedSettings.filter((s) => includedConfig(s.file)) } : {}),
    ...(recipe.frameGenerationOptions || selection.frameGenerationOptions ? { frameGenerationOptions: frameGenerationOptions.map((option) => ({
      ...option,
      settings: option.settings.filter((setting) => includedConfig(setting.file)),
      ...(option.hdrSettings ? { hdrSettings: option.hdrSettings.filter((setting) => includedConfig(setting.file)) } : {}),
    })) } : {}),
  }
  const entryPaths = filteredRecipe.entryFiles.map((p) => enabled ? p.path : disabledName(p.path))
  for (const path of [...entryPaths, ...filteredRecipe.ownedConfigs.map((p) => p.path), ...filteredRecipe.shippedPresets.map((p) => p.path)]) {
    assertGamePath(path)
    if (!touched.has(fileKey(path)) || !present.has(fileKey(path))) throw new Error(`Recipe does not deploy its declared file: ${path}`)
  }
  if (!filteredRecipe.entryFiles.length) throw new Error('The recipe has no active entry file.')
  const hashes = new Set(contentSteps.filter((s) => s.kind === 'copy').map((s) => s.file))
  const files = [...hashes].map((hash) => {
    const file = content.files.find((f) => f.sha256 === hash)
    if (!file) throw new Error(`Unknown recipe file: ${hash}`)
    return { ...file }
  })
  const cached = new Set(scan.cachedFiles)
  const filesToDownload = files.filter((f) => !cached.has(f.sha256))
  const expectedFiles = [...touched].filter(([key]) => present.has(key)).map(([key, path]) => ({ path, sha256: present.get(key)! }))
  return {
    contentVersion: content.id, tier: tier.id, includeReShade, profile: selected?.id ?? null,
    frameGenerationMode: selectedFrameGeneration?.id ?? null, steps, files, filesToDownload,
    filesToBackup: [...backups.values()], unclaimedPaths: [...unclaimed.values()], existingSetups, takenOver, expectedFiles, recipe: filteredRecipe,
    counts: { added: expectedFiles.filter((f) => !initial.has(fileKey(f.path))).length, backedUp: backups.size, downloads: filesToDownload.length },
    downloadSize: filesToDownload.reduce((n, f) => n + f.size, 0),
  }
}

/**
 * An existing setup's files are removed, and so are its kept files and presets where the content writes.
 * Its presets outside Lucent's preset folder, or in the way of a shipped one, are carried over under a free name first,
 * keeping the folders below their top-level one.
 */
function takeOver(setups: ExistingSetup[], steps: Step[], initial: Set<string>) {
  const writes = new Set(steps.flatMap((s) => s.kind === 'copy' || s.kind === 'rename' ? [fileKey(s.to)] : []))
  const removed = new Map<string, string>()
  for (const setup of setups) {
    for (const path of setup.files) removed.set(fileKey(path), path)
    for (const path of [...setup.kept, ...setup.presets]) if (writes.has(fileKey(path))) removed.set(fileKey(path), path)
  }
  const taken = new Set([...initial, ...writes])
  const carries: PlanStep[] = []
  for (const from of setups.flatMap((s) => s.presets)) {
    if (fileKey(from).startsWith(`${PRESET_FOLDER}/`) && !removed.has(fileKey(from))) continue
    const parts = from.replace(/\\/g, '/').split('/')
    const folder = [PRESET_FOLDER, ...parts.slice(1, -1)].join('/')
    const name = parts.at(-1)!
    const dot = name.lastIndexOf('.')
    const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
    let to = `${folder}/${name}`
    for (let n = 1; taken.has(fileKey(to)); n++) to = `${folder}/${stem} (previous${n > 1 ? ` ${n}` : ''})${extension}`
    taken.add(fileKey(to))
    carries.push({ kind: 'carry', from, to })
  }
  return { carries, takenOver: [...removed.values()] }
}

/** What a first deployment does to the files already in the game folder, as Scan lists them. */
export interface FolderChanges {
  /** Where the originals are kept, readable: each backed-up file sits at its own path inside this folder. */
  backupFolder: string
  /** Every file from before the deployment, backed up, then replaced or removed. */
  backedUp: { path: string; removed: boolean }[]
  /** An existing setup's presets, kept as user files under the path each one gets. */
  carried: { from: string; to: string }[]
}

export function folderChanges(plan: Plan, backupFolder: string): FolderChanges {
  const remaining = new Set(plan.expectedFiles.map((f) => fileKey(f.path)))
  return {
    backupFolder,
    backedUp: plan.filesToBackup.map((path) => ({ path, removed: !remaining.has(fileKey(path)) })),
    carried: plan.steps.flatMap((s) => s.kind === 'carry' ? [{ from: s.from, to: s.to }] : []),
  }
}
