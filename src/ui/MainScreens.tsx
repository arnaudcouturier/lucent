// The main screen's sections once there is a deployment: Home, Keys, Versions, Logs, Settings and Help. The rail switches
// between them; every action the player needs is in plain sight in one of them.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRight, BookOpen, Bug, ChevronDown, ClipboardCopy, LoaderCircle, Play, RefreshCw, ScanSearch, Trash2, type LucideIcon } from 'lucide-react'
import { useCore } from './useCore'
import { Screen, useSection } from './Window'
import { EnabledRow, FlowError, StatusCard } from './DeploymentScreens'
import { KeysScreen } from './KeysScreen'
import { VersionsScreen } from './VersionsScreen'
import { LogsScreen } from './LogsScreen'
import { Credits } from './CreditsScreen'
import { Path } from './Path'
import { SOURCE_LABEL } from './ScanScreen'
import { gameActionsAvailable } from '../core/gameAccess'
import { replacedOriginals } from '../core/deployment'
import { GUIDE_URL } from '../core/hotkeys'
import { LAUNCH_LABELS, type LaunchKind } from '../core/launch'
import type { State } from '../core/core'

export function MainScreen() {
  const { section } = useSection()
  return section === 'keys' ? <KeysScreen /> : section === 'versions' ? <VersionsScreen /> : section === 'logs' ? <LogsScreen />
    : section === 'settings' ? <SettingsScreen /> : section === 'help' ? <HelpScreen /> : <HomeScreen />
}

function HomeScreen() {
  return <Screen title="Your game" sub="What Lucent manages in your game folder." actions={<LaunchButton />}>
    <StatusCard />
    <FlowError />
    <EnabledRow />
  </Screen>
}

/** Starts XIV the way the player does. While XIV runs it says so instead. */
function LaunchButton() {
  const [state, core] = useCore()
  const { launchOptions, launcher, launching, gameRunning, busy } = state
  const pickerId = useId()
  const picker = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, right: 0 })
  useEffect(() => {
    if (gameRunning || launching || busy) {
      picker.current?.hidePopover()
      setPickerOpen(false)
    }
  }, [gameRunning, launching, busy])
  useEffect(() => {
    if (!pickerOpen) return
    // A top-layer popover follows the button's position when opened; close it if the pane moves.
    const close = () => picker.current?.hidePopover()
    window.addEventListener('resize', close)
    document.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [pickerOpen])
  if (gameRunning) return <div className="launch is-running" role="status"><span className="live-dot" aria-hidden />In game</div>
  if (!launcher) return null
  return <div className="launch">
    <div className={`launch-actions${launchOptions.length > 1 ? ' is-split' : ''}`}>
      <button className="btn is-primary is-launch" disabled={launching || busy} onClick={() => void core.launchGame()}>
        {launching ? <LoaderCircle size={15} strokeWidth={1.75} className="spin" /> : <Play size={14} strokeWidth={1.75} fill="currentColor" />}
        {launching ? 'Starting…' : 'Launch XIV'}
      </button>
      {launchOptions.length > 1 && <button ref={trigger} className="btn is-primary launch-choose" disabled={launching || busy}
        aria-label="Choose launcher" aria-haspopup="dialog" aria-expanded={pickerOpen} aria-controls={pickerId} popoverTarget={pickerId}
        onClick={() => {
          const rect = trigger.current!.getBoundingClientRect()
          setPosition({ top: rect.bottom + 8, right: document.documentElement.clientWidth - rect.right })
        }}>
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
      </button>}
    </div>
    <span className="launch-via">with {launcher === 'official' ? 'the ' : ''}{LAUNCH_LABELS[launcher]}</span>
    {launchOptions.length > 1 && <div ref={picker} id={pickerId} className="launch-picker" popover="auto" role="dialog" aria-label="Choose launcher"
      style={position} onToggle={(e) => setPickerOpen(e.newState === 'open')}>
      <fieldset disabled={launching || busy}>
        <legend>Launch XIV with</legend>
        {launchOptions.map(({ kind }) => <label key={kind} className={`launch-option${launcher === kind ? ' is-selected' : ''}`}>
          <input type="radio" name={pickerId} checked={launcher === kind} onChange={() => void core.setLauncher(kind)} />
          <span>{LAUNCH_LABELS[kind]}</span>
        </label>)}
      </fieldset>
      <p>Used every time you launch XIV.</p>
    </div>}
  </div>
}

function SettingsGroup({ title, tone, children }: { title: string; tone?: 'danger'; children: ReactNode }) {
  return <section className={`settings-group${tone ? ` is-${tone}` : ''}`} aria-label={title}>
    <h2>{title}</h2>
    {children}
  </section>
}

