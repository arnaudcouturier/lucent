// The Mods section: a starter set of Dalamud plugins that Lucent adds once, and Penumbra mods it links to. It stands apart from
// the DLSS 5 and ReShade setup: no game folder is needed, and nothing here is kept up to date by Lucent afterwards.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRight, Check, Download, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react'
import { MOD_FOLDER_FIRST, dalamudMessage, modFolderNote, modInstalled, pluginStatus, pluginsToAdd, reposToAdd, type PluginStatus, type SeedOutcome, type StarterSetScan } from '../core/starterSet'
import { heliosphereModUrl, type StarterMod, type StarterPlugin, type StarterSet } from '../shared/starterSet'
import { FlowError } from './DeploymentScreens'
import { Path } from './Path'
import { focusHeld, focusLost, returnFocus } from './focus'
import { useCore } from './useCore'
import { Screen, useSection } from './Window'

export function ModsScreen() {
  const [state, core] = useCore()
  const { setSection } = useSection()
  const { starterSet, manifest } = state
  // The manifest arrives with Scan; the section reads the machine again whenever it opens or the manifest changes.
  useEffect(() => { void core.refreshStarterSet() }, [core, manifest.status])
  const fromSetup = state.activity.kind !== 'deployment'
  return <Screen title="Mods" sub="A starter set of plugins for Dalamud and mods for Penumbra. Lucent adds the plugins once and links to the mods; after that they’re yours."
    actions={fromSetup ? <button className="btn is-ghost" onClick={() => setSection('home')}>Back to setup</button> : undefined}>
    <FlowError />
    {starterSet.status === 'idle' || starterSet.status === 'loading' ? <p className="screen-note" role="status">Looking at your Dalamud setup…</p>
      : starterSet.status === 'unavailable' ? <NoticeCard text={starterSet.message} />
      : starterSet.scan.dalamud.status !== 'ready'
        ? <NoticeCard text={dalamudMessage(starterSet.scan.dalamud)!} action={<button className="btn" disabled={state.busy} onClick={() => void core.refreshStarterSet()}><RefreshCw size={14} strokeWidth={1.75} />Check again</button>} />
        : <>
          <PluginsGroup set={starterSet.set} scan={starterSet.scan} progress={starterSet.progress} result={starterSet.result} />
          <ModsGroup set={starterSet.set} scan={starterSet.scan} />
        </>}
  </Screen>
}

function NoticeCard({ text, action }: { text: string; action?: ReactNode }) {
  return <div className="card health-card is-drift" role="status">
    <TriangleAlert size={16} strokeWidth={1.75} />
    <div className="health-body"><p>{text}</p></div>
    {action}
  </div>
}

const STATE_TEXT: Record<Exclude<PluginStatus, 'installed'>, string> = {
  available: 'Not installed',
  manual: 'Install it from /xlplugins',
  'repo-off': 'Its repository is off',
}

function PluginState({ status }: { status: PluginStatus }) {
  if (status === 'installed') return <span className="starter-state is-installed"><Check size={14} strokeWidth={2} aria-hidden />Installed</span>
  return <span className={`starter-state${status === 'repo-off' ? ' is-caution' : ''}`}>{STATE_TEXT[status]}</span>
}

