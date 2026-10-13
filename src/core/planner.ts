import { assertGamePath, type ContentFile, type ContentVersion, DEFAULT_PROFILE, type ProfileId, type Step, type Tier, type TierRecipe } from '../shared/manifest'
import type { FileStat } from './platform'
import type { ExistingSetup } from './existingSetup'

export const fileKey = (path: string) => path.replace(/\\/g, '/').toLowerCase()
/** Where a Disabled deployment keeps an entry file, so the game no longer loads it. */
export const disabledName = (path: string) => `${path}.disabled`
export interface DeploymentScan {
  files: Record<string, FileStat>
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
  steps: PlanStep[]
  files: ContentFile[]
  filesToDownload: ContentFile[]
  filesToBackup: string[]
  blockedPaths: string[]
  existingSetups: ExistingSetup[]
  /** Existing-setup files the deployment backs up and removes, so it may write over them. */
  takenOver: string[]
  expectedFiles: { path: string; sha256: string | null }[]
  recipe: TierRecipe
  counts: { added: number; backedUp: number; downloads: number }
  downloadSize: number
}

/**
 * Pure planning: all facts about the folder and verified cache are supplied by Scan.
 * Planned from a current deployment (its files are `scan.ownedFiles`), the steps also delete the owned files the content no
 * longer deploys, and a Disabled deployment gets its entry files renamed aside.
 */
export function planDeployment(content: ContentVersion, tier: Tier, includeReShade: boolean, scan: DeploymentScan, profile: ProfileId | null = null, enabled = true): Plan {
  const recipe = content.tiers[tier.id]
  if (!recipe) throw new Error('No content is available for this tier yet.')
  includeReShade ||= tier.requiresReShade
  const included = (v: { when?: 'reshade' }) => !v.when || includeReShade
  const includedConfig = (file: string) => recipe.ownedConfigs.some((c) => included(c) && fileKey(c.path) === fileKey(file))
  const recipeSteps = recipe.recipe.filter(included).map((s) => ({ ...s }))
  const selected = recipe.performanceProfiles?.length ? recipe.performanceProfiles.find((p) => p.id === (profile ?? DEFAULT_PROFILE)) : null
  if (recipe.performanceProfiles?.length && !selected) throw new Error('Choose a performance profile for this tier.')
  // The profile applies after the recipe but stays out of the saved recipe: the record names it on its own.
  const contentSteps: Step[] = [...recipeSteps, ...(selected?.settings ?? []).filter((s) => includedConfig(s.file)).map((s) => ({ kind: 'ini_set' as const, ...s }))]
  if (!enabled) contentSteps.push(...recipe.entryFiles.filter(included).map((p): Step => ({ kind: 'rename', from: p.path, to: disabledName(p.path) })))
  const initial = new Set(Object.keys(scan.files).map(fileKey))
  const owned = new Set(scan.ownedFiles.map(fileKey))
  const existingSetups = scan.existingSetups ?? []
  const { carries, takenOver } = takeOver(existingSetups, contentSteps, initial)
  for (const path of takenOver) owned.add(fileKey(path))
  const steps: PlanStep[] = [...carries, ...takenOver.map((path) => ({ kind: 'delete' as const, path })), ...contentSteps]
  const present = new Map([...initial].map((p) => [p, null as string | null]))
  const touched = new Map<string, string>()
  const backups = new Map<string, string>()
  const blocked = new Map<string, string>()
  const modify = (path: string) => {
    assertGamePath(path)
    const key = fileKey(path)
    if (present.has(key) && !owned.has(key)) blocked.set(key, path)
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
    contentVersion: content.id, tier: tier.id, includeReShade, profile: selected?.id ?? null, steps, files, filesToDownload,
    filesToBackup: [...backups.values()], blockedPaths: [...blocked.values()], existingSetups, takenOver, expectedFiles, recipe: filteredRecipe,
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
