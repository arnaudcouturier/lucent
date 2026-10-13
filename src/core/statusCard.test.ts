import { expect, it } from 'vitest'
import type { Activity, State } from './core'
import { statusCard } from './statusCard'

const deployment = (patch: Partial<Extract<Activity, { kind: 'deployment' }>>): State =>
  ({ activity: { kind: 'deployment', enabled: true, drift: null, update: null, operation: null, ...patch }, deploymentProgress: null }) as State

const drift = { files: ['winmm.dll', 'ReShade64.dll'], patch: '2026.10.20.0000.0000' }

it('shows a repair in progress over the drift it is repairing', () => {
  expect(statusCard({ ...deployment({ drift, operation: 'repair' }), deploymentProgress: { phase: 'applying', progress: 0.5, file: 'winmm.dll' } }))
    .toEqual({ kind: 'busy', operation: 'repair', progress: 0.5 })
})

it('shows drift with its file count and patch over healthy', () => {
  expect(statusCard(deployment({ drift }))).toEqual({ kind: 'drift', files: 2, patch: '2026.10.20.0000.0000' })
})

it('shows healthy when nothing else applies', () => {
  expect(statusCard(deployment({}))).toEqual({ kind: 'healthy' })
})

it('shows the running game ahead of drift, updates and Disabled, but below an operation in progress', () => {
  const state = { ...deployment({ enabled: false, drift, update: { version: '2026.11.02', changelog: [], downloadSize: 12 } }), gameRunning: true }
  expect(statusCard(state)).toEqual({ kind: 'game-running' })
  expect(statusCard({ ...state, activity: { ...state.activity, operation: 'repair' } as Activity })).toMatchObject({ kind: 'busy' })
})

it('shows Disabled with no action when the deployment is off', () => {
  expect(statusCard(deployment({ enabled: false }))).toEqual({ kind: 'disabled' })
})

it('shows drift and an update ahead of Disabled', () => {
  const update = { version: '2026.11.02', changelog: ['Sharper Neural Rendering.'], downloadSize: 12 }
  expect(statusCard(deployment({ enabled: false, drift }))).toEqual({ kind: 'drift', files: 2, patch: '2026.10.20.0000.0000' })
  expect(statusCard(deployment({ enabled: false, update }))).toEqual({ kind: 'update', ...update })
})

it('shows deploying as busy, and no card before a deployment exists', () => {
  expect(statusCard({ activity: { kind: 'deploying', progress: 0.25 }, deploymentProgress: null } as unknown as State)).toEqual({ kind: 'busy', operation: 'deploy', progress: 0.25 })
  expect(statusCard({ activity: { kind: 'review' }, deploymentProgress: null } as unknown as State)).toBeNull()
})
