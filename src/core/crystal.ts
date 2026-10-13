import type { State } from './core'

export type CrystalMode = 'scan' | 'glass' | 'fill' | 'lit' | 'update' | 'busy' | 'drift' | 'disabled'

export interface CrystalState {
  mode: CrystalMode
  /** Deployment progress, from 0 to 1. */
  fill: number
}

/** The crystal's status light is a projection of the core, never independent UI state. */
export function crystalState(state: Readonly<State>): CrystalState {
  if (state.activity.kind === 'deployment' && !state.activity.enabled) return { mode: 'disabled', fill: 0 }
  if (state.appUpdateProgress != null) return { mode: 'busy', fill: 1 }
  if (state.activity.kind === 'deployment' && state.activity.operation !== null) return { mode: 'busy', fill: 1 }
  if (state.activity.kind === 'deployment' && state.activity.drift) return { mode: 'drift', fill: 1 }
  if ((state.activity.kind === 'deployment' || state.activity.kind === 'scan') && state.appUpdate
    || state.activity.kind === 'deployment' && state.activity.update) return { mode: 'update', fill: 1 }
  if (state.activity.kind === 'done' || state.activity.kind === 'deployment') return { mode: 'lit', fill: 1 }
  if (state.activity.kind === 'deploying') return { mode: 'fill', fill: Math.min(1, Math.max(0, state.activity.progress)) }
  if (state.activity.kind === 'profile' || state.activity.kind === 'review') return { mode: 'glass', fill: 0 }
  return { mode: 'scan', fill: 0 }
}
