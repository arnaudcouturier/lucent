import { ArrowDownToLine, Check, CircleCheck, Download, LoaderCircle, Snowflake, TriangleAlert, Wrench } from 'lucide-react'
import type { DeploymentPhase } from '../core/deployment'
import { statusCard, type StatusCard as Card } from '../core/statusCard'
import { Screen } from './Window'
import { useCore } from './useCore'
import { Path } from './Path'
import { ProfileSelector } from './Profiles'

export function FlowError() {
  const [{ error, notice, recoveryRequired, activity, busy, plan }, core] = useCore()
  return error ? <div className="card health-card is-failed" role="alert"><TriangleAlert size={16} strokeWidth={1.75} /><div className="scan-notice">
    <h2>{recoveryRequired ? 'Recovery needs attention' : activity.kind === 'review' ? 'Deployment didn’t finish' : 'Couldn’t continue'}</h2>
    <p>{error}</p>
    {(activity.kind === 'scan' || recoveryRequired) && <button className="btn" disabled={busy} onClick={() => void core.scan()}>{recoveryRequired ? 'Try recovery again' : 'Scan again'}</button>}
    {activity.kind === 'review' && <button className="btn" disabled={busy || !plan || !!plan.blockedPaths.length} onClick={() => void core.deploy()}>Try again</button>}
  </div></div> : notice ? <div className="callout is-notice" role="status"><CircleCheck size={14} strokeWidth={1.75} /><span>{notice}</span></div> : null
}

export function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export function ReviewScreen() {
  const [{ plan, gameFolder, graphics, busy, error }, core] = useCore()
  if (!plan) return null
  const required = graphics.status === 'found' && graphics.tier?.requiresReShade
  return <Screen title="Review" sub="Here’s what Lucent will put in your game folder.">
    {gameFolder.status === 'found' && <div className="destination"><span>Game folder</span><Path path={gameFolder.path} /></div>}
    <dl className="card plan-numbers">
      <div><dt>Files backed up</dt><dd>{plan.counts.backedUp}</dd></div>
      <div><dt>Files added</dt><dd>{plan.counts.added}</dd></div>
      <div><dt>Download</dt><dd>{sizeLabel(plan.downloadSize)}</dd></div>
    </dl>
    <label className="card option-row">
      <input type="checkbox" checked={plan.includeReShade} disabled={!!required || busy} onChange={(e) => void core.review(e.target.checked)} />
      <span><strong>Include ReShade</strong><small>{required ? 'Required for your tier.' : 'Shaders and presets, ready when you want them.'}</small></span>
      {required && <span className="option-required">Included</span>}
    </label>
    {!!plan.existingSetups.length && <p className="screen-note">Files backed up include your existing setup: {new Intl.ListFormat('en').format(plan.existingSetups.map((s) => s.label))}. Uninstall brings it back.</p>}
    <p className="screen-note">{plan.includeReShade ? 'All presets are included. You choose a look in game; none is active by default.' : 'ReShade, shaders and presets will be left out.'}</p>
    {!!plan.blockedPaths.length && <p className="callout" role="alert"><TriangleAlert size={14} /><span>These user files would be replaced: {plan.blockedPaths.join(', ')}. Move them aside before installing, then run Scan again.</span></p>}
    <FlowError />
    <footer className="screen-actions">
      <button className="btn is-ghost" disabled={busy} onClick={() => core.backToProfile()}>Back</button>
      {!error && <button className="btn is-primary" disabled={busy || !!plan.blockedPaths.length} onClick={() => void core.deploy()}><Download size={14} />Install</button>}
    </footer>
  </Screen>
}

const PHASES: { key: DeploymentPhase; label: string; description: string }[] = [
  { key: 'downloading', label: 'Downloading', description: 'Every file is checked before it reaches your game.' },
  { key: 'backing-up', label: 'Backing up', description: 'Saving each file before a step changes it.' },
  { key: 'applying', label: 'Applying', description: 'Putting the tested content in place.' },
  { key: 'checking', label: 'Checking', description: 'Confirming the deployed files match their hashes.' },
]
export function InstallScreen() {
  const [{ deploymentProgress, activity }] = useCore()
  const progress = activity.kind === 'deploying' ? activity.progress : 0
  const phase = PHASES.findIndex((p) => p.key === deploymentProgress?.phase)
  return <Screen title="Installing" sub="Keep Lucent open while it prepares your game.">
    <div className="card install-progress">
      <div className="progress-heading"><span>{PHASES[Math.max(0, phase)].label}</span><span className="mono">{Math.round(progress * 100)}%</span></div>
      <progress max={1} value={progress} aria-label="Installation progress" />
      <p>{PHASES[Math.max(0, phase)].description}</p>
      {deploymentProgress?.file && <Path path={deploymentProgress.file} />}
    </div>
    <ol className="install-phases" aria-live="polite">{PHASES.map((p, i) => <li key={p.key} className={i === phase ? 'is-current' : i < phase ? 'is-complete' : ''}>
      {i < phase ? <Check size={14} /> : i === phase ? <LoaderCircle size={14} className="spin" /> : <span className="phase-dot" />}{p.label}
    </li>)}</ol>
  </Screen>
}

