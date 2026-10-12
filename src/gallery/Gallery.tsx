// DEV ONLY: the state gallery. Renders each screen state from a real core on the fake Platform, so the
// look can be reviewed by eye without touching a game folder. Open with `?gallery` (or `?gallery=<state>`).
// The bar is deliberately styled unlike Lucent, so it reads as tooling.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createCore, type Activity, type Core } from '../core/core'
import { crystalState } from '../core/crystal'
import { createFakePlatform, type Machine } from '../platform/fake'
import { MACHINES, graphicsCard, manifestHost, machine, steam, steamGameFolder, vanillaGame, xivLauncher } from '../platform/fixtures'
import { App } from '../ui/App'
import { CoreContext } from '../ui/useCore'
import { Screen, Window } from '../ui/Window'
import './gallery.css'

const LONG_LIBRARY = 'E:\\Games\\Libraries\\Steam Library (fast NVMe drive)'

const scanned = (m: Machine) => async () => {
  const core = createCore(createFakePlatform(m))
  await core.scan()
  return core
}

interface GalleryState {
  key: string
  label: string
  setup: () => Promise<Core>
  preview?: { activity: Activity; description: string }
}

const crystalPreview = (key: string, label: string, activity: Activity, description: string): GalleryState => ({
  key: `crystal-${key}`, label: `Crystal · ${label}`, setup: scanned(MACHINES.steam), preview: { activity, description },
})
const deployment = (patch: Partial<Extract<Activity, { kind: 'deployment' }>> = {}): Activity => ({
  kind: 'deployment', enabled: true, health: 'healthy', updateAvailable: false, operation: null, ...patch,
})

const STATES: GalleryState[] = [
  {
    key: 'scanning',
    label: 'Scan · looking',
    async setup() {
      const platform = createFakePlatform(MACHINES.steam)
      platform.hold()
      const core = createCore(platform)
      void core.scan()
      return core
    },
  },
  { key: 'xivlauncher', label: 'Scan · found through XIVLauncher', setup: scanned(MACHINES.xivlauncher) },
  { key: 'steam', label: 'Scan · found in a Steam library', setup: scanned(MACHINES.steam) },
  { key: 'squareenix', label: 'Scan · found through the Square Enix launcher', setup: scanned(MACHINES.squareenix) },
  {
    key: 'long-path',
    label: 'Scan · found, long path',
    setup: scanned(machine(manifestHost(), graphicsCard(), steam({ libraries: [LONG_LIBRARY], game: LONG_LIBRARY }), vanillaGame(steamGameFolder(LONG_LIBRARY)))),
  },
  {
    key: 'no-version',
    label: 'Scan · found, no version file',
    setup: scanned(machine(manifestHost(), graphicsCard(), xivLauncher('D:\\XIV'), { files: { 'D:\\XIV\\game\\ffxiv_dx11.exe': 'MZ' } })),
  },
  { key: 'not-found', label: 'Scan · not found', setup: scanned(MACHINES.none) },
  { key: 'rtx-50', label: 'Scan · RTX 50, Community-verified', setup: scanned(machine(MACHINES.steam, graphicsCard('NVIDIA GeForce RTX 5090'))) },
  { key: 'rtx-20', label: 'Scan · RTX 20, Experimental', setup: scanned(machine(MACHINES.steam, graphicsCard('NVIDIA GeForce RTX 2080 SUPER'))) },
  { key: 'radeon', label: 'Scan · Radeon, Experimental', setup: scanned(machine(MACHINES.steam, graphicsCard('AMD Radeon RX 7900 XTX', 0x1002))) },
  { key: 'intel', label: 'Scan · Intel, Other', setup: scanned(machine(MACHINES.steam, graphicsCard('Intel Arc A770 Graphics', 0x8086))) },
  { key: 'schema-update', label: 'Scan · app update required', setup: scanned(machine(MACHINES.steam, manifestHost({ schemaVersion: 2 }))) },
  { key: 'invalid-manifest', label: 'Scan · invalid manifest', setup: scanned(machine(MACHINES.steam, manifestHost({ schemaVersion: 1, tiers: [] }))) },
  { key: 'manifest-offline', label: 'Scan · manifest unavailable', setup: scanned(machine(steam(), graphicsCard())) },
  { key: 'no-gpu', label: 'Scan · no hardware graphics card', setup: scanned(machine(MACHINES.steam, { gpus: [] })) },
  {
    key: 'rejected',
    label: 'Scan · picked a folder without the game',
    async setup() {
      const platform = createFakePlatform(MACHINES.none)
      const core = createCore(platform)
      await core.scan()
      platform.answerPicker('C:\\Users\\Player\\Downloads')
      await core.chooseGameFolder()
      return core
    },
  },
  crystalPreview('scan', 'Scan', { kind: 'scan' }, 'Glass with a line scanning the spire.'),
  crystalPreview('glass', 'Profile', { kind: 'profile' }, 'Unlit glass, slow spin, precessing gold rings and a gentle float.'),
  crystalPreview('review', 'Review', { kind: 'review' }, 'The same glass state as Performance profile.'),
  crystalPreview('fill', 'Deploying', { kind: 'deploying', progress: 0.5 }, 'Light fills the cluster from its base as deployment advances.'),
  crystalPreview('done', 'Done', { kind: 'done' }, 'The lit state after deployment completes.'),
  crystalPreview('lit', 'Healthy', deployment(), 'A lit spire with a slow spin, precessing rings and a gentle float.'),
  crystalPreview('update', 'Update available', deployment({ updateAvailable: true }), 'A pulse ring announces an available update.'),
  crystalPreview('repair', 'Repair running', deployment({ health: 'drift', operation: 'repair' }), 'The spire and rings move faster during repair.'),
  crystalPreview('busy-update', 'Update running', deployment({ updateAvailable: true, operation: 'update' }), 'The same fast spin during an update.'),
  crystalPreview('rollback', 'Rollback running', deployment({ operation: 'rollback' }), 'The same fast spin during rollback.'),
  crystalPreview('drift', 'Drift', deployment({ health: 'drift' }), 'Dark facets, a small ring stalled in place and a falling shard.'),
  crystalPreview('disabled', 'Disabled', deployment({ enabled: false }), 'Frozen steel rings and unlit glass.'),
  crystalPreview('disabled-repair', 'Disabled during repair', deployment({ enabled: false, health: 'drift', operation: 'repair' }), 'Disabled stays frozen during repair, update and rollback.'),
]

