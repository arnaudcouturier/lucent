import { assertGamePath, type ContentFile, type ContentVersion, type Step, type Tier, type TierRecipe } from '../shared/manifest'
import type { FileStat } from './platform'

export const fileKey = (path: string) => path.replace(/\\/g, '/').toLowerCase()
export interface DeploymentScan {
  files: Record<string, FileStat>
  ownedFiles: string[]
  cachedFiles: string[]
}
export interface Plan {
  contentVersion: string
  tier: string
  includeReShade: boolean
  steps: Step[]
  files: ContentFile[]
  filesToDownload: ContentFile[]
  filesToBackup: string[]
  blockedPaths: string[]
  expectedFiles: { path: string; sha256: string | null }[]
  recipe: TierRecipe
  counts: { added: number; backedUp: number; downloads: number }
  downloadSize: number
}

/** Pure planning: all facts about the folder and verified cache are supplied by Scan. */
export function planDeployment(content: ContentVersion, tier: Tier, includeReShade: boolean, scan: DeploymentScan): Plan {
  const recipe = content.tiers[tier.id]
  if (!recipe) throw new Error('No content is available for this tier yet.')
  includeReShade ||= tier.requiresReShade
  const included = (v: { when?: 'reshade' }) => !v.when || includeReShade
  const steps = recipe.recipe.filter(included).map((s) => ({ ...s }))
  const initial = new Set(Object.keys(scan.files).map(fileKey))
  const owned = new Set(scan.ownedFiles.map(fileKey))
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
    if (step.kind === 'copy') {
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
    } else {
      modify(step.path)
      present.delete(fileKey(step.path))
    }
  }
  const paths = (items: TierRecipe['entryFiles']) => items.filter(included).map((p) => ({ ...p }))
  const filteredRecipe = { ...recipe, recipe: steps, entryFiles: paths(recipe.entryFiles), ownedConfigs: paths(recipe.ownedConfigs), shippedPresets: paths(recipe.shippedPresets), generatedFiles: paths(recipe.generatedFiles) }
  for (const p of [...filteredRecipe.entryFiles, ...filteredRecipe.ownedConfigs, ...filteredRecipe.shippedPresets]) {
    assertGamePath(p.path)
    if (!touched.has(fileKey(p.path)) || !present.has(fileKey(p.path))) throw new Error(`Recipe does not deploy its declared file: ${p.path}`)
  }
  if (!filteredRecipe.entryFiles.length) throw new Error('The recipe has no active entry file.')
  const hashes = new Set(steps.filter((s) => s.kind === 'copy').map((s) => s.file))
  const files = [...hashes].map((hash) => {
    const file = content.files.find((f) => f.sha256 === hash)
    if (!file) throw new Error(`Unknown recipe file: ${hash}`)
    return { ...file }
  })
  const cached = new Set(scan.cachedFiles)
  const filesToDownload = files.filter((f) => !cached.has(f.sha256))
  const expectedFiles = [...touched].filter(([key]) => present.has(key)).map(([key, path]) => ({ path, sha256: present.get(key)! }))
  return {
    contentVersion: content.id, tier: tier.id, includeReShade, steps, files, filesToDownload,
    filesToBackup: [...backups.values()], blockedPaths: [...blocked.values()], expectedFiles, recipe: filteredRecipe,
    counts: { added: expectedFiles.filter((f) => !initial.has(fileKey(f.path))).length, backedUp: backups.size, downloads: filesToDownload.length },
    downloadSize: filesToDownload.reduce((n, f) => n + f.size, 0),
  }
}
