import type { State } from './core'
import { PlatformError, type Platform } from './platform'
import type { Channel } from './updates'
import { joinPath } from './paths'
import { checkHealth, type Drift } from './health'

const TIER_STATUS = { stable: 'Stable', experimental: 'Experimental', 'community-verified': 'Community-verified' }

/** A deployed tier stays the report's identity even if a newer manifest no longer describes it. */
function diagnosticSetup(state: State) {
  const record = state.deployment
  return {
    adapter: state.graphics.status === 'found' ? state.graphics.adapter : record?.graphics,
    tier: record
      ? state.manifest.status === 'ready' ? state.manifest.manifest.tiers.find((tier) => tier.id === record.tier) : null
      : state.graphics.status === 'found' ? state.graphics.tier : null,
  }
}

/** The template travels in the URL; the large diagnostics text travels only through the clipboard. */
export function bugReportUrl(state: State): string {
  const { adapter, tier } = diagnosticSetup(state)
  const url = new URL('https://github.com/arnaudcouturier/lucent/issues/new')
  url.searchParams.set('title', `Bug report · ${tier?.label ?? state.deployment?.tier ?? 'Unknown tier'} · ${adapter?.name ?? 'Unknown GPU'}`)
  url.searchParams.set('body', [
    '## What happened?', '', 'Describe the problem and what you expected to happen.', '',
    '## Steps to reproduce', '', '1. ', '',
    '## Diagnostics', '', 'Paste the diagnostics from your clipboard between the lines below.', '',
    '```text', '(paste diagnostics here)', '```',
  ].join('\n'))
  return url.href
}

/** Builds the text the player can paste when asking for help. Machine access stays at the Platform port. */
export async function collectDiagnostics(platform: Platform, state: State, appVersion: string, channel: Channel): Promise<string> {
  const record = state.deployment
  const { adapter, tier } = diagnosticSetup(state)
  const windows = await platform.getWindowsVersion().catch(() => 'Unavailable')
  const folder = record?.gameFolder ?? (state.gameFolder.status === 'found' ? state.gameFolder.path : null)
  const gameVersion = folder ? await platform.readText(joinPath(folder, 'game', 'ffxivgame.ver')).then((text) => text.trim() || null).catch(() => null) : null
  let health = record ? 'Not checked' : 'No deployment'
  let drift: Drift | null = null
  if (state.recoveryRequired) health = 'Recovery required'
  else if (record?.status === 'complete') {
    try {
      drift = await checkHealth(platform, structuredClone(record), gameVersion, true)
      health = drift ? 'Drift' : 'Healthy'
    } catch (error) { health = `Unavailable (${error instanceof Error ? error.message : String(error)})` }
  }
  const lines = [
    'Lucent diagnostics',
    `App version: ${appVersion}`,
    `Content version: ${record?.contentVersion ?? 'None deployed'}`,
    `Channel: ${channel === 'beta' ? 'Beta' : 'Stable'}`,
    `Tier: ${tier ? `${tier.label} (${tier.id})` : record?.tier ?? 'Unavailable'}`,
    `Tier status: ${tier ? TIER_STATUS[tier.status] : 'Unavailable'}`,
    `GPU: ${adapter?.name ?? 'Unavailable'}`,
    `GPU driver: ${adapter?.driverVersion ?? 'Unavailable'}`,
    `Windows: ${windows}`,
    `Game version: ${gameVersion ?? 'Unavailable'}`,
    `Deployment: ${record ? record.enabled ? 'Enabled' : 'Disabled' : 'None'}`,
    `Health check: ${health}`,
    ...(drift ? [`Drift: ${drift.files.join(', ')}`] : []),
    '',
    'File hashes (SHA-256):',
  ]
  if (record) {
    const root = joinPath(record.gameFolder, 'game')
    for (const [relative, expected] of Object.entries(record.files).sort(([a], [b]) => a.localeCompare(b))) {
      let actual: string
      try { actual = await platform.hashFile(await platform.resolveGamePath(root, relative)) }
      catch (error) { actual = `Unavailable (${error instanceof Error ? error.message : String(error)})` }
      lines.push(`${relative}\n  Expected: ${expected.sha256}\n  Actual: ${actual}`)
    }
  } else lines.push('No deployment to check.')
  if (folder) {
    try {
      const path = await platform.resolveGamePath(joinPath(folder, 'game'), 'OptiScaler.log')
      const log = await platform.readTextTail(path, 300)
      lines.push('', 'OptiScaler log (last 300 lines):', log)
    } catch (error) {
      if (!(error instanceof PlatformError && error.kind === 'not-found')) lines.push('', `OptiScaler log: Unavailable (${error instanceof Error ? error.message : String(error)})`)
    }
  }
  return lines.join('\n')
}
