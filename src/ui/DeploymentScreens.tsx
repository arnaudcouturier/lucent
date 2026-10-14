import { Fragment, type ReactNode } from 'react'
import { ArrowDownToLine, BookOpen, Check, CircleCheck, Cpu, Download, ExternalLink, FolderX, LoaderCircle, ScanSearch, Search, Snowflake, TriangleAlert, Wrench } from 'lucide-react'
import { GUIDE_URL, type KeyBinding } from '../core/hotkeys'
import type { DeploymentPhase } from '../core/deployment'
import { statusCard, type StatusCard as Card } from '../core/statusCard'
import { Screen } from './Window'
import { useCore } from './useCore'
import { Path } from './Path'
import { EasedNumber, ProgressBar, percentLabel } from './Progress'
import { gameActionsAvailable } from '../core/gameAccess'
import { sizeLabel } from '../core/format'
import { frameGenerationLabel, hdrLabel } from '../core/choices'
import { frameGenerationDescription } from '../core/frameGeneration'
import type { HdrMode } from '../shared/manifest'

export function FlowError() {
  const [state, core] = useCore()
  const { error, notice, recoveryRequired, activity, busy, plan } = state
  return error ? <div className="card health-card is-failed" role="alert"><TriangleAlert size={16} strokeWidth={1.75} /><div className="scan-notice">
    <h2>{recoveryRequired ? 'Recovery needs attention' : activity.kind === 'review' ? 'Deployment didn’t finish' : 'Couldn’t continue'}</h2>
    <p>{error}</p>
    {(activity.kind === 'scan' || recoveryRequired) && <button className="btn" disabled={busy} onClick={() => void core.scan()}>{recoveryRequired ? 'Try recovery again' : 'Scan again'}</button>}
    {activity.kind === 'review' && <button className="btn" disabled={!gameActionsAvailable(state) || !plan} onClick={() => void core.deploy()}>Try again</button>}
  </div></div> : notice ? <div className="callout is-notice" role="status"><CircleCheck size={14} strokeWidth={1.75} /><span>{notice}</span></div> : null
}

/** The line under Review's HDR choice: Auto HDR goes off for XIV, or the monitor had no HDR to offer. */
const hdrNote = (mode: HdrMode, hdrSupported: boolean) => mode !== 'off' ? <small>Windows Auto HDR is turned off for XIV.</small>
  : hdrSupported ? null : <small>XIV’s monitor doesn’t report HDR.</small>

/** Read-only: Scan listed the files, Profile made the choices. */
export function ReviewScreen() {
  const [state, core] = useCore()
  const { plan, gameFolder, graphics, busy, error, profiles, selfInstalled, addToStartMenu, screen } = state
  if (!plan) return null
  const required = graphics.status === 'found' && graphics.tier?.requiresReShade
  const profile = profiles.find((p) => p.id === plan.profile)
  return <Screen title="Review" sub="Here’s what Lucent will put in your game folder.">
    {gameFolder.status === 'found' && <div className="destination"><span>Game folder</span><Path path={gameFolder.path} /></div>}
    <dl className="card plan-numbers">
      <div><dt>Files backed up</dt><dd>{plan.counts.backedUp}</dd></div>
      <div><dt>Files added</dt><dd>{plan.counts.added}</dd></div>
      <div><dt>Download</dt><dd>{sizeLabel(plan.downloadSize)}</dd></div>
    </dl>
    <dl className="card summary-list">
      {profile && <div><dt>Profile</dt><dd>{profile.label}</dd></div>}
      {plan.frameGenerationMode && <div><dt>Frame generation</dt><dd>{frameGenerationLabel(plan.frameGenerationMode)}{screen && <small>{frameGenerationDescription(plan.frameGenerationMode, screen.frameCap, screen.refreshHz)}</small>}</dd></div>}
      {plan.hdrMode && <div><dt>HDR</dt><dd>{hdrLabel(plan.hdrMode)}{hdrNote(plan.hdrMode, !!screen?.hdrSupported)}</dd></div>}
      <div><dt>ReShade</dt><dd>{plan.includeReShade ? <>Included{required ? ' for your tier' : ''}<small>Every preset, none active until you pick one in game.</small></> : <>Left out<small>No shaders or presets.</small></>}</dd></div>
      {!selfInstalled && <div><dt>Start menu</dt><dd>{addToStartMenu ? 'Lucent will be added' : 'Not added'}</dd></div>}
    </dl>
    <StatusCard />
    <FlowError />
    <footer className="screen-actions is-pinned">
      <button className="btn is-ghost" disabled={busy} onClick={() => core.backToProfile()}>Back</button>
      {!error && <button className="btn is-primary" disabled={!gameActionsAvailable(state)} onClick={() => void core.deploy()}><Download size={14} />Install</button>}
    </footer>
  </Screen>
}

