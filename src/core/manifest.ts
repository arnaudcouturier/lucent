import { ManifestError, parseManifest, type Manifest } from '../shared/manifest'
import type { LocalContent, Platform } from './platform'

export const MANIFEST_URL = 'https://raw.githubusercontent.com/arnaudcouturier/lucent/main/manifest.json'

export type ContentSource = { kind: 'github' } | ({ kind: 'local' } & LocalContent)

export type ManifestState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; manifest: Manifest; source: ContentSource }
  | { status: 'update-required' | 'invalid' | 'unavailable'; message: string }

export async function loadManifest(platform: Platform): Promise<ManifestState> {
  try {
    const local = await platform.getDevContent()
    const source: ContentSource = local ? { kind: 'local', ...local } : { kind: 'github' }
    const text = local ? await platform.readText(local.manifestPath) : await platform.fetchText(MANIFEST_URL)
    return { status: 'ready', manifest: parseManifest(text), source }
  } catch (error) {
    if (error instanceof ManifestError) return { status: error.kind, message: error.message }
    return { status: 'unavailable', message: error instanceof Error ? error.message : String(error) }
  }
}
