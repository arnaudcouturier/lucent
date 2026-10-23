// Config files: what a content version's baseline holds for each one, and the update rule that decides what an update does with it.
import type { ConfigPath, ConfigUpdateRule } from '../shared/manifest'
import { readIni } from './ini'
import { joinPath } from './paths'
import { fileKey, type Plan } from './planner'
import { PlatformError, type Platform } from './platform'
import { expandUserFolders } from './userFolders'

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
      config.set(step.section, step.key, await expandUserFolders(platform, step.value))
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

export type ConfigRead =
  | { kind: 'readable'; text: string }
  | { kind: 'missing' }
  /** There and readable, but not as UTF-8 text: saved in another encoding, such as ANSI or UTF-16. It is still the player's file. */
  | { kind: 'not-text' }
  /** Lucent can't read it at all, or it holds nothing but zero bytes, which is what a crash mid-write leaves. */
  | { kind: 'unreadable' }
  | { kind: 'locked'; error: PlatformError }

/** Reads a config while preserving the distinction between a missing file, a file that isn't text and a file locked by another process. */
export async function readConfig(platform: Platform, path: string): Promise<ConfigRead> {
  let text: string
  try { text = await platform.readText(path) } catch (error) {
    if (error instanceof PlatformError && error.kind === 'not-found') return { kind: 'missing' }
    if (error instanceof PlatformError && error.kind === 'locked') return { kind: 'locked', error }
    // Bytes that aren't UTF-8 fail as text and still hash; a file Lucent can't open fails both.
    return platform.hashFile(path).then((): ConfigRead => ({ kind: 'not-text' }), (): ConfigRead => ({ kind: 'unreadable' }))
  }
  if (/^\0+$/.test(text)) return { kind: 'unreadable' }
  return text.includes('\0') ? { kind: 'not-text' } : { kind: 'readable', text }
}

/** Whether a config is there for the player: as text or not, contents are never drift. A missing, unreadable or locked one is. */
export async function configPresent(platform: Platform, path: string): Promise<boolean> {
  const { kind } = await readConfig(platform, path)
  return kind === 'readable' || kind === 'not-text'
}
