import type { Activity, AppUpdate, ContentUpdate, State, TierChange } from './core'

/** The one state the main screen's status card shows. Later states slot into `statusCard`'s priority order. */
type CardState =
  | { kind: 'game-running' }
  | { kind: 'game-check-failed' }
  | { kind: 'busy'; operation: 'deploy' | 'app-update' | NonNullable<Extract<Activity, { kind: 'deployment' }>['operation']>; progress: number }
  | { kind: 'folder-missing'; path: string }
  | { kind: 'drift'; files: number; patch: string | null }
  | ({ kind: 'switch-tier' } & TierChange)
  | ({ kind: 'update' } & ContentUpdate)
  | ({ kind: 'app-update' } & AppUpdate)
  | { kind: 'disabled' }
  | { kind: 'healthy' }

export type StatusCard = CardState & { caution?: string }

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
  if (activity.drift) return { kind: 'drift', files: activity.drift.files.length, patch: activity.drift.patch }
  if (activity.tierChange) return { kind: 'switch-tier', ...activity.tierChange }
  if (state.appUpdate) return { kind: 'app-update', ...state.appUpdate }
  if (activity.update) return { kind: 'update', ...activity.update }
  if (!activity.enabled) return { kind: 'disabled' }
  return { kind: 'healthy' }
}
