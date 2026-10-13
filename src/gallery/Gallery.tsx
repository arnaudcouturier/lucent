// DEV ONLY: the state gallery. Renders each screen state from a real core on the fake Platform, so the
// look can be reviewed by eye without touching a game folder. Open with `?gallery` (or `?gallery=<state>`).
// The bar is deliberately styled unlike Lucent, so it reads as tooling.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createCore, type Activity, type Core } from '../core/core'
import { crystalState } from '../core/crystal'
import { createFakePlatform, type Machine } from '../platform/fake'
import { MACHINES, graphicsCard, manifestHost, machine, nextContentHost, steam, steamGameFolder, vanillaGame, xivLauncher } from '../platform/fixtures'
import { App } from '../ui/App'
import { CoreContext } from '../ui/useCore'
import { Screen, Window } from '../ui/Window'
import { dataPaths, readDeployment, type DeploymentPhase } from '../core/deployment'
import { PlatformError } from '../core/platform'
import { appReleaseHost, APP_EXE_URL } from '../platform/appUpdateFixture'
import { NEXT_CONTENT, NEXT_MANIFEST } from '../platform/contentFixture'
import { MANIFEST_URL } from '../core/manifest'
import './gallery.css'

const AN_UPDATE = { version: '2026.11.02', changelog: ['OptiScaler 2 with sharper Neural Rendering.', 'Drops the example shader.'], downloadSize: 160 * 1024 ** 2 }
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
  kind: 'deployment', enabled: true, drift: null, update: null, tierChange: null, operation: null, ...patch,
})

const workflow = (stage: 'review' | 'done' | 'healthy', m = MACHINES.steam, includeReShade = true) => async () => {
  const core = await scanned(m)()
  await core.review(includeReShade)
  if (stage !== 'review') await core.deploy()
  if (stage === 'healthy') core.finish()
  return core
}
const installStage = (phase: DeploymentPhase) => async () => {
  const platform = createFakePlatform(MACHINES.steam)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await new Promise<void>((resolve) => {
    const unsubscribe = core.subscribe(() => {
      if (core.getState().deploymentProgress?.phase === phase) {
        platform.hold()
        unsubscribe()
        resolve()
      }
    })
    void core.deploy()
  })
  return core
}

const failedDeployment = async () => {
  const platform = createFakePlatform(MACHINES.steam)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  platform.downloadFile = async () => { throw new PlatformError('network', 'Connection lost') }
  await core.deploy()
  return core
}
const recoveredDeployment = (blocked = false) => async () => {
  const platform = createFakePlatform(MACHINES.steam)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  const folder = core.getState().gameFolder
  if (folder.status !== 'found') throw new Error('Gallery game folder missing')
  const record = (await readDeployment(platform, folder.path))!
  record.status = 'applying'
  await platform.writeText((await dataPaths(platform, folder.path)).record, JSON.stringify(record))
  if (blocked) platform.isGameRunning = async () => true
  const reopened = createCore(platform)
  await reopened.scan()
  return reopened
}

/** A game patch replaces OptiScaler's proxy DLL, optionally holding the repair midway. */
const patched = (stage: 'drift' | 'repairing') => async () => {
  const platform = createFakePlatform(MACHINES.steam)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  const folder = core.getState().gameFolder
  if (folder.status !== 'found') throw new Error('Gallery game folder missing')
  await platform.writeText(`${folder.path}\\game\\winmm.dll`, 'Patched')
  await platform.writeText(`${folder.path}\\game\\ffxivgame.ver`, '2026.10.20.0000.0000')
  const reopened = createCore(platform)
  await reopened.scan()
  if (stage === 'repairing') await new Promise<void>((resolve) => {
    const unsubscribe = reopened.subscribe(() => {
      if (reopened.getState().deploymentProgress?.phase === 'applying') { platform.hold(); unsubscribe(); resolve() }
    })
    void reopened.repair()
  })
  return reopened
}

/** The next content version is published after a deployment, optionally holding the update midway. */
const updateAvailable = (stage: 'update' | 'updating') => async () => {
  const m = machine(MACHINES.steam)
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  Object.assign(m.remoteText!, nextContentHost().remoteText)
  const reopened = createCore(platform)
  await reopened.scan()
  if (stage === 'updating') await new Promise<void>((resolve) => {
    const unsubscribe = reopened.subscribe(() => {
      if (reopened.getState().deploymentProgress?.phase === 'applying') { platform.hold(); unsubscribe(); resolve() }
    })
    void reopened.update()
  })
  return reopened
}

/** The player swaps their graphics card after deploying. */
const newGraphicsCard = async () => {
  const m = machine(MACHINES.steam)
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  m.gpus = graphicsCard('AMD Radeon RX 7900 XTX', 0x1002).gpus
  const reopened = createCore(platform)
  await reopened.scan()
  return reopened
}