const PHASES: { key: DeploymentPhase; label: string }[] = [
  { key: 'downloading', label: 'Downloading' },
  { key: 'backing-up', label: 'Backing up' },
  { key: 'applying', label: 'Applying' },
  { key: 'checking', label: 'Checking' },
]

/** "245.1 MB of 662.0 MB" while downloading, "412 of 1,145 files" otherwise. */
function progressDetail(phase: DeploymentPhase, total: number) {
  return phase === 'downloading'
    ? (done: number) => `${sizeLabel(Math.round(done))} of ${sizeLabel(total)}`
    : (done: number) => `${Math.floor(done).toLocaleString('en')} of ${total.toLocaleString('en')} files`
}

export function InstallScreen() {
  const [{ deploymentProgress, activity, plan }] = useCore()
  const progress = activity.kind === 'deploying' ? activity.progress : 0
  // A folder with nothing to back up skips that stage, so it isn't listed.
  const phases = PHASES.filter((p) => p.key !== 'backing-up' || (plan?.counts.backedUp ?? 0) > 0)
  const phase = Math.max(0, phases.findIndex((p) => p.key === deploymentProgress?.phase))
  const current = phases[phase]
  const total = deploymentProgress?.total
  return <Screen title="Installing" sub="Keep Lucent open until it’s done.">
    <div className="card install-progress">
      <div className="progress-heading" aria-live="polite">
        <span className="progress-phase" key={current.key}>{current.label}</span>
        <EasedNumber className="progress-figure" value={progress} format={percentLabel} />
      </div>
      <ProgressBar value={progress} label="Installation progress" />
      <div className="progress-meta">
        {total ? <EasedNumber key={current.key} className="mono progress-count" value={deploymentProgress?.done ?? 0} format={progressDetail(current.key, total)} /> : <span>&nbsp;</span>}
      </div>
    </div>
    <ol className="install-stages" aria-label="Installation stages">{phases.map((p, i) => <li key={p.key} className={i === phase ? 'is-current' : i < phase ? 'is-complete' : ''} aria-current={i === phase ? 'step' : undefined}>
      <span className="install-stage-dot">{i < phase && <Check size={10} strokeWidth={3} />}</span>{p.label}
    </li>)}</ol>
  </Screen>
}

/** Keycaps for keys pressed together, such as Shift + F2. */
export function Keys({ keys }: { keys: string[] }) {
  return <span className="keys" aria-label={keys.join(' + ')}>{keys.map((key, i) => <Fragment key={i}>
    {i > 0 && <span className="keys-plus" aria-hidden>+</span>}<kbd aria-hidden>{key}</kbd>
  </Fragment>)}</span>
}

/** Where to read about every key and setting once the Done screen is gone. */
export function GuideLink({ children }: { children: ReactNode }) {
  const [{ busy }, core] = useCore()
  return <p className="guide-link"><BookOpen size={14} strokeWidth={1.75} /><span>{children}{' '}
    <button className="text-link" disabled={busy} onClick={() => void core.openLink(GUIDE_URL)}>Lucent guide<ExternalLink size={12} strokeWidth={1.75} /></button>
  </span></p>
}

