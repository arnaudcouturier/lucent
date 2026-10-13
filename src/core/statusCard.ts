import type { Activity, AppUpdate, ContentUpdate, State } from './core'

/** The one state the main screen's status card shows. Later states slot into `statusCard`'s priority order. */
export type StatusCard =
  | { kind: 'busy'; operation: 'deploy' | 'app-update' | NonNullable<Extract<Activity, { kind: 'deployment' }>['operation']>; progress: number }
  | { kind: 'drift'; files: number; patch: string | null }
  | ({ kind: 'update' } & ContentUpdate)
  | ({ kind: 'app-update' } & AppUpdate)
  | { kind: 'disabled' }
  | { kind: 'healthy' }

/** The first match wins. Scan can announce app releases; deployment cards also cover content and health. */
export function statusCard(state: Readonly<State>): StatusCard | null {
  const { activity } = state
  if (state.appUpdateProgress != null) return { kind: 'busy', operation: 'app-update', progress: state.appUpdateProgress }
  if (activity.kind === 'scan' && !state.recoveryRequired && state.appUpdate) return { kind: 'app-update', ...state.appUpdate }
  if (activity.kind === 'deploying') return { kind: 'busy', operation: 'deploy', progress: activity.progress }
  if (activity.kind !== 'deployment') return null
  if (activity.operation) return { kind: 'busy', operation: activity.operation, progress: state.deploymentProgress?.progress ?? 0 }
  if (activity.drift) return { kind: 'drift', files: activity.drift.files.length, patch: activity.drift.patch }
  if (state.appUpdate) return { kind: 'app-update', ...state.appUpdate }
  if (activity.update) return { kind: 'update', ...activity.update }
  if (!activity.enabled) return { kind: 'disabled' }
  return { kind: 'healthy' }
}