/** The game folder is emptied or moved after deploying. */
const missingGameFolder = async () => {
  const platform = createFakePlatform(MACHINES.steam)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  const folder = core.getState().gameFolder
  if (folder.status !== 'found') throw new Error('Gallery game folder missing')
  for (const file of await platform.listFiles(folder.path)) await platform.removeFile(`${folder.path}\\${file}`)
  const reopened = createCore(platform)
  await reopened.scan()
  return reopened
}

const versionHistory = async () => {
  const m = machine(MACHINES.steam)
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  Object.assign(m.remoteText!, nextContentHost().remoteText)
  let reopened = createCore(platform)
  await reopened.scan()
  await reopened.update()
  const third = { ...NEXT_CONTENT, id: '2026.11.20', changelog: ['Neural Rendering refinements.'] }
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...NEXT_MANIFEST, versions: [...NEXT_MANIFEST.versions, third] })
  reopened = createCore(platform)
  await reopened.scan()
  await reopened.update()
  const fourth = { ...NEXT_CONTENT, id: '2026.12.01', changelog: ['A new content version you can apply later.'] }
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...NEXT_MANIFEST, versions: [...NEXT_MANIFEST.versions, third, fourth] })
  reopened = createCore(platform)
  await reopened.scan()
  await reopened.skipUpdate()
  return reopened
}

const knownBrokenContent = async () => {
  const m = machine(MACHINES.steam)
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  const folder = core.getState().gameFolder
  if (folder.status !== 'found') throw new Error('Gallery game folder missing')
  Object.assign(m.remoteText!, nextContentHost().remoteText)
  let reopened = createCore(platform)
  await reopened.scan()
  await reopened.update()
  // The caution is for pinned players, so roll back to the known-broken version first.
  const [first, ...rest] = NEXT_MANIFEST.versions
  await platform.writeText(`${folder.path}\\game\\ffxivgame.ver`, '2026.10.20.0000.0000')
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...NEXT_MANIFEST, versions: [{ ...first, knownBrokenGameVersions: ['2026.10.20.0000.0000'] }, ...rest] })
  reopened = createCore(platform)
  await reopened.scan()
  await reopened.applyVersion(first.id)
  return reopened
}

