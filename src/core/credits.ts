import type { DeploymentRecord } from './deployment'
import type { ManifestState } from './manifest'
import type { ContentVersion } from '../shared/manifest'
import { onChannel, type Channel } from './updates'

/**
 * Prefer the active deployment's version, from the live manifest or else from the copy the deployment keeps, so Credits still
 * lists it offline or once it is no longer published. Before deployment, use the newest version on the channel, the one Install would pick.
 */
export function creditsVersion(
  manifest: ManifestState,
  deployment: DeploymentRecord | null,
  tier: string | null,
  channel: Channel,
): ContentVersion | null {
  if (deployment) {
    const published = manifest.status === 'ready' ? manifest.manifest.versions.find((version) => version.id === deployment.contentVersion) : undefined
    return published ?? deployment.cachedVersions?.find((cached) => cached.content.id === deployment.contentVersion && cached.tier.id === deployment.tier)?.content ?? null
  }
  if (manifest.status !== 'ready') return null
  return manifest.manifest.versions
    .filter((version) => onChannel(version, channel) && (!tier || !!version.tiers[tier]))
    .sort((a, b) => b.id.localeCompare(a.id))[0] ?? null
}