function PluginsGroup({ set, scan, progress, result }: { set: StarterSet; scan: StarterSetScan; progress: string | null; result: SeedOutcome | null }) {
  const [state, core] = useCore()
  const [includeCore, setIncludeCore] = useState(true)
  const [extras, setExtras] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  // The dialog is unmounted rather than closed, so the browser doesn't give focus back to the button that opened it. When that button is
  // disabled again (an Add that left nothing to add), focus goes to the group's first control rather than to the top of the page.
  const opener = useRef<HTMLElement | null>(null)
  const firstControl = useRef<HTMLInputElement>(null)
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !confirming) {
      returnFocus(opener.current)
      if (focusLost(focusHeld(), document.activeElement, document.body)) firstControl.current?.focus()
    }
    wasOpen.current = confirming
  }, [confirming])
  const coreSet = set.plugins.filter((plugin) => plugin.group === 'core')
  const extraSet = set.plugins.filter((plugin) => plugin.group === 'extra')
  const toAdd = pluginsToAdd(set, scan, { core: includeCore, extras })
  const gameRunning = state.gameRunning !== false
  // The report is the core's `result`, so it outlives this screen; the next Add clears it.
  const add = async () => {
    await core.addPlugins(toAdd.map((plugin) => plugin.internalName))
    setConfirming(false)
  }
  const summary = toAdd.length ? `${toAdd.length === 1 ? '1 plugin' : `${toAdd.length} plugins`} to add` : 'There’s nothing left to add from what’s ticked.'
  return <section className="settings-group" aria-label="Plugins">
    <h2>Plugins</h2>
    <label className="card option-row settings-switch">
      <span><strong>Core plugins</strong><small>The Penumbra stack and a few visual add-ons. Lucent fetches each from its own repository.</small></span>
      <input ref={firstControl} type="checkbox" role="switch" checked={includeCore} disabled={state.busy} onChange={(e) => setIncludeCore(e.target.checked)} />
    </label>
    <ul className="card list starter-list" aria-label="Core plugins">
      {coreSet.map((plugin) => <PluginRow key={plugin.internalName} plugin={plugin} status={pluginStatus(set, scan, plugin)} dimmed={!includeCore} />)}
    </ul>
    {!!extraSet.length && <>
      <p className="starter-subhead">Optional extras</p>
      <ul className="card list starter-list" aria-label="Optional extras">
        {extraSet.map((plugin) => {
          const status = pluginStatus(set, scan, plugin)
          return <PluginRow key={plugin.internalName} plugin={plugin} status={status}
            control={status === 'available' ? <input type="checkbox" aria-label={`Add ${plugin.name}`} checked={extras.includes(plugin.internalName)} disabled={state.busy}
              onChange={(e) => setExtras(e.target.checked ? [...extras, plugin.internalName] : extras.filter((name) => name !== plugin.internalName))} /> : undefined} />
        })}
      </ul>
    </>}
    <div className="starter-actions">
      <span className="screen-note" role="status">{state.busy && progress ? progress : gameRunning && toAdd.length ? 'Close XIV to add plugins.' : summary}</span>
      <button className="btn is-primary" disabled={state.busy || gameRunning || !toAdd.length} onClick={(e) => { opener.current = e.currentTarget; setConfirming(true) }}>
        {state.busy ? <LoaderCircle size={14} strokeWidth={1.75} className="spin" /> : <Download size={14} strokeWidth={1.75} />}Add plugins…
      </button>
    </div>
    {result && !state.busy && <Report report={result} scan={scan} set={set} />}
    {confirming && <AddDialog plugins={toAdd} set={set} scan={scan} onAdd={add} onClose={() => setConfirming(false)} />}
  </section>
}

function PluginRow({ plugin, status, control, dimmed }: { plugin: StarterPlugin; status: PluginStatus; control?: ReactNode; dimmed?: boolean }) {
  return <li className={`starter-row${dimmed && status === 'available' ? ' is-dimmed' : ''}`}>
    <div className="starter-body">
      <strong>{plugin.name}</strong>
      <small>{plugin.summary} <span className="starter-by">By {plugin.author}.</span></small>
    </div>
    <PluginState status={status} />
    {control}
  </li>
}

/** The consent panel: what is about to be added, and each custom repository that comes with it. */
function AddDialog({ plugins, set, scan, onAdd, onClose }: { plugins: StarterPlugin[]; set: StarterSet; scan: StarterSetScan; onAdd: () => Promise<void>; onClose: () => void }) {
  const [state] = useCore()
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  const repos = reposToAdd(set, scan, plugins)
  return <dialog ref={ref} className="confirm starter-dialog" aria-labelledby="add-plugins-title" onCancel={(e) => { e.preventDefault(); if (!state.busy) onClose() }}>
    <h2 id="add-plugins-title">Add {plugins.length === 1 ? 'this plugin' : `these ${plugins.length} plugins`}?</h2>
    <p>Lucent downloads {plugins.length === 1 ? 'it' : 'them'} from the authors and places {plugins.length === 1 ? 'it' : 'them'} in Dalamud’s plugin folder. You launch XIV from XIVLauncher as usual and Dalamud loads {plugins.length === 1 ? 'it' : 'them'}.</p>
    <ul className="starter-names">{plugins.map((plugin) => <li key={plugin.internalName}>{plugin.name}</li>)}</ul>
    {!!repos.length && <div className="starter-warning" role="note">
      <strong><TriangleAlert size={14} strokeWidth={1.75} aria-hidden />Custom plugin {repos.length === 1 ? 'repository' : 'repositories'}</strong>
      <p>Lucent will add {repos.length === 1 ? 'this repository' : 'these repositories'} to Dalamud’s list. Dalamud doesn’t review what’s in {repos.length === 1 ? 'it' : 'them'}.</p>
      <ul>{repos.map((repo) => <li key={repo.id}><span>{repo.label} · {repo.author}</span><small className="mono">{repo.url}</small></li>)}</ul>
      <p>A plugin has full control of your PC, like any other program, and can crash the game or worse. Only continue if you trust these authors.</p>
    </div>}
    <footer className="confirm-actions">
      <button className="btn is-ghost" disabled={state.busy} onClick={onClose}>Cancel</button>
      <button className="btn is-primary" disabled={state.busy || state.gameRunning !== false} onClick={() => void onAdd()}>
        {state.busy ? <LoaderCircle size={14} strokeWidth={1.75} className="spin" /> : <Download size={14} strokeWidth={1.75} />}{state.busy ? 'Adding…' : 'Add plugins'}
      </button>
    </footer>
  </dialog>
}