const appUpdateAvailable = (stage: 'app-update' | 'app-updating' | 'app-update-failed') => async () => {
  const m = machine(MACHINES.steam, appReleaseHost())
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  if (stage === 'app-updating') { platform.hold(); void core.updateApp() }
  if (stage === 'app-update-failed') {
    m.remoteText![APP_EXE_URL] = 'Corrupt download'
    await core.updateApp()
  }
  return core
}

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
  { key: 'existing-setup', label: 'Scan · existing setups found', setup: scanned(MACHINES.existing) },
  { key: 'not-found', label: 'Scan · not found', setup: scanned(MACHINES.none) },
  { key: 'rtx-50', label: 'Scan · RTX 50, Community-verified', setup: scanned(machine(MACHINES.steam, graphicsCard('NVIDIA GeForce RTX 5090'))) },
  { key: 'rtx-20', label: 'Scan · RTX 20, Experimental', setup: scanned(machine(MACHINES.steam, graphicsCard('NVIDIA GeForce RTX 2080 SUPER'))) },
  { key: 'radeon', label: 'Scan · Radeon, Experimental', setup: scanned(machine(MACHINES.steam, graphicsCard('AMD Radeon RX 7900 XTX', 0x1002))) },
  { key: 'intel', label: 'Scan · Intel, Other', setup: scanned(machine(MACHINES.steam, graphicsCard('Intel Arc A770 Graphics', 0x8086))) },
  { key: 'schema-update', label: 'Scan · app update required', setup: scanned(machine(MACHINES.steam, manifestHost({ schemaVersion: 3 }), appReleaseHost())) },
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
  { key: 'profile', label: 'Profile · Neural Rendering', async setup() {
    const core = await scanned(MACHINES.steam)()
    await core.continueSetup()
    return core
  } },
  { key: 'review', label: 'Review · ReShade included', setup: workflow('review') },
  { key: 'review-no-reshade', label: 'Review · ReShade excluded', setup: workflow('review', MACHINES.steam, false) },
  { key: 'review-radeon', label: 'Review · ReShade required', setup: workflow('review', machine(MACHINES.steam, graphicsCard('AMD Radeon RX 7900 XTX', 0x1002))) },
  { key: 'review-existing-setup', label: 'Review · existing setup replaced', setup: workflow('review', MACHINES.existing) },
  { key: 'review-user-file', label: 'Review · user file protected', setup: workflow('review', machine(MACHINES.xivlauncher, { files: { 'C:\\Games\\FFXIV\\game\\winmm.dll': 'User mod' } })) },
  { key: 'review-failed', label: 'Review · download failed', setup: failedDeployment },
  { key: 'scan-recovered', label: 'Scan · unfinished deployment recovered', setup: recoveredDeployment() },
  { key: 'scan-recovery-blocked', label: 'Scan · recovery needs attention', setup: recoveredDeployment(true) },
  ...(['downloading', 'backing-up', 'applying', 'checking'] as const).map((phase) => ({ key: `install-${phase}`, label: `Install · ${phase}`, setup: installStage(phase) })),
  { key: 'done', label: 'Done · both hotkeys', setup: workflow('done') },
  { key: 'done-no-reshade', label: 'Done · OptiScaler only', setup: workflow('done', MACHINES.steam, false) },
  { key: 'done-radeon', label: 'Done · FSR and ReShade', setup: workflow('done', machine(MACHINES.steam, graphicsCard('AMD Radeon RX 7900 XTX', 0x1002))) },
  { key: 'done-other', label: 'Done · ReShade only', setup: workflow('done', machine(MACHINES.steam, graphicsCard('Intel Arc A770', 0x8086))) },
  { key: 'healthy', label: 'Main · Healthy', setup: workflow('healthy') },
  { key: 'game-running', label: 'Main · XIV running', async setup() {
    const m = machine(MACHINES.steam)
    const core = await workflow('healthy', m)()
    m.gameRunning = true
    await core.refreshGameRunning()
    return core
  } },
  { key: 'review-game-running', label: 'Review · XIV running', setup: workflow('review', machine(MACHINES.steam, { gameRunning: true })) },
  { key: 'disabled', label: 'Main · Disabled', async setup() {
    const core = await workflow('healthy')()
    await core.setEnabled(false)
    return core
  } },
  { key: 'drift', label: 'Main · Drift after a game patch', setup: patched('drift') },
  { key: 'repairing', label: 'Main · Repairing', setup: patched('repairing') },
  { key: 'new-gpu', label: 'Main · New graphics card', setup: newGraphicsCard },
  { key: 'folder-missing', label: 'Main · Game folder missing', setup: missingGameFolder },
  { key: 'update', label: 'Main · Content update available', setup: updateAvailable('update') },
  { key: 'updating', label: 'Main · Updating', setup: updateAvailable('updating') },
  { key: 'versions', label: 'Main · Versions and rollback', setup: versionHistory },
  { key: 'known-broken', label: 'Main · Known-broken content warning', setup: knownBrokenContent },
  { key: 'app-update', label: 'Main · App update available', setup: appUpdateAvailable('app-update') },
  { key: 'app-updating', label: 'Main · Updating Lucent', setup: appUpdateAvailable('app-updating') },
  { key: 'app-update-failed', label: 'Main · App hash mismatch', setup: appUpdateAvailable('app-update-failed') },
  { key: 'uninstalled', label: 'Scan · after uninstall', async setup() {
    const core = await workflow('healthy')()
    await core.uninstall()
    return core
  } },
  crystalPreview('scan', 'Scan', { kind: 'scan' }, 'Glass with a line scanning the spire.'),
  crystalPreview('glass', 'Profile', { kind: 'profile' }, 'Unlit glass, slow spin, precessing gold rings and a gentle float.'),
  crystalPreview('review', 'Review', { kind: 'review' }, 'The same glass state as Performance profile.'),
  crystalPreview('fill', 'Deploying', { kind: 'deploying', progress: 0.5 }, 'Light fills the cluster from its base as deployment advances.'),
  crystalPreview('done', 'Done', { kind: 'done' }, 'The lit state after deployment completes.'),
  crystalPreview('lit', 'Healthy', deployment(), 'A lit spire with a slow spin, precessing rings and a gentle float.'),
  crystalPreview('update', 'Update available', deployment({ update: AN_UPDATE }), 'A pulse ring announces an available update.'),
  crystalPreview('repair', 'Repair running', deployment({ drift: { files: ['winmm.dll'], patch: null }, operation: 'repair' }), 'The spire and rings move faster during repair.'),
  crystalPreview('busy-update', 'Update running', deployment({ update: AN_UPDATE, operation: 'update' }), 'The same fast spin during an update.'),
  crystalPreview('rollback', 'Rollback running', deployment({ operation: 'rollback' }), 'The same fast spin during rollback.'),
  crystalPreview('drift', 'Drift', deployment({ drift: { files: ['winmm.dll'], patch: null } }), 'Dark facets, a small ring stalled in place and a falling shard.'),
  crystalPreview('disabled', 'Disabled', deployment({ enabled: false }), 'Frozen steel rings and unlit glass.'),
  crystalPreview('disabled-repair', 'Disabled during repair', deployment({ enabled: false, drift: { files: ['winmm.dll'], patch: null }, operation: 'repair' }), 'Disabled stays frozen during repair, update and rollback.'),
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
