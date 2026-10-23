import type { State } from './core'
import { PlatformError, type Platform } from './platform'
import type { Channel } from './updates'
import { joinPath } from './paths'
import { checkHealth, type Drift } from './health'
import type { DeploymentRecord } from './deployment'
import { fileKey } from './planner'
import { fileCount } from './format'
import { LAUNCH_LABELS } from './launch'
import { frameGenerationLabel, hdrLabel } from './choices'
import { settingChoiceSummary } from './settingChoices'
import { profilesForRecipe } from './profileValues'

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

/** GitHub refuses an issue body over 65,536 characters; the rest is for the template and what the player writes. */
const MAX_LENGTH = 60_000
/** Past these, a list says how many more there are: a deployment of a thousand files can drift as a whole. */
const MAX_LISTED_DRIFT = 50
const MAX_LISTED_MISMATCHES = 100

/** `C:\Users\<name>` becomes `C:\Users\<user>`, so the report carries no Windows account name. */
const withoutAccountName = (text: string) => text.replace(/\b([a-z]:[\\/]users[\\/])[^\\/\r\n]+/gi, '$1<user>')

const listed = (items: string[], max: number, more: (count: number) => string) =>
  items.length > max ? `${items.slice(0, max).join(', ')} ${more(items.length - max)}` : items.join(', ')

/** The first-install choices the deployment keeps for Reset, as the activity log's Install line names them. */
function storedChoices(record: DeploymentRecord): string {
  const profile = record.profile ? `${profilesForRecipe(record.recipe).find((p) => p.id === record.profile)?.label ?? record.profile} profile` : null
  const nr = record.neuralRendering
  return [
    profile,
    nr ? `Neural Rendering ${nr.preset}, ${nr.passes} pass${nr.passes === 1 ? '' : 'es'}, ${nr.scale}%${nr.spatialCompression ? ', spatial compression' : ''}${nr.residualFg ? ', residual frame generation' : ''}` : null,
    record.mfgUnlocked ? 'multi-frame unlock' : null,
    record.frameGenerationMode ? `frame generation ${frameGenerationLabel(record.frameGenerationMode)}` : null,
    record.hdrMode ? `HDR ${hdrLabel(record.hdrMode)}` : null,
    ...settingChoiceSummary(record.recipe.settingChoices, record.settingChoices, { gpuName: record.graphics.name, frameGenerationMode: record.frameGenerationMode ?? null, hdrMode: record.hdrMode ?? null }).map(({ label, value }) => `${label} ${value}`),
    record.includeReShade ? 'ReShade included' : 'without ReShade',
  ].filter(Boolean).join(', ')
}

function autoRepair(state: State): string {
  const { xivLauncher } = state
  if (xivLauncher.status === 'found') return xivLauncher.autoRepair ? 'On' : 'Off'
  if (xivLauncher.status === 'not-found') return 'XIVLauncher not found'
  return xivLauncher.status === 'unavailable' ? `Unavailable (${xivLauncher.message})` : 'Not checked'
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
      // Diagnostics may describe a UI snapshot from before another window's operation. It must never save that
      // snapshot over the live journal, even when all hashes match after a repair or a game-version change.
      drift = await checkHealth(platform, structuredClone(record), gameVersion, true, undefined, { persist: false })
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
    ...(record ? [`First-install choices: ${storedChoices(record)}`] : []),
    `Launch XIV with: ${state.launcher ? LAUNCH_LABELS[state.launcher] : 'None found'}`,
    `XIVLauncher auto-repair: ${autoRepair(state)}`,
    `Health check: ${health}`,
    ...(drift ? [`Drift: ${listed(drift.files, MAX_LISTED_DRIFT, (count) => `and ${count.toLocaleString('en')} more`)}`] : []),
    '',
  ]
  if (record) {
    const root = joinPath(record.gameFolder, 'game')
    // Config files and shipped presets are the player's to change; only that they differ is worth saying.
    const playerOwned = new Set([...record.recipe.ownedConfigs, ...record.recipe.shippedPresets].map((file) => fileKey(file.path)))
    const entries = Object.entries(record.files).sort(([a], [b]) => a.localeCompare(b))
    const mismatches: string[] = []
    const changed: string[] = []
    for (const [relative, expected] of entries) {
      let actual: string
      try {
        actual = await platform.hashFile(await platform.resolveGamePath(root, relative))
        if (actual === expected.sha256) continue
        if (playerOwned.has(fileKey(relative))) { changed.push(relative); continue }
      } catch (error) { actual = `Unavailable (${error instanceof Error ? error.message : String(error)})` }
      mismatches.push(`${relative}\n  Expected: ${expected.sha256}\n  Actual: ${actual}`)
    }
    const matching = entries.length - mismatches.length - changed.length
    lines.push(`File hashes (SHA-256): ${matching.toLocaleString('en')} of ${fileCount(entries.length)} match what Lucent deployed.`)
    lines.push(...mismatches.slice(0, MAX_LISTED_MISMATCHES))
    if (mismatches.length > MAX_LISTED_MISMATCHES) lines.push(`…and ${(mismatches.length - MAX_LISTED_MISMATCHES).toLocaleString('en')} more files differ.`)
    if (changed.length) lines.push(`Changed since deployed (the player’s own): ${listed(changed, MAX_LISTED_DRIFT, (count) => `and ${count.toLocaleString('en')} more`)}`)
  } else lines.push('File hashes (SHA-256): no deployment to check.')
  const report = withoutAccountName(lines.join('\n'))
  if (!folder) return report
  try {
    const path = await platform.resolveGamePath(joinPath(folder, 'game'), 'OptiScaler.log')
    // The newest lines that fit: the report has to paste into a GitHub issue whole.
    const log = withoutAccountName(await platform.readTextTail(path, 300)).split('\n')
    const section = (count: number) => `\n\nOptiScaler log (last ${count} line${count === 1 ? '' : 's'}):\n${log.slice(-count).join('\n')}`
    let count = log.length
    while (count > 0 && report.length + section(count).length > MAX_LENGTH) count--
    return report + (count ? section(count) : '\n\nOptiScaler log: left out, the report is already as long as a GitHub issue allows.')
  } catch (error) {
    if (error instanceof PlatformError && error.kind === 'not-found') return report
    return `${report}\n\n${withoutAccountName(`OptiScaler log: Unavailable (${error instanceof Error ? error.message : String(error)})`)}`
  }
}