const LAUNCH_OPTION: Record<LaunchKind, { title: string; text: string }> = {
  xivlauncher: { title: LAUNCH_LABELS.xivlauncher, text: 'Signs you in and loads your Dalamud plugins, as XIVLauncher does.' },
  steam: { title: LAUNCH_LABELS.steam, text: 'Starts XIV from your Steam library.' },
  official: { title: LAUNCH_LABELS.official, text: 'Opens the official launcher in your game folder.' },
}

export function SettingsScreen() {
  const [state, core] = useCore()
  const { launchOptions, launcher, channel, xivLauncher, gameFolder, deployment, busy, recoveryRequired, activity, updateCheck } = state
  const [confirming, setConfirming] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const restored = deployment ? replacedOriginals(deployment).length : 0
  return <Screen title="Settings" sub="How Lucent starts XIV, which versions it offers, and the game folder it looks after.">
    <FlowError />
    {launchOptions.length === 1 && <SettingsGroup title="Launch XIV with">
      <div className="card option-row">
        <span><strong>{LAUNCH_OPTION[launchOptions[0].kind].title}</strong><small>{LAUNCH_OPTION[launchOptions[0].kind].text} It’s the only launcher Lucent found for this game folder.</small></span>
      </div>
    </SettingsGroup>}
    {launchOptions.length > 1 && <SettingsGroup title="Launch XIV with">
      <fieldset className="card option-list settings-choices" disabled={busy} aria-label="Launch XIV with">
        {launchOptions.map((option) => <label key={option.kind} className={`option-row${launcher === option.kind ? ' is-selected' : ''}`}>
          <input type="radio" name="launcher" checked={launcher === option.kind} onChange={() => void core.setLauncher(option.kind)} />
          <span><strong>{LAUNCH_OPTION[option.kind].title}</strong><small>{LAUNCH_OPTION[option.kind].text}</small></span>
        </label>)}
      </fieldset>
    </SettingsGroup>}
    <SettingsGroup title="Updates">
      {deployment && activity.kind === 'deployment' && <div className="card option-row settings-check">
        <span><strong>Check for updates</strong>
          <small className={`update-check-status${updateCheck.status === 'failed' ? ' is-caution' : ''}`} role="status">{updateStatusLine(state, now)}</small>
          <small>Lucent {__APP_VERSION__} · content {deployment.contentVersion}</small>
        </span>
        <button className="btn" disabled={busy} onClick={() => void core.checkForUpdates()}><RefreshCw size={14} strokeWidth={1.75} />Check now</button>
      </div>}
      <label className="card option-row settings-switch">
        <span><strong>Beta channel</strong><small>Get beta versions of Lucent and its content first. Leaving Beta changes nothing installed.</small></span>
        <input type="checkbox" role="switch" checked={channel === 'beta'} disabled={busy} onChange={(e) => void core.setChannel(e.target.checked ? 'beta' : 'stable')} />
      </label>
    </SettingsGroup>
    {xivLauncher.status === 'found' && <SettingsGroup title="XIVLauncher">
      <label className="card option-row settings-switch">
        <span><strong>Auto-repair</strong><small>Checks Lucent’s files when XIV starts, and repairs them after it closes.</small></span>
        <input type="checkbox" role="switch" checked={xivLauncher.autoRepair} disabled={busy} onChange={(e) => void core.setAutoRepair(e.target.checked)} />
      </label>
    </SettingsGroup>}
    {gameFolder.status === 'found' && <SettingsGroup title="Game folder">
      <div className="card settings-folder">
        <div>
          <Path path={gameFolder.path} />
          <small>{SOURCE_LABEL[gameFolder.source]} · game {gameFolder.version ?? 'version unknown'}</small>
        </div>
        <button className="btn" disabled={busy || recoveryRequired} onClick={() => void core.checkFiles()}><ScanSearch size={14} strokeWidth={1.75} />Scan</button>
      </div>
    </SettingsGroup>}
    {deployment && <SettingsGroup title="Uninstall" tone="danger">
      <div className="card settings-danger">
        <span><strong>Uninstall from this game</strong><small>{restored
          ? `Removes everything Lucent added and puts back the ${restored === 1 ? 'file' : `${restored.toLocaleString('en')} files`} it replaced.`
          : 'Removes everything Lucent added. It didn’t replace any of your files.'}</small></span>
        <button className="btn is-danger-outline" disabled={!gameActionsAvailable(state)} onClick={() => setConfirming(true)}><Trash2 size={14} strokeWidth={1.75} />Uninstall…</button>
      </div>
    </SettingsGroup>}
    {confirming && <UninstallDialog restored={restored} onClose={() => setConfirming(false)} />}
  </Screen>
}

