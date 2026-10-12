// PROTOTYPE: in-memory state shared by all variants. No persistence, no real logic.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CONTENT_VERSION,
  CUSTOM,
  GPUS,
  HOTKEYS,
  NEXT_CONTENT_VERSION,
  reviewNumbers,
  type GpuKey,
  type MainScenario,
  type ProfileKey,
  type Screen,
} from './data'

export interface Scenario {
  gpu: GpuKey
  existing: boolean
  state: MainScenario
}

export type Health = 'healthy' | 'drift' | 'update'
export type Busy = null | 'repair' | 'update'

function initial(s: Scenario) {
  return {
    profile: (s.state === 'custom' ? 'custom' : 'balanced') as ProfileKey | 'custom',
    enabled: s.state !== 'disabled',
    health: (s.state === 'drift' ? 'drift' : s.state === 'update' ? 'update' : 'healthy') as Health,
  }
}

export function useLucentState(scenario: Scenario, screen: Screen, setScreen: (s: Screen) => void) {
  const gpu = GPUS[scenario.gpu]
  const init = initial(scenario)
  const [profile, setProfileRaw] = useState<ProfileKey | 'custom'>(init.profile)
  const [enabled, setEnabled] = useState(init.enabled)
  const [health, setHealth] = useState<Health>(init.health)
  const [busy, setBusy] = useState<Busy>(null)
  const [busyProgress, setBusyProgress] = useState(0)
  const [includeReshade, setIncludeReshade] = useState(true)
  const [startMenu, setStartMenu] = useState(true)
  const [beta, setBeta] = useState(false)
  const [autoRepair, setAutoRepair] = useState(true)
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [contentVersion, setContentVersion] = useState(CONTENT_VERSION)
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const reshade = gpu.reshadeRequired || includeReshade
  const numbers = reviewNumbers(gpu, reshade, scenario.existing)

  const say = useCallback((text: string) => {
    window.clearTimeout(toastTimer.current)
    setToast({ id: Date.now(), text })
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }, [])

  const runBusy = useCallback((kind: Exclude<Busy, null>, ms: number, done: () => void) => {
    setBusy(kind)
    setBusyProgress(0)
    const start = performance.now()
    const tick = () => {
      const p = Math.min(1, (performance.now() - start) / ms)
      setBusyProgress(p)
      if (p < 1) requestAnimationFrame(tick)
      else {
        setBusy(null)
        done()
      }
    }
    requestAnimationFrame(tick)
  }, [])

  const actions = {
    go: setScreen,
    setProfile: (p: ProfileKey) => setProfileRaw(p),
    toggleEnabled: () => setEnabled((e) => !e),
    setIncludeReshade,
    setStartMenu,
    toggleBeta: () => setBeta((b) => !b),
    toggleAutoRepair: () => setAutoRepair((b) => !b),
    repair: () => runBusy('repair', 2200, () => { setHealth('healthy'); say('Repaired. No drift left.') }),
    openChangelog: () => setChangelogOpen(true),
    closeChangelog: () => setChangelogOpen(false),
    update: () => {
      setChangelogOpen(false)
      runBusy('update', 3200, () => {
        setHealth('healthy')
        setContentVersion(NEXT_CONTENT_VERSION)
        say(`Updated to content ${NEXT_CONTENT_VERSION}`)
      })
    },
    skip: () => {
      setChangelogOpen(false)
      setHealth('healthy')
      say(`Skipped ${NEXT_CONTENT_VERSION}. It stays in Versions.`)
    },
    menu: (item: string) => say(item === 'Copy diagnostics' ? 'Diagnostics copied' : `${item.replace('…', '')}: not mocked`),
    say,
  }

  const hotkeys = HOTKEYS.filter((h) => h.key !== 'Home' || reshade).map((h) =>
    h.key === 'Insert' && !gpu.neuralRendering ? { ...h, hint: 'Upscaling and frame generation settings' } : h,
  )

  return {
    scenario,
    screen,
    gpu,
    profile,
    customBase: CUSTOM.base,
    enabled,
    health,
    busy,
    busyProgress,
    includeReshade: reshade,
    startMenu,
    beta,
    autoRepair,
    changelogOpen,
    contentVersion,
    numbers,
    hotkeys,
    toast,
    ...actions,
  }
}

export type Lucent = ReturnType<typeof useLucentState>

const Ctx = createContext<Lucent | null>(null)

export function LucentProvider(props: { scenario: Scenario; screen: Screen; setScreen: (s: Screen) => void; children: ReactNode }) {
  const value = useLucentState(props.scenario, props.screen, props.setScreen)
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}

export const useLucent = () => useContext(Ctx)!

/** Resolves the four scan checks one by one. Returns how many are resolved (0..4). */
export function useScanProgress(active = true, stepMs = 700, startDelay = 500) {
  const [resolved, setResolved] = useState(0)
  useEffect(() => {
    setResolved(0)
    if (!active) return
    const timers = [0, 1, 2, 3].map((i) => window.setTimeout(() => setResolved(i + 1), startDelay + stepMs * (i + 1)))
    return () => timers.forEach(window.clearTimeout)
  }, [active, stepMs, startDelay])
  return resolved
}

/** Fake install: 0..1 over `ms`, calls onDone once. */
export function useTimedProgress(ms: number, onDone?: () => void, active = true) {
  const [p, setP] = useState(0)
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    setP(0)
    if (!active) return
    let raf = 0
    let fired = false
    const start = performance.now()
    const tick = () => {
      // ease so the bar moves like a real download: fast start, slower middle, quick finish
      const t = Math.min(1, (performance.now() - start) / ms)
      const eased = t < 1 ? 1 - Math.pow(1 - t, 1.6) : 1
      setP(eased)
      if (t < 1) raf = requestAnimationFrame(tick)
      else if (!fired) {
        fired = true
        window.setTimeout(() => done.current?.(), 500)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ms, active])
  return p
}

/** Which install step is running at progress p, with the components being downloaded. */
export function installPhase(p: number, l: Lucent) {
  const steps = [
    { key: 'download', label: 'Downloading components', until: 0.72 },
    { key: 'backup', label: `Backing up ${l.numbers.backedUp} files`, until: 0.8 },
    { key: 'apply', label: `Applying content ${l.contentVersion}`, until: 0.95 },
    { key: 'check', label: 'Running a health check', until: 1 },
  ]
  const index = Math.max(0, steps.findIndex((s) => p < s.until || s.until === 1))
  const comps = l.numbers.components
  const total = l.numbers.downloadMb
  const dl = Math.min(1, p / 0.72)
  let acc = 0
  let current = comps[comps.length - 1]
  for (const c of comps) {
    acc += c.mb
    if (dl * total <= acc) {
      current = c
      break
    }
  }
  return { steps, index, current, downloadedMb: Math.round(dl * total), total }
}