/** Keys grouped by tool: keycaps (or "Not set"), the action, and what Lucent set when the player changed it since. */
export function KeyBindingList({ bindings }: { bindings: KeyBinding[] }) {
  const groups = (['OptiScaler', 'ReShade'] as const).map((tool) => ({ tool, rows: bindings.filter((b) => b.tool === tool) })).filter((g) => g.rows.length)
  return <div className="card hotkeys">{groups.map(({ tool, rows }) => <section key={tool} aria-label={`${tool} keys`}>
    <h2>{tool}</h2>
    {rows.map((b) => <div className="hotkey" key={b.action}>
      {b.keys ? <Keys keys={b.keys} /> : <span className="key-unset">Not set</span>}
      <span className="hotkey-action">{b.action}{b.hint && <small>{b.hint}</small>}
        {b.shipped !== undefined && <small className="key-changed">Changed in game · Lucent set {b.shipped ? b.shipped.join(' + ') : 'none'}</small>}</span>
    </div>)}
  </section>)}</div>
}

/** What the install set up, as the deployment record kept it. */
function ChosenSetup() {
  const [{ deployment, profiles }] = useCore()
  if (!deployment) return null
  const profile = profiles.find((p) => p.id === deployment.profile)
  const chosen = [
    profile && `${profile.label} profile`,
    deployment.frameGenerationMode && `Frame generation ${frameGenerationLabel(deployment.frameGenerationMode)}`,
    deployment.hdrMode && `HDR ${hdrLabel(deployment.hdrMode)}`,
    deployment.includeReShade && 'ReShade',
  ].filter((item): item is string => !!item)
  return <ul className="chosen-setup" aria-label="What Lucent set up">{chosen.map((item) => <li key={item}>{item}</li>)}</ul>
}

export function DoneScreen() {
  const [{ hotkeys, deployment }, core] = useCore()
  const presetKey = hotkeys.find((h) => h.tool === 'ReShade' && h.action === 'Menu')?.keys
  return <Screen title="You’re ready" sub="Lucent is in place. Open XIV and use these keys in game.">
    <ChosenSetup />
    <KeyBindingList bindings={hotkeys} />
    {deployment?.includeReShade && presetKey && <p className="screen-note">No preset is active. Press <Keys keys={presetKey} /> in game to choose one.</p>}
    <GuideLink>Every key and setting, explained, in the</GuideLink>
    <footer className="screen-actions is-pinned"><button className="btn is-primary" onClick={() => core.finish()}>Done<Check size={14} /></button></footer>
  </Screen>
}

/** The master switch: Disabled leaves the deployment's files in place but inactive. */
export function EnabledRow() {
  const [state, core] = useCore()
  const { activity } = state
  if (activity.kind !== 'deployment') return null
  return <label className="card option-row enabled-row settings-switch">
    <span><strong>Enabled</strong><small>{activity.enabled ? 'Lucent is active in game.' : 'Files stay in place, but the game runs as if vanilla.'}</small></span>
    <input type="checkbox" role="switch" checked={activity.enabled} disabled={!gameActionsAvailable(state)} onChange={(e) => void core.setEnabled(e.target.checked)} />
  </label>
}

const OPERATION_LABEL = { deploy: 'Installing', repair: 'Repairing', update: 'Updating', rollback: 'Rolling back', tier: 'Switching tier', 'gpu-refresh': 'Refreshing GPU settings', scan: 'Scanning', 'app-update': 'Updating Lucent' } as const

/** Checks every deployed file now, so a problem shows without reopening Lucent. */
export function ScanButton() {
  const [state, core] = useCore()
  return <button className="btn is-ghost" disabled={state.busy || state.recoveryRequired} onClick={() => void core.checkFiles()} title="Check every deployed file against its hash">
    <ScanSearch size={14} strokeWidth={1.75} />Scan
  </button>
}

