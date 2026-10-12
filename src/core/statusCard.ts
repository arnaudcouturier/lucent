import type { Activity, State } from './core'

/** The one state the main screen's status card shows. Later states slot into `statusCard`'s priority order. */
export type StatusCard =
  | { kind: 'busy'; operation: 'deploy' | NonNullable<Extract<Activity, { kind: 'deployment' }>['operation']>; progress: number }
  | { kind: 'drift'; files: number; patch: string | null }
  | { kind: 'healthy' }

/** Follows the spec's priority table: the first match wins. Null outside a deployment. */
export function statusCard(state: Readonly<State>): StatusCard | null {
  const { activity } = state
  if (activity.kind === 'deploying') return { kind: 'busy', operation: 'deploy', progress: activity.progress }
  if (activity.kind !== 'deployment') return null
  if (activity.operation) return { kind: 'busy', operation: activity.operation, progress: state.deploymentProgress?.progress ?? 0 }
  if (activity.drift) return { kind: 'drift', files: activity.drift.files.length, patch: activity.drift.patch }
  return { kind: 'healthy' }
}