export function DoneScreen() {
  const [{ hotkeys, deployment }, core] = useCore()
  return <Screen title="You’re ready" sub="Lucent is in place. Open XIV when you’re ready to play.">
    <div className="card hotkeys">{hotkeys.map((hint) => <div className="hotkey" key={hint.key}><kbd>{hint.key}</kbd><span>{hint.description}</span></div>)}</div>
    {deployment?.includeReShade && <p className="screen-note">No preset is active. Press Home in game to choose one.</p>}
    <footer className="screen-actions"><button className="btn is-primary" onClick={() => core.finish()}>Done<Check size={14} /></button></footer>
  </Screen>
}

export function MainScreen() {
  const [{ gameFolder }] = useCore()
  return <Screen title="Your game" sub="Your graphics, kept in place.">
    <StatusCard />
    <FlowError />
    <ProfileSelector />
    <EnabledRow />
    {gameFolder.status === 'found' && <div className="destination main-destination"><span>Game folder</span><Path path={gameFolder.path} /></div>}
  </Screen>
}

/** The master switch: Disabled leaves the deployment's files in place but inactive. */
function EnabledRow() {
  const [{ activity, busy, recoveryRequired }, core] = useCore()
  if (activity.kind !== 'deployment') return null
  return <label className="card option-row enabled-row">
    <input type="checkbox" role="switch" checked={activity.enabled} disabled={busy || recoveryRequired} onChange={(e) => void core.setEnabled(e.target.checked)} />
    <span><strong>Enabled</strong><small>{activity.enabled ? 'Lucent is active in game.' : 'Files stay in place, but the game runs as if vanilla.'}</small></span>
  </label>
}

const OPERATION_LABEL = { deploy: 'Installing', repair: 'Repairing', update: 'Updating', rollback: 'Rolling back', 'app-update': 'Updating Lucent' } as const

/** Renders exactly the one state the core's priority function picks. */
export function StatusCard() {
  const [state] = useCore()
  const card = statusCard(state)
  if (!card) return null
  return <div className="card status-card">
    <StatusCardContent card={card} />
    {card.caution && <p className="known-broken" role="status"><TriangleAlert size={14} /><span>{card.caution}</span></p>}
  </div>
}

function StatusCardContent({ card }: { card: Card }) {
  const [state, core] = useCore()
  if (card.kind === 'busy') return <div className="health-card is-busy" role="status">
    <LoaderCircle size={20} className="spin" />
    <div className="health-body"><h2>{OPERATION_LABEL[card.operation]}…</h2>
      <progress max={1} value={card.progress} aria-label={`${OPERATION_LABEL[card.operation]} progress`} /></div>
  </div>
  if (card.kind === 'drift') return <div className="health-card is-drift" role="alert">
    <TriangleAlert size={20} />
    <div className="health-body"><h2>{card.files === 1 ? '1 file needs repair' : `${card.files} files need repair`}</h2>
      <p>{card.patch ? `Game patch ${card.patch} changed what Lucent deployed.` : 'Something changed or removed what Lucent deployed.'}</p></div>
    <button className="btn is-primary" disabled={state.busy || state.recoveryRequired} onClick={() => void core.repair()}><Wrench size={14} />Repair</button>
  </div>
  if (card.kind === 'app-update' || card.kind === 'update') {
    const app = card.kind === 'app-update'
    const notes = app ? card.notes : card.changelog
    const size = app ? card.size : card.downloadSize
    return <div className="health-card is-update" role="status">
      <ArrowDownToLine size={20} />
      <div className="health-body"><h2>{app ? 'Lucent' : 'Content'} {card.version} is available</h2>
        <ul className="changelog">{notes.map((line, index) => <li key={index}>{line}</li>)}</ul>
        <p className="update-size">{size ? `${sizeLabel(size)} to download` : 'Nothing to download'}. {app ? 'Lucent will reopen when the update is ready.' : 'Your profile and Enabled stay as they are.'}</p>
        <footer className="update-actions">
          <button className="btn is-ghost" disabled={state.busy} onClick={() => void (app ? core.skipAppUpdate() : core.skipUpdate())}>Skip</button>
          <button className="btn is-primary" disabled={state.busy || state.recoveryRequired} onClick={() => void (app ? core.updateApp() : core.update())}><Download size={14} />Update</button>
        </footer></div>
    </div>
  }
  if (card.kind === 'disabled') return <div className="health-card is-disabled">
    <Snowflake size={20} />
    <div className="health-body"><h2>Disabled</h2><p>Lucent’s files are in place but inactive. The game runs as if vanilla.</p></div>
  </div>
  return <div className="health-card is-healthy">
    <CircleCheck size={20} />
    <div className="health-body"><h2>Healthy</h2><p>All deployed files match the tested content.</p></div>
  </div>
}
