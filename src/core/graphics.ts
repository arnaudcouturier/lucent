import type { GpuAdapter, Platform } from './platform'
import type { Manifest, Tier } from '../shared/manifest'

export type GraphicsState =
  | { status: 'idle' | 'scanning' }
  | { status: 'found'; adapter: GpuAdapter; tier: Tier | null }
  | { status: 'not-found' }
  | { status: 'unavailable'; message: string }

/** The first matching tier wins. Validation guarantees a final catch-all tier. */
export function matchTier(adapter: GpuAdapter, manifest: Manifest): Tier {
  return manifest.tiers.find((tier) => tier.gpuMatch === 'any' || tier.gpuMatch.some((rule) =>
    rule.vendorId === adapter.vendorId && rule.deviceNamePatterns.some((pattern) => new RegExp(pattern, 'i').test(adapter.name)),
  ))!
}

export async function scanGraphics(platform: Platform): Promise<GraphicsState> {
  try {
    const adapters = (await platform.getGpuAdapters()).filter((gpu) => !gpu.software)
    const adapter = adapters.reduce<GpuAdapter | null>((best, gpu) => !best || gpu.dedicatedMemory > best.dedicatedMemory ? gpu : best, null)
    return adapter ? { status: 'found', adapter, tier: null } : { status: 'not-found' }
  } catch (error) {
    return { status: 'unavailable', message: error instanceof Error ? error.message : String(error) }
  }
}
