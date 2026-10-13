import { describe, expect, it } from 'vitest'
import { createCore, type Activity } from './core'
import { crystalState } from './crystal'
import { createFakePlatform } from '../platform/fake'
import { MACHINES } from '../platform/fixtures'

const AN_UPDATE = { version: '2026.11.02', changelog: ['Sharper Neural Rendering.'], downloadSize: 12 }

describe('The crystal reflects the core state', () => {
  const stateFor = (activity: Activity) => ({ ...createCore(createFakePlatform()).getState(), activity })

  it('shows scanning glass while Scan finds the game folder', async () => {
    const platform = createFakePlatform(MACHINES.steam)
    const core = createCore(platform)
    platform.hold()

    const scanning = core.scan()
    expect(crystalState(core.getState())).toEqual({ mode: 'scan', fill: 0 })
    platform.release()
    await scanning
    expect(crystalState(core.getState())).toEqual({ mode: 'scan', fill: 0 })
  })

  it.each(['profile', 'review'] as const)('shows unlit glass during %s', (kind) => {
    expect(crystalState(stateFor({ kind }))).toEqual({ mode: 'glass', fill: 0 })
  })

  it('fills with light as deployment advances, clamping progress at the ends', () => {
    expect(crystalState(stateFor({ kind: 'deploying', progress: 0.35 }))).toEqual({ mode: 'fill', fill: 0.35 })
    expect(crystalState(stateFor({ kind: 'deploying', progress: -0.1 }))).toEqual({ mode: 'fill', fill: 0 })
    expect(crystalState(stateFor({ kind: 'deploying', progress: 1.1 }))).toEqual({ mode: 'fill', fill: 1 })
  })

  it('lights up on Done and for a healthy deployment', () => {
    expect(crystalState(stateFor({ kind: 'done' }))).toEqual({ mode: 'lit', fill: 1 })
    expect(crystalState(stateFor({ kind: 'deployment', enabled: true, drift: null, update: null, tierChange: null, operation: null })))
      .toEqual({ mode: 'lit', fill: 1 })
  })

  it('announces an available update with a pulse ring', () => {
    expect(crystalState(stateFor({ kind: 'deployment', enabled: true, drift: null, update: AN_UPDATE, tierChange: null, operation: null })))
      .toEqual({ mode: 'update', fill: 1 })
  })

  it('shows drift ahead of an update announcement', () => {
    expect(crystalState(stateFor({ kind: 'deployment', enabled: true, drift: { files: ['winmm.dll'], patch: null }, update: AN_UPDATE, tierChange: null, operation: null })))
      .toEqual({ mode: 'drift', fill: 1 })
  })

  it('offers a tier switch with the update pulse', () => {
    expect(crystalState(stateFor({ kind: 'deployment', enabled: true, drift: null, update: null, tierChange: { gpu: 'AMD Radeon RX 7900 XTX', from: 'RTX 30/40', to: 'Radeon' }, operation: null })))
      .toEqual({ mode: 'update', fill: 1 })
  })

  it('warns like drift when the game folder is missing', () => {
    const state = { ...stateFor({ kind: 'deployment', enabled: true, drift: null, update: AN_UPDATE, tierChange: null, operation: null }), gameFolder: { status: 'missing' as const, path: 'D:\XIV' } }
    expect(crystalState(state)).toEqual({ mode: 'drift', fill: 1 })
  })

  it.each(['repair', 'update', 'rollback', 'tier'] as const)('spins fast during %s even when drift and an update remain', (operation) => {
    expect(crystalState(stateFor({ kind: 'deployment', enabled: true, drift: { files: ['winmm.dll'], patch: null }, update: AN_UPDATE, tierChange: null, operation })))
      .toEqual({ mode: 'busy', fill: 1 })
  })

  it.each([null, 'repair', 'update', 'rollback'] as const)('stays frozen steel when Disabled, including during %s', (operation) => {
    expect(crystalState(stateFor({ kind: 'deployment', enabled: false, drift: { files: ['winmm.dll'], patch: null }, update: AN_UPDATE, tierChange: null, operation })))
      .toEqual({ mode: 'disabled', fill: 0 })
  })
})
