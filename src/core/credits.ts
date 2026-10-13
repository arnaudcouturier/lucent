import type { DeploymentRecord } from './deployment'
import type { ManifestState } from './manifest'
import type { ContentVersion } from '../shared/manifest'
import { onChannel, type Channel } from './updates'

/** Prefer the active deployment's version; before deployment, use the newest version on the channel, the one Install would pick. */
export function creditsVersion(
  manifest: ManifestState,
  deployment: DeploymentRecord | null,
  tier: string | null,
  channel: Channel,
): ContentVersion | null {
  if (manifest.status !== 'ready') return null
  const versions = manifest.manifest.versions
  if (deployment) {
    return versions.find((version) => version.id === deployment.contentVersion) ?? null
  }
  return versions
    .filter((version) => onChannel(version, channel) && (!tier || !!version.tiers[tier]))
    .sort((a, b) => b.id.localeCompare(a.id))[0] ?? null
}
