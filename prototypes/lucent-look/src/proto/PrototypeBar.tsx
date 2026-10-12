// PROTOTYPE switcher bar. Deliberately styled unlike any variant so it reads as tooling, not design.
import { useEffect } from 'react'
import { VARIANTS, type Params } from '../App'
import { GPUS, SCREENS, SCREEN_LABEL, type GpuKey, type MainScenario, type Screen } from '../lucent/data'

export type Wall = 'bloom' | 'dusk' | 'light'

const STATES: { key: MainScenario; label: string }[] = [
  { key: 'healthy', label: 'Healthy' },
  { key: 'drift', label: 'Drift → Repair' },
  { key: 'update', label: 'Update available' },
  { key: 'disabled', label: 'Disabled' },
  { key: 'custom', label: 'Custom profile' },
]

export function PrototypeBar({ params, setParams }: { params: Params; setParams: (p: Partial<Params>, reset?: boolean) => void }) {
  const i = VARIANTS.findIndex((v) => v.key === params.variant)
  const cycle = (d: number) => setParams({ variant: VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length].key })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable], [role="radiogroup"]')) return
      if (e.key === 'ArrowLeft') cycle(-1)
      if (e.key === 'ArrowRight') cycle(1)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  if (!import.meta.env.DEV) return null
  const v = VARIANTS[i]
  return (
    <div className="proto-bar" role="toolbar" aria-label="Prototype controls">
      <button onClick={() => cycle(-1)} aria-label="Previous variant">‹</button>
      <span className="proto-variant">
        <b>{v.key}</b> {v.name}
      </span>
      <button onClick={() => cycle(1)} aria-label="Next variant">›</button>
      <span className="proto-sep" />
      <label>
        Screen
        <select value={params.screen} onChange={(e) => setParams({ screen: e.target.value as Screen })}>
          {SCREENS.map((s) => (
            <option key={s} value={s}>
              {SCREEN_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <label>
        State
        <select value={params.state} onChange={(e) => setParams({ state: e.target.value as MainScenario, screen: 'main' })}>
          {STATES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        GPU
        <select value={params.gpu} onChange={(e) => setParams({ gpu: e.target.value as GpuKey })}>
          {Object.values(GPUS).map((g) => (
            <option key={g.key} value={g.key}>
              {g.short} · {g.tierStatus}
            </option>
          ))}
        </select>
      </label>
      <label className="proto-check">
        <input type="checkbox" checked={params.existing} onChange={(e) => setParams({ existing: e.target.checked })} />
        GShade leftovers
      </label>
      {params.variant === 'D' && (
        <label>
          Crystal
          <select value={params.crystal} onChange={(e) => setParams({ crystal: e.target.value as Params['crystal'] }, false)}>
            <option value="ember">Ember (orange)</option>
            <option value="aether">Aether (blue)</option>
          </select>
        </label>
      )}
      <label>
        Wallpaper
        <select value={params.wall} onChange={(e) => setParams({ wall: e.target.value as Wall }, false)}>
          <option value="bloom">Blue</option>
          <option value="dusk">Warm</option>
          <option value="light">Light</option>
        </select>
      </label>
    </div>
  )
}