function UninstallDialog({ restored, onClose }: { restored: number; onClose: () => void }) {
  const [state, core] = useCore()
  const { busy } = state
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  const uninstall = async () => {
    await core.uninstall()
    onClose()
  }
  return (
    <dialog ref={ref} className="confirm" aria-labelledby="uninstall-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose() }}>
      <h2 id="uninstall-title">Uninstall from this game?</h2>
      <p>{restored
        ? <>Lucent removes everything it added and puts back the {restored === 1 ? 'file' : <>{restored.toLocaleString('en')} files</>} it replaced from your earlier setup.</>
        : <>Lucent removes everything it added, including the logs the mods wrote. It didn’t replace any of your files, so there’s nothing to restore.</>}{' '}
        Your own presets and shaders stay.</p>
      <footer className="confirm-actions">
        <button className="btn is-ghost" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="btn is-danger" disabled={!gameActionsAvailable(state)} onClick={() => void uninstall()}>
          {busy ? <LoaderCircle size={14} strokeWidth={1.75} className="spin" /> : <Trash2 size={14} strokeWidth={1.75} />}{busy ? 'Uninstalling…' : 'Uninstall'}
        </button>
      </footer>
    </dialog>
  )
}

function HelpAction({ icon: Icon, title, text, onClick, disabled, external }: { icon: LucideIcon; title: string; text: string; onClick(): void; disabled: boolean; external?: boolean }) {
  return <button className="card help-action" disabled={disabled} onClick={onClick}>
    <span className="help-action-icon"><Icon size={16} strokeWidth={1.75} /></span>
    <span className="help-action-body"><strong>{title}</strong><small>{text}</small></span>
    {external && <ArrowUpRight size={15} strokeWidth={1.75} className="help-action-out" />}
  </button>
}

function updateStatusLine(state: State, now: number) {
  const { updateCheck, appUpdate, activity } = state
  if (updateCheck.status === 'checking') return 'Checking…'
  if (updateCheck.status === 'failed') return `Couldn’t reach GitHub · ${updateCheck.error ?? 'The check failed.'}`
  if (updateCheck.status === 'stale') {
    const checked = updateCheck.checkedAt ? `checked ${relativeCheckTime(updateCheck.checkedAt, now)}` : 'checked earlier'
    const outcome = updateCheck.outcome?.channel === state.channel ? updateCheck.outcome : null
    const lastFound = [outcome?.appVersion && `Lucent ${outcome.appVersion}`, outcome?.contentVersion && `content ${outcome.contentVersion}`].filter((item): item is string => !!item)
    if (lastFound.length) return `Last successful check found ${lastFound.join(' and ')} · ${checked}`
    if (outcome) return `Up to date · ${checked}`
    return `Last successful check · ${checked}`
  }
  if (updateCheck.status === 'idle' && !updateCheck.checkedAt) return 'Not checked yet'

  const contentUpdate = activity.kind === 'deployment' ? activity.update : null
  const available = [appUpdate && `Lucent ${appUpdate.version}`, contentUpdate && `content ${contentUpdate.version}`].filter((item): item is string => !!item)
  if (available.length) {
    const label = available.join(' and ')
    return `${label[0].toUpperCase()}${label.slice(1)} ${available.length > 1 ? 'are' : 'is'} available · update from Home`
  }
  if (!updateCheck.checkedAt) return 'Not checked yet'
  return `Up to date · checked ${relativeCheckTime(updateCheck.checkedAt, now)}`
}

function relativeCheckTime(checkedAt: string, now: number) {
  const elapsed = Math.max(0, now - Date.parse(checkedAt))
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}

function HelpScreen() {
  const [{ busy }, core] = useCore()
  return <Screen title="Help" sub="The guide, a quick way to report a problem, and the people whose work Lucent installs.">
    <FlowError />
    <div className="help-actions">
      <HelpAction icon={BookOpen} title="Lucent guide" text="Every key and setting, explained." disabled={busy} external onClick={() => void core.openLink(GUIDE_URL)} />
      <HelpAction icon={Bug} title="Report a bug" text="Copies diagnostics, then opens a GitHub issue." disabled={busy} external onClick={() => void core.reportBug()} />
      <HelpAction icon={ClipboardCopy} title="Copy diagnostics" text="Versions, file checks and recent log lines." disabled={busy} onClick={() => void core.copyDiagnostics()} />
    </div>
    <p className="screen-note help-credits-note">Lucent brings together work from these upstream authors. Their components keep their own licences, installed alongside their files.</p>
    <Credits />
  </Screen>
}
