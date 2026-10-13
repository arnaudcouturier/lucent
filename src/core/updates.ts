// Which content version to announce: a pure function of the manifest and what the player has.
import type { ContentVersion, Manifest } from '../shared/manifest'

export type Channel = ContentVersion['channel']

export interface AnnouncementFacts {
  channel: Channel
  /** The deployed tier; a version without a recipe for it can't be applied. */
  tier: string
  current: string
  skipped: readonly string[]
  appVersion: string
}

/** Beta sees Stable and Beta versions; Stable sees only Stable. */
export const onChannel = (version: ContentVersion, channel: Channel) => channel === 'beta' || version.channel === 'stable'

/** Compares the numeric parts of two app versions, such as 0.1.0 and 0.2.0. */
export function needsNewerApp(minAppVersion: string, appVersion: string): boolean {
  const app = appVersion.split(/[.-]/).map(Number)
  const minimum = minAppVersion.split(/[.-]/).map(Number)
  const firstDifference = minimum.findIndex((n, i) => n !== app[i])
  return firstDifference >= 0 && minimum[firstDifference] > (app[firstDifference] ?? 0)
}

/** The newest version on the channel that is newer than the current one, isn't skipped, and this app can apply. */
export function announcedContent(manifest: Manifest, facts: AnnouncementFacts): ContentVersion | null {
  return manifest.versions
    .filter((v) => onChannel(v, facts.channel) && v.id > facts.current && !facts.skipped.includes(v.id)
      && v.tiers[facts.tier] && !needsNewerApp(v.minAppVersion, facts.appVersion))
    .sort((a, b) => b.id.localeCompare(a.id))[0] ?? null
}
