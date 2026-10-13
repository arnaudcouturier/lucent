import type { DeploymentRecord } from './deployment'
import type { ManifestState } from './manifest'
import type { ContentVersion } from '../shared/manifest'

/** Prefer the active deployment's version; use the newest stable version only before deployment. */
export function creditsVersion(
  manifest: ManifestState,
  deployment: DeploymentRecord | null,
  tier: string | null,
): ContentVersion | null {
  if (manifest.status !== 'ready') return null
  const versions = manifest.manifest.versions
  if (deployment) {
    return versions.find((version) => version.id === deployment.contentVersion) ?? null
  }
  return versions
    .filter((version) => version.channel === 'stable' && (!tier || !!version.tiers[tier]))
    .sort((a, b) => b.id.localeCompare(a.id))[0] ?? null
}
