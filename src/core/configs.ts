// Config files: what a content version's baseline holds for each one, and the update rule that decides what an update does with it.
import type { ConfigPath, ConfigUpdateRule } from '../shared/manifest'
import { readIni } from './ini'
import { joinPath } from './paths'
import { fileKey, type Plan } from './planner'
import type { Platform } from './platform'

/** `keep` when the content gives the file no rule. */
export const updateRule = (config: ConfigPath): ConfigUpdateRule => config.update ?? 'keep'

/** The cached asset each config is copied from, following the plan's renames and deletions; a config no step copies has none. */
export function configBaselineAssets(plan: Plan): string[] {
  const hashes = new Map<string, string>()
  for (const step of plan.steps) {
    if (step.kind === 'copy') hashes.set(fileKey(step.to), step.file)
    else if (step.kind === 'rename') {
      const hash = hashes.get(fileKey(step.from))
      if (hash) { hashes.set(fileKey(step.to), hash); hashes.delete(fileKey(step.from)) }
    } else if (step.kind === 'delete') hashes.delete(fileKey(step.path))
  }
  return [...new Set(plan.recipe.ownedConfigs.flatMap((config) => hashes.get(fileKey(config.path)) ?? []))]
}

/**
 * What the plan writes to each config: the cached file it copies there, with every `ini_set` for that file (the recipe's,
 * then the profile's, frame generation's, HDR's and the screen's) applied in plan order. Keyed by `fileKey(path)`; a
 * config the plan doesn't copy has no baseline. Only configs are read as text; other assets are tracked by hash through renames.
 */
export async function configBaselines(platform: Platform, cache: string, plan: Plan): Promise<Map<string, string>> {
  type Entry = { hash?: string; text?: string }
  const virtual = new Map<string, Entry>()
  const configKeys = new Set(plan.recipe.ownedConfigs.map((c) => fileKey(c.path)))
  for (const step of plan.steps) {
    if (step.kind === 'copy') virtual.set(fileKey(step.to), { hash: step.file })
    else if (step.kind === 'rename') {
      const entry = virtual.get(fileKey(step.from))
      if (entry) { virtual.set(fileKey(step.to), entry); virtual.delete(fileKey(step.from)) }
    } else if (step.kind === 'delete') virtual.delete(fileKey(step.path))
    else if (step.kind === 'ini_set' && configKeys.has(fileKey(step.file))) {
      const entry = virtual.get(fileKey(step.file))
      if (!entry) continue
      if (entry.text === undefined) entry.text = await platform.readText(joinPath(cache, entry.hash!))
      const config = readIni(entry.text)
      config.set(step.section, step.key, step.value)
      entry.text = config.toString()
      delete entry.hash
    }
  }
  const baselines = new Map<string, string>()
  for (const config of plan.recipe.ownedConfigs) {
    const entry = virtual.get(fileKey(config.path))
    if (entry) baselines.set(fileKey(config.path), entry.text ?? await platform.readText(joinPath(cache, entry.hash!)))
  }
  return baselines
}

const sentenceList = (names: string[]) => names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/** The changelog lines about config files: the ones an update adds keys to or replaces. A file the deployment doesn't have yet is simply added, so it isn't mentioned. */
export function configUpdateNotes(configs: ConfigPath[], deployedFiles: Iterable<string>): string[] {
  const deployed = new Set([...deployedFiles].map(fileKey))
  const named = (rule: ConfigUpdateRule) => configs.filter((config) => updateRule(config) === rule && deployed.has(fileKey(config.path))).map((config) => config.path)
  const adds = named('addMissingKeys')
  const replaces = named('replace')
  return [
    ...(adds.length ? [`Adds missing keys to ${sentenceList(adds)}. Your values stay.`] : []),
    ...(replaces.length ? [`Replaces ${sentenceList(replaces)} with the tested setup. Lucent backs up your ${replaces.length === 1 ? 'copy' : 'copies'} first.`] : []),
  ]
}

/** A config's text, or null when it can't be read as text: it is missing, locked, or binary. */
export async function readableText(platform: Platform, path: string): Promise<string | null> {
  try {
    const text = await platform.readText(path)
    return text.includes('\0') ? null : text
  } catch { return null }
}