/** What the last Add did: what was placed, what was left out and why, and what to do next. */
function Report({ report, scan, set }: { report: SeedOutcome; scan: StarterSetScan; set: StarterSet }) {
  const penumbra = report.placed.some((p) => p.name === 'Penumbra') && !scan.modDirectory
  // Lucent never writes a plugin's settings, so what the player still has to do in the game is said here.
  const setups = report.placed.flatMap((p) => { const setup = set.plugins.find((plugin) => plugin.name === p.name)?.setup; return setup ? [{ name: p.name, setup }] : [] })
  return <div className="card starter-report" role="status">
    {!!report.placed.length && <>
      <strong>Added {report.placed.length === 1 ? 'a plugin' : `${report.placed.length} plugins`}</strong>
      <ul>{report.placed.map((p) => <li key={p.name}><Check size={14} strokeWidth={2} aria-hidden />{p.name} <span className="mono">{p.version}</span></li>)}</ul>
      <small>Launch XIV from XIVLauncher with Dalamud on, and they load.{penumbra ? ' Penumbra asks for a mod folder the first time it runs; set one in its Settings tab.' : ''}</small>
      {!!setups.length && <>
        <strong>Then set up</strong>
        <ul>{setups.map((s) => <li key={s.name}><span>{s.name}: {s.setup}</span></li>)}</ul>
      </>}
    </>}
    {!!report.reposAdded.length && <small>Added {report.reposAdded.length === 1 ? 'a repository' : `${report.reposAdded.length} repositories`} to Dalamud’s list.</small>}
    {!!report.skipped.length && <>
      <strong className="is-caution">Left out</strong>
      <ul>{report.skipped.map((s) => <li className="is-skipped" key={s.name}><TriangleAlert size={14} strokeWidth={1.75} aria-hidden /><span>{s.name}: {s.reason}</span></li>)}</ul>
    </>}
    {!report.placed.length && !report.skipped.length && <small>Nothing needed adding.</small>}
  </div>
}

function ModsGroup({ set, scan }: { set: StarterSet; scan: StarterSetScan }) {
  const [state, core] = useCore()
  const folderNote = modFolderNote(scan)
  return <section className="settings-group" aria-label="Penumbra mods">
    <h2>Penumbra mods</h2>
    {!!folderNote && <p className="screen-note starter-note">{folderNote}</p>}
    {!!scan.modDirectory && <p className="screen-note starter-note">Looking in <Path path={scan.modDirectory} />.</p>}
    <ul className="card list starter-list" aria-label="Penumbra mods">
      {set.mods.map((mod) => <ModRow key={mod.id} mod={mod} installed={modInstalled(scan, mod)} needsFolder={!scan.modDirectory} busy={state.busy} onGet={() => void core.openLink(heliosphereModUrl(mod.id))} />)}
    </ul>
    <p className="screen-note starter-note">Lucent only links to these. Heliosphere’s one-click install works while XIV is open with the Heliosphere plugin and its one-click setting on; otherwise the mod’s page offers a file to import in Penumbra. Nothing is switched on for you.</p>
  </section>
}

function ModRow({ mod, installed, needsFolder, busy, onGet }: { mod: StarterMod; installed: boolean; needsFolder: boolean; busy: boolean; onGet: () => void }) {
  return <li className="starter-row">
    <div className="starter-body">
      <strong>{mod.name}{mod.nsfw && <span className="chip" title="Contains adult content">NSFW</span>}</strong>
      <small>{mod.summary ? `${mod.summary} ` : ''}<span className="starter-by">By {mod.author}.</span></small>
    </div>
    {installed ? <span className="starter-state is-installed"><Check size={14} strokeWidth={2} aria-hidden />Installed</span>
      : needsFolder ? <span className="starter-state">{MOD_FOLDER_FIRST}</span>
      : <button className="btn" disabled={busy} aria-label={`Get ${mod.name} on Heliosphere`} onClick={onGet}>Get on Heliosphere<ArrowUpRight size={14} strokeWidth={1.75} aria-hidden /></button>}
  </li>
}