/** DEV ONLY: project future activities onto a real Scan core, without adding fixture setters to production. */
function previewActivity(source: Core, activity: Activity): Core {
  let previous = source.getState()
  let snapshot = { ...previous, activity }
  return { ...source, getState() {
    const current = source.getState()
    if (current !== previous) {
      previous = current
      snapshot = { ...current, activity }
    }
    return snapshot
  } }
}

export function Gallery() {
  const initial = new URLSearchParams(location.search).get('gallery')
  const [index, setIndex] = useState(Math.max(0, STATES.findIndex((s) => s.key === initial)))
  const [core, setCore] = useState<Core | null>(null)
  const [progress, setProgress] = useState(0.5)
  const performanceRef = useRef<HTMLOutputElement>(null)
  const state = STATES[index]
  const previewCore = useMemo(() => {
    if (!core || !state.preview) return core
    const activity = state.preview.activity.kind === 'deploying' ? { kind: 'deploying' as const, progress } : state.preview.activity
    return previewActivity(core, activity)
  }, [core, state, progress])

  useEffect(() => {
    const showCost = (event: Event) => {
      const { frames, mean, p95 } = (event as CustomEvent<{ frames: number; mean: number; p95: number }>).detail
      if (performanceRef.current) performanceRef.current.textContent = `${frames} draws · ${mean.toFixed(2)} ms mean · ${p95.toFixed(2)} ms p95`
    }
    document.addEventListener('crystal-performance', showCost)
    return () => document.removeEventListener('crystal-performance', showCost)
  }, [])

  useEffect(() => {
    let live = true
    const params = new URLSearchParams(location.search)
    params.set('gallery', state.key)
    history.replaceState(null, '', `?${params}`)
    void state.setup().then((c) => live && setCore(c))
    return () => {
      live = false
    }
  }, [state])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, select, textarea')) return
      if (e.key === 'ArrowLeft') setIndex((i) => (i - 1 + STATES.length) % STATES.length)
      if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % STATES.length)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      {previewCore && (
        <CoreContext.Provider value={previewCore} key={state.key}>
          {state.preview ? (
            <Window>
              <Screen title={state.label} sub="Crystal state preview · dev gallery">
                <div className="card crystal-preview">
                  <p>{state.preview.description}</p>
                  <p className="mono">State: {crystalState(previewCore.getState()).mode}</p>
                  {state.preview.activity.kind === 'deploying' && (
                    <label>
                      Deployment progress: {Math.round(progress * 100)}%
                      <input aria-label="Deployment progress" type="range" min="0" max="1" step="0.01" value={progress} onChange={(event) => setProgress(Number(event.target.value))} />
                    </label>
                  )}
                </div>
              </Screen>
            </Window>
          ) : <App />}
        </CoreContext.Provider>
      )}
      <div className="gallery-bar" role="toolbar" aria-label="State gallery">
        <b>Gallery</b>
        <select value={index} onChange={(e) => setIndex(Number(e.target.value))}>
          {STATES.map((s, i) => (
            <option key={s.key} value={i}>
              {s.label}
            </option>
          ))}
        </select>
        <span>← →</span>
        <label className="gallery-still">
          <input type="checkbox" checked={new URLSearchParams(location.search).has('crystal-still')} onChange={(event) => {
            const params = new URLSearchParams(location.search)
            if (event.target.checked) params.set('crystal-still', '')
            else params.delete('crystal-still')
            location.search = params.toString()
          }} />
          Still preview
        </label>
        {new URLSearchParams(location.search).has('crystal-perf') && <output ref={performanceRef} aria-label="Crystal draw cost">Measuring…</output>}
      </div>
    </>
  )
}