/** Renders exactly the one state the core's priority function picks. */
export function StatusCard() {
  const [state] = useCore()
  const card = statusCard(state)
  if (!card) return null
  return <div className="card status-card">
    <StatusCardContent key={card.kind} card={card} />
    {card.caution && <p className="known-broken" role="status"><TriangleAlert size={14} /><span>{card.caution}</span></p>}
  </div>
}

function StatusCardContent({ card }: { card: Card }) {
  const [state, core] = useCore()
  if (card.kind === 'game-running' || card.kind === 'game-check-failed') return <div className="health-card is-game-waiting" role="status">
    <TriangleAlert size={20} />
    <div className="health-body"><h2>{card.kind === 'game-running' ? 'XIV is running' : 'Couldn’t check XIV'}</h2><p>{card.kind === 'game-running' ? 'Changes wait until you close the game. Your actions will return automatically.' : 'Changes wait until Lucent can check whether the game is running. It will try again automatically.'}</p></div>
  </div>
  if (card.kind === 'busy') return <div className="health-card is-busy" role="status">
    <LoaderCircle size={20} className="spin" />
    <div className="health-body">
      <div className="busy-heading"><h2>{OPERATION_LABEL[card.operation]}…</h2><EasedNumber className="progress-figure is-compact" value={card.progress} format={percentLabel} /></div>
      <ProgressBar value={card.progress} label={`${OPERATION_LABEL[card.operation]} progress`} />
    </div>
  </div>
  if (card.kind === 'folder-missing') return <div className="health-card is-folder-missing" role="alert">
    <FolderX size={20} />
    <div className="health-body"><h2>Game folder not found</h2><p>The folder Lucent deployed to is gone or has moved.</p><Path path={card.path} /></div>
    <button className="btn is-primary" disabled={state.busy} onClick={() => void core.findGameFolder()}><Search size={14} />Find it</button>
  </div>
  if (card.kind === 'switch-tier') return <div className="health-card is-tier" role="status">
    <Cpu size={20} />
    <div className="health-body"><h2>New graphics card</h2><p>{card.sameTier
      ? `Your ${card.gpu} is in the ${card.to} tier, but Lucent still has settings for your previous card.`
      : `Your ${card.gpu} matches the ${card.to} tier. Lucent is set up for ${card.from}.`}</p>
      <p className="update-size">Enabled and your own changes stay as they are, and so does your profile if {card.to} offers it.</p></div>
    <button className="btn is-primary" disabled={!gameActionsAvailable(state)} onClick={() => void core.switchTier()}><Cpu size={14} />{card.sameTier ? 'Refresh for this GPU' : 'Switch tier'}</button>
  </div>
  if (card.kind === 'drift') return <div className="health-card is-drift" role="alert">
    <TriangleAlert size={20} />
    <div className="health-body"><h2>{card.files === 1 ? '1 file needs repair' : `${card.files} files need repair`}</h2>
      <p>{card.patch ? `Game patch ${card.patch} changed what Lucent deployed.` : 'Something changed or removed what Lucent deployed.'}</p></div>
    <button className="btn is-primary" disabled={!gameActionsAvailable(state)} onClick={() => void core.repair()}><Wrench size={14} />Repair</button>
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
          <button className="btn is-primary" disabled={app ? state.busy || state.recoveryRequired : !gameActionsAvailable(state)} onClick={() => void (app ? core.updateApp() : core.update())}><Download size={14} />Update</button>
        </footer></div>
    </div>
  }
  if (card.kind === 'disabled') return <div className="health-card is-disabled">
    <Snowflake size={20} />
    <div className="health-body"><h2>Disabled</h2><p>Lucent’s files are in place but inactive. The game runs as if vanilla.</p></div>
    <ScanButton />
  </div>
  return <div className="health-card is-healthy">
    <CircleCheck size={20} />
    <div className="health-body"><h2>Healthy</h2><p>All deployed files match the tested content.</p></div>
    <ScanButton />
  </div>
}
