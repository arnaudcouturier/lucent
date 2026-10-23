import type { Activity, AppUpdate, ContentUpdate, State, TierChange } from './core'
import type { Drift } from './health'

/** The one state the main screen's status card shows. Later states slot into `statusCard`'s priority order. */
type CardState =
  | { kind: 'game-running' }
  | { kind: 'game-check-failed' }
  | { kind: 'busy'; operation: 'deploy' | 'app-update' | NonNullable<Extract<Activity, { kind: 'deployment' }>['operation']>; progress: number }
  | { kind: 'folder-missing'; path: string }
  | ({ kind: 'drift'; files: number } & Pick<Drift, 'patch' | 'missing' | 'changed'>)
  | ({ kind: 'switch-tier' } & TierChange)
  | ({ kind: 'update' } & ContentUpdate)
  | ({ kind: 'app-update' } & AppUpdate)
  | { kind: 'disabled' }
  | { kind: 'healthy' }

export type StatusCard = CardState & { caution?: string }
/** An available app or content update: what `UpdateCard` and the Home's secondary update rows render. */
export type UpdateCardState = Extract<CardState, { kind: 'update' | 'app-update' }>

/** The first match wins. Scan can announce app releases; deployment cards also cover content and health. */
export function statusCard(state: Readonly<State>): StatusCard | null {
  const card = cardState(state)
  // Known-broken is advisory for pinned players; unpinned players are offered the next version instead.
  if (!card || !state.deployment?.pinned || state.gameFolder?.status !== 'found' || !state.gameFolder.version) return card
  const id = state.deployment.contentVersion
  const content = state.manifest?.status === 'ready' ? state.manifest.manifest.versions.find((v) => v.id === id) : null
  const knownBroken = content ? content.knownBrokenGameVersions : state.deployment.cachedVersions?.find((v) => v.content.id === id)?.content.knownBrokenGameVersions
  return knownBroken?.includes(state.gameFolder.version)
    ? { ...card, caution: `Content ${id} is known broken on game ${state.gameFolder.version}. You can choose another version in Versions.` } : card
}

/** An update the primary card (drift, game-running...) would otherwise hide outright. Home shows each as a
    slim row beside the primary card instead; Review and Versions are unaffected, and keep the one card
    `statusCard` returns. Suppressed the same way `statusCard` suppresses updates: while something is busy, the
    game folder is missing, or a tier switch is pending, acting on anything else isn't safe yet. */
export function secondaryUpdates(state: Readonly<State>): UpdateCardState[] {
  const primary = cardState(state)
  if (!primary || primary.kind === 'busy') return []
  // Drift and the running game outrank both, so the state itself says whether the folder is missing or a tier switch pending.
  if (state.gameFolder?.status === 'missing' || (state.activity.kind === 'deployment' && state.activity.tierChange)) return []
  const contentUpdate = state.activity.kind === 'deployment' ? state.activity.update : null
  const items: UpdateCardState[] = []
  if (state.appUpdate && primary.kind !== 'app-update') items.push({ kind: 'app-update', ...state.appUpdate })
  if (contentUpdate && primary.kind !== 'update') items.push({ kind: 'update', ...contentUpdate })
  return items
}

function cardState(state: Readonly<State>): CardState | null {
  const { activity } = state
  if (state.appUpdateProgress != null) return { kind: 'busy', operation: 'app-update', progress: state.appUpdateProgress }
  if (activity.kind === 'deploying') return { kind: 'busy', operation: 'deploy', progress: activity.progress }
  if (activity.kind === 'deployment' && activity.operation) return { kind: 'busy', operation: activity.operation, progress: state.deploymentProgress?.progress ?? 0 }
  if (state.gameRunning) return { kind: 'game-running' }
  if (state.gameRunning === null && !state.busy) return { kind: 'game-check-failed' }
  if (activity.kind === 'scan' && !state.recoveryRequired && state.appUpdate) return { kind: 'app-update', ...state.appUpdate }
  if (activity.kind !== 'deployment') return null
  if (state.gameFolder?.status === 'missing') return { kind: 'folder-missing', path: state.gameFolder.path }
  if (activity.drift) {
    const { files, patch, missing, changed } = activity.drift
    return { kind: 'drift', files: files.length, patch, missing, changed }
  }
  if (activity.tierChange) return { kind: 'switch-tier', ...activity.tierChange }
  if (state.appUpdate) return { kind: 'app-update', ...state.appUpdate }
  if (activity.update) return { kind: 'update', ...activity.update }
  if (!activity.enabled) return { kind: 'disabled' }
  return { kind: 'healthy' }
}
