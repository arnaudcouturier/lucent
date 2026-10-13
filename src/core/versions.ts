import type { ContentFile, ContentVersion, Manifest, Tier } from '../shared/manifest'
import type { DeploymentRecord } from './deployment'
import { dataPaths, maybeStat, readDeployment } from './deployment'
import type { Platform } from './platform'
import { joinPath } from './paths'
import type { Settings } from './settings'
import { needsNewerApp, onChannel, type Channel } from './updates'

/** Recipes and assets retained with the journal, independent of the live manifest. Current first. */
export interface CachedVersion { content: ContentVersion; tier: Tier }
export interface VersionChoice {
  id: string
  changelog: string[]
  current: boolean
  cached: boolean
  skipped: boolean
  pinned: boolean
  downloadSize: number | null
  unavailable: string | null
}

export function cacheSnapshot(content: ContentVersion, tier: Tier, recipe: DeploymentRecord['recipe'], files: ContentFile[]): CachedVersion {
  return { content: { ...content, files, tiers: { [tier.id]: recipe } }, tier }
}

/** The cache is shared by game folders. Never prune assets needed by another journal. */
export async function pruneContentCache(platform: Platform, gameFolder: string): Promise<void> {
  const { data, cache } = await dataPaths(platform, gameFolder)
  const directory = joinPath(data, 'deployments')
  const keep = new Set<string>()
  for (const relative of await platform.listFiles(directory)) {
    if (!relative.endsWith('record.json')) continue
    const path = joinPath(directory, relative)
    const value = JSON.parse(await platform.readText(path)) as DeploymentRecord
    const record = await readDeployment(platform, value.gameFolder)
    if (!record || record.status === 'applying') return
    if (record.status !== 'complete') continue
    for (const version of record.cachedVersions ?? []) for (const file of version.content.files) keep.add(file.sha256)
    // Older records may have no content snapshots yet; their deployed files still need Repair.
    for (const stamp of Object.values(record.files)) keep.add(stamp.sha256)
    for (const step of record.recipe.recipe) if (step.kind === 'copy') keep.add(step.file)
  }
  for (const relative of await platform.listFiles(cache)) {
    // Only Lucent's hash-named assets belong to this cache. Unrecognized files stay untouched.
    if (/^[a-f0-9]{64}$/.test(relative) && !keep.has(relative)) await platform.removeFile(joinPath(cache, relative))
  }
}

/** Listing checks cached assets by size only; applying a version hashes them before use and re-downloads a damaged one. */
export async function versionChoices(platform: Platform, record: DeploymentRecord, manifest: Manifest | null, settings: Settings, channel: Channel, appVersion: string): Promise<VersionChoice[]> {
  const { cache } = await dataPaths(platform, record.gameFolder)
  const saved = new Map((record.cachedVersions ?? []).map((v) => [v.content.id, v]))
  const published = new Map((manifest?.versions ?? []).filter((v) => onChannel(v, channel)).map((v) => [v.id, v]))
  // A skipped version from the other channel is still published, just not offered here: leaving Beta hides it.
  const offChannel = new Set((manifest?.versions ?? []).filter((v) => !onChannel(v, channel)).map((v) => v.id))
  const ids = new Set([record.contentVersion, ...saved.keys(), ...published.keys(), ...settings.skippedContent.filter((id) => !offChannel.has(id))])
  const present = new Map<string, boolean>()
  const choices: VersionChoice[] = []
  for (const id of [...ids].sort((a, b) => b.localeCompare(a))) {
    const content = saved.get(id)?.content ?? published.get(id)
    const tier = saved.get(id)?.tier ?? manifest?.tiers.find((t) => t.id === record.tier)
    const recipe = content?.tiers[record.tier]
    const unavailable = !content ? 'This version is no longer published.' : !recipe || !tier ? 'No recipe for your tier.'
      : needsNewerApp(content.minAppVersion, appVersion) ? 'Update Lucent to apply this version.' : null
    let downloadSize: number | null = null
    if (!unavailable && content && recipe && tier) {
      const hashes = new Set(recipe.recipe.filter((s) => s.kind === 'copy' && (!s.when || record.includeReShade || tier.requiresReShade)).map((s) => s.kind === 'copy' ? s.file : ''))
      downloadSize = 0
      for (const file of content.files.filter((f) => hashes.has(f.sha256))) {
        if (!present.has(file.sha256)) {
          const stat = await maybeStat(platform, joinPath(cache, file.sha256))
          present.set(file.sha256, stat?.kind === 'file' && stat.size === file.size)
        }
        if (!present.get(file.sha256)) downloadSize += file.size
      }
    }
    choices.push({ id, changelog: content?.changelog ?? [], current: id === record.contentVersion,
      cached: saved.has(id) && downloadSize === 0, skipped: settings.skippedContent.includes(id) || record.pendingSelection?.skip === id,
      pinned: id === record.contentVersion && !!record.pinned, downloadSize, unavailable })
  }
  return choices
}
