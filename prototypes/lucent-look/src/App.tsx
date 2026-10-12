// PROTOTYPE: visual takes on Lucent (direction B), switchable via ?variant= and the bottom bar.
// Everything is fake data in memory. The window is a fixed 880x580 frameless Tauri window, simulated.
import { useEffect, useState, type ComponentType } from 'react'
import { LucentProvider, type Scenario } from './lucent/store'
import { GPUS, SCREENS, type GpuKey, type MainScenario, type Screen } from './lucent/data'
import { PrototypeBar, type Wall } from './proto/PrototypeBar'
import { Prism } from './variants/prism/Prism'
import { Rail } from './variants/rail/Rail'
import { Facet } from './variants/facet/Facet'
import { Ember } from './variants/ember/Ember'

export const WINDOW = { width: 880, height: 580 }

export const VARIANTS: { key: string; name: string; Component: ComponentType<{ params?: Params }> }[] = [
  { key: 'A', name: 'Prism', Component: Prism },
  { key: 'B', name: 'Rail', Component: Rail },
  { key: 'C', name: 'Facet', Component: Facet },
  { key: 'D', name: 'Ember', Component: Ember },
]

const MAIN_STATES: MainScenario[] = ['healthy', 'drift', 'update', 'disabled', 'custom']

function readParams() {
  const q = new URLSearchParams(location.search)
  const variant = VARIANTS.some((v) => v.key === q.get('variant')) ? q.get('variant')! : 'D'
  const screen = (SCREENS as string[]).includes(q.get('screen') ?? '') ? (q.get('screen') as Screen) : 'scan'
  const gpu = (q.get('gpu') ?? '') in GPUS ? (q.get('gpu') as GpuKey) : 'rtx4090'
  const existing = q.get('existing') === '1'
  const state = (MAIN_STATES as string[]).includes(q.get('state') ?? '') ? (q.get('state') as MainScenario) : 'healthy'
  const wall = (['bloom', 'dusk', 'light'] as string[]).includes(q.get('wall') ?? '') ? (q.get('wall') as Wall) : 'bloom'
  const crystal = q.get('crystal') === 'aether' ? ('aether' as const) : ('ember' as const)
  return { variant, screen, gpu, existing, state, wall, crystal }
}

export type Params = ReturnType<typeof readParams>

export function App() {
  const [params, setParamsState] = useState(readParams)
  const [resetKey, setResetKey] = useState(0)
  const [scale, setScale] = useState(1)

  const setParams = (patch: Partial<Params>, reset = true) => {
    setParamsState((p) => {
      const next = { ...p, ...patch }
      const q = new URLSearchParams()
      q.set('variant', next.variant)
      q.set('screen', next.screen)
      q.set('gpu', next.gpu)
      if (next.existing) q.set('existing', '1')
      q.set('state', next.state)
      if (next.wall !== 'bloom') q.set('wall', next.wall)
      if (next.crystal !== 'ember') q.set('crystal', next.crystal)
      history.replaceState(null, '', `?${q}`)
      return next
    })
    if (reset) setResetKey((k) => k + 1)
  }

  useEffect(() => {
    const fit = () => setScale(Math.min(1, (innerWidth - 32) / WINDOW.width, (innerHeight - 120) / WINDOW.height))
    fit()
    addEventListener('resize', fit)
    return () => removeEventListener('resize', fit)
  }, [])

  const V = VARIANTS.find((v) => v.key === params.variant)!
  const scenario: Scenario = { gpu: params.gpu, existing: params.existing, state: params.state }

  return (
    <div className={`desktop wall-${params.wall}`}>
      <div className="desktop-art" aria-hidden />
      <div className="stage" style={{ width: WINDOW.width, height: WINDOW.height, transform: `scale(${scale})` }}>
        <LucentProvider
          key={`${params.variant}-${resetKey}`}
          scenario={scenario}
          screen={params.screen}
          setScreen={(screen) => setParams({ screen }, false)}
        >
          <V.Component params={params} />
        </LucentProvider>
      </div>
      <PrototypeBar params={params} setParams={setParams} />
    </div>
  )
}
