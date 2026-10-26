// The main screen's sections once there is a deployment: Home, Keys, Versions, Logs, Settings and Help. The rail switches
// between them; every action the player needs is in plain sight in one of them.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ArrowDownToLine, ArrowUpRight, BookOpen, Bug, ChevronDown, ClipboardCopy, Download, Eraser, FolderPen, LoaderCircle, Play, RefreshCw, RotateCcw, ScanSearch, Trash2, TriangleAlert, type LucideIcon } from 'lucide-react'
import { useCore } from './useCore'
import { Screen, useSection } from './Window'
import { EnabledRow, FlowError, StatusCard, UpdateCard } from './DeploymentScreens'
import { KeysScreen } from './KeysScreen'
import { VersionsScreen } from './VersionsScreen'
import { LogsScreen } from './LogsScreen'
import { Credits } from './CreditsScreen'
import { FolderPath, Path } from './Path'
import { returnFocus } from './focus'
import { GAME_WAITING, whyGameActionsWait } from './gameWaiting'
import { SOURCE_LABEL } from './ScanScreen'
import { gameActionsAvailable } from '../core/gameAccess'
import { GAME_EXECUTABLE } from '../core/gameFolder'
import { replacedOriginals } from '../core/deployment'
import { fileCount, sizeLabel } from '../core/format'
import { startsTicked, type BackupKind } from '../core/storage'
import { GUIDE_URL } from '../core/hotkeys'
import { LAUNCH_LABELS, type LaunchKind } from '../core/launch'
import { secondaryUpdates, type UpdateCardState } from '../core/statusCard'
import type { State } from '../core/core'

export function MainScreen() {
  const { section } = useSection()
  return section === 'keys' ? <KeysScreen /> : section === 'versions' ? <VersionsScreen /> : section === 'logs' ? <LogsScreen />
    : section === 'settings' ? <SettingsScreen /> : section === 'help' ? <HelpScreen /> : <HomeScreen />
}

function HomeScreen() {
  const [state] = useCore()
  return <Screen title="Your game" sub="What Lucent manages in your game folder." actions={<LaunchButton />}>
    <StatusCard />
    {secondaryUpdates(state).map((card) => <SecondaryUpdateRow key={card.kind} card={card} />)}
    <FlowError />
    <EnabledRow />
  </Screen>
}

/** An update the primary status card would otherwise hide entirely (behind drift, or while the game is
    running): a slim row naming it, one Update button, no changelog — the full card is still what Settings
    (for an app update) or the primary card (once nothing outranks it) shows. */
function SecondaryUpdateRow({ card }: { card: UpdateCardState }) {
  const [state, core] = useCore()
  const app = card.kind === 'app-update'
  return <div className="card update-row" role="status">
    <ArrowDownToLine size={16} strokeWidth={1.75} />
    <span>{app ? 'Lucent' : 'Content'} {card.version} is available</span>
    <button className="btn is-primary" disabled={app ? state.busy || state.recoveryRequired : !gameActionsAvailable(state)} onClick={() => void (app ? core.updateApp() : core.update())}><Download size={14} />Update</button>
  </div>
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

export function SettingsScreen({ openReset = false }: { openReset?: boolean } = {}) {
  const [state, core] = useCore()
  const { launchOptions, launcher, channel, xivLauncher, gameFolder, deployment, busy, recoveryRequired, activity, updateCheck, resetBackupPath, backupsFolder, storage, patchSwitch } = state
  const [confirming, setConfirming] = useState(false)
  const [resetConfirming, setResetConfirming] = useState(false)
  const [clearing, setClearing] = useState<'cache' | 'backups' | null>(null)
  const [now, setNow] = useState(Date.now())
  // The dialogs are unmounted rather than closed, so the browser doesn't give focus back to the button that opened one.
  const opener = useRef<HTMLElement | null>(null)
  const dialogOpen = confirming || resetConfirming || clearing !== null
  const wasOpen = useRef(false)
  // What a Clear or a switch lower down answers is shown at the top of the page; bring it into view so it isn't missed.
  const showAnswer = () => document.querySelector('.callout.is-notice, .health-card.is-failed')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  useEffect(() => {
    if (wasOpen.current && !dialogOpen) {
      returnFocus(opener.current)
      // Focus returning to the button that opened the dialog scrolls to it, so the answer scrolls after that.
      showAnswer()
    }
    wasOpen.current = dialogOpen
  }, [dialogOpen])
  useEffect(() => {
    if (openReset && deployment && resetBackupPath) setResetConfirming(true)
  }, [openReset, deployment, resetBackupPath])
  // An install, update, Reset or Uninstall adds or removes cache files and copies; reading again once the work stops (busy) and the record changes picks that up.
  useEffect(() => { void core.refreshStorage() }, [core, deployment, busy])
  // The ini is the switch's truth: a Repair, Reset or update, or the player in a text editor, changes it.
  useEffect(() => { void core.refreshPatchSwitch() }, [core, deployment, busy])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => { if (state.notice || state.error) showAnswer() }, [state.notice, state.error])
  const originals = deployment ? replacedOriginals(deployment) : []
  const waiting = whyGameActionsWait(state)
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
      {state.appUpdate && <UpdateCard card={{ kind: 'app-update', ...state.appUpdate }} />}
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
          <FolderPath path={gameFolder.path} />
          <small>{SOURCE_LABEL[gameFolder.source]} · game {gameFolder.version ?? 'version unknown'}</small>
        </div>
        <button className="btn" disabled={busy || recoveryRequired} onClick={() => void core.changeGameFolder()}><FolderPen size={14} strokeWidth={1.75} />Change…</button>
        <button className="btn" disabled={busy || recoveryRequired} onClick={() => void core.checkFiles()}><ScanSearch size={14} strokeWidth={1.75} />Scan</button>
      </div>
      {state.rejectedFolder && <p className="callout" role="alert">
        <TriangleAlert size={14} strokeWidth={1.75} />
        <span><Path path={state.rejectedFolder} /> doesn’t hold the game. Pick the folder that contains <span className="mono nowrap">{GAME_EXECUTABLE}</span>.</span>
      </p>}
    </SettingsGroup>}
    {deployment && patchSwitch && <SettingsGroup title="After a game patch">
      <label className="card option-row settings-switch">
        <span><strong>Keep game-code features running after an XIV patch (experimental)</strong>
          <small>OptiScaler-FFXIV finds the game’s code addresses itself. After a patch, features that read the game’s code stay off unless this is on and every address is found. Takes effect the next time XIV starts.</small>
          {patchSwitch.status === 'unavailable' ? <small className="settings-reason" role="status">{patchSwitch.reason}</small>
            : waiting && <small className="settings-reason" role="status">{GAME_WAITING[waiting].title}. {GAME_WAITING[waiting].text}</small>}</span>
        <input type="checkbox" role="switch" checked={patchSwitch.status === 'ready' && patchSwitch.on} disabled={patchSwitch.status !== 'ready' || !gameActionsAvailable(state)}
          onChange={(e) => void core.setUnknownBuildHooks(e.target.checked)} />
      </label>
    </SettingsGroup>}
    {storage && <SettingsGroup title="Storage">
      <div className="card settings-folder">
        <div>
          <strong>Cache</strong>
          {storage.cache.files || storage.cache.unreadable ? <FolderPath path={storage.cache.path} /> : <Path path={storage.cache.path} />}
          <small>{storage.cache.unreadable ? 'Lucent can’t read this folder, so it can’t show its size or clear it. ' : storage.cache.files ? `${fileCount(storage.cache.files)} · ${sizeLabel(storage.cache.bytes)}. ` : 'Empty. '}Content Lucent downloaded, kept so an install, update or repair doesn’t download it again.</small>
        </div>
        <button className="btn" disabled={busy || recoveryRequired || !storage.cache.files} onClick={(e) => { opener.current = e.currentTarget; setClearing('cache') }}><Eraser size={14} strokeWidth={1.75} />Clear…</button>
      </div>
      {backupsFolder && <div className="card settings-folder">
        <div>
          <strong>Backups</strong>
          <FolderPath path={backupsFolder} />
          <small>{storage.backups.unreadable ? 'Lucent can’t read this folder, so it can’t show its size or clear it. ' : storage.backups.groups.length ? `${storage.backups.groups.length === 1 ? '1 folder' : `${storage.backups.groups.length} folders`} · ${sizeLabel(storage.backups.groups.reduce((sum, group) => sum + group.bytes, 0))}. ` : ''}Copies of the files Lucent replaced, each under its own path. Uninstall doesn’t need them.</small>
        </div>
        <button className="btn" disabled={busy || recoveryRequired || !storage.backups.groups.length} onClick={(e) => { opener.current = e.currentTarget; setClearing('backups') }}><Eraser size={14} strokeWidth={1.75} />Clear…</button>
      </div>}
    </SettingsGroup>}
    {deployment && <SettingsGroup title="Danger zone" tone="danger">
      {waiting && <p className="settings-reason" role="status">{GAME_WAITING[waiting].title}. {GAME_WAITING[waiting].text}</p>}
      <div className="card settings-danger">
        <span><strong>Reset setup</strong><small>Offers the first-install choices again and writes the tested setup.</small></span>
        <button className="btn is-primary" disabled={!gameActionsAvailable(state) || !resetBackupPath} onClick={(e) => { opener.current = e.currentTarget; setResetConfirming(true) }}><RotateCcw size={14} strokeWidth={1.75} />Reset setup…</button>
      </div>
      <div className="card settings-danger">
        <span><strong>Uninstall from this game</strong><small>{originals.length
          ? `Removes everything Lucent added. You choose whether the ${originals.length === 1 ? 'file' : `${originals.length.toLocaleString('en')} files`} it replaced come back.`
          : 'Removes everything Lucent added. It didn’t replace any of your files.'}</small></span>
        <button className="btn is-danger-outline" disabled={!gameActionsAvailable(state)} onClick={(e) => { opener.current = e.currentTarget; setConfirming(true) }}><Trash2 size={14} strokeWidth={1.75} />Uninstall…</button>
      </div>
    </SettingsGroup>}
    {clearing === 'cache' && <ClearCacheDialog onClose={() => setClearing(null)} />}
    {clearing === 'backups' && <ClearBackupsDialog onClose={() => setClearing(null)} />}
    {confirming && <UninstallDialog originals={originals} onClose={() => setConfirming(false)} />}
    {resetConfirming && resetBackupPath && <ResetDialog backupPath={resetBackupPath} onClose={() => setResetConfirming(false)} />}
  </Screen>
}

function ClearCacheDialog({ onClose }: { onClose: () => void }) {
  const [state, core] = useCore()
  const { busy, recoveryRequired, storage } = state
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  const clear = async () => {
    await core.clearCache()
    onClose()
  }
  return (
    <dialog ref={ref} className="confirm" aria-labelledby="clear-cache-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose() }}>
      <h2 id="clear-cache-title">Clear the cache?</h2>
      <p>This removes {storage ? `${fileCount(storage.cache.files)} (${sizeLabel(storage.cache.bytes)})` : 'the files'} Lucent downloaded. It downloads what it needs again the next time you install, update, change version or repair, so it needs your connection then.</p>
      <p className="uninstall-note">Nothing in your game folder changes, and Uninstall doesn’t use the cache.</p>
      <footer className="confirm-actions">
        <button className="btn is-ghost" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="btn is-primary" disabled={busy || recoveryRequired} onClick={() => void clear()}>
          {busy ? <LoaderCircle size={14} strokeWidth={1.75} className="spin" /> : <Eraser size={14} strokeWidth={1.75} />}{busy ? 'Clearing…' : 'Clear cache'}
        </button>
      </footer>
    </dialog>
  )
}

const BACKUP_KIND: Record<BackupKind, string> = {
  install: 'The files Lucent replaced in your game folder. Uninstall puts them back from Lucent’s own backups, and a vanilla Uninstall writes these copies again if they are gone.',
  reset: 'What a Reset set aside of your config files and edits. Lucent’s own backups hold the same files, but nothing in Lucent puts them back; these are for you to look at.',
  kept: 'The only copies of files Lucent replaced and an Uninstall left out, or of a game folder that is gone.',
  other: 'A folder none of Lucent’s installs names.',
}
function ClearBackupsDialog({ onClose }: { onClose: () => void }) {
  const [state, core] = useCore()
  const { busy, recoveryRequired } = state
  // The list as it was when the dialog opened: what the player ticks from, and what Clear checks against what is there now.
  const [groups] = useState(() => state.storage?.backups.groups ?? [])
  const ref = useRef<HTMLDialogElement>(null)
  const [ticked, setTicked] = useState(() => new Set(groups.filter((group) => startsTicked(group.kind)).map((group) => group.folder)))
  useEffect(() => { ref.current?.showModal() }, [])
  const chosen = groups.filter((group) => ticked.has(group.folder))
  const clear = async () => {
    await core.clearBackups(chosen.map((group) => group.folder), groups)
    onClose()
  }
  const toggle = (folder: string, on: boolean) => setTicked((current) => { const next = new Set(current); if (on) next.add(folder); else next.delete(folder); return next })
  return (
    <dialog ref={ref} className="confirm" aria-labelledby="clear-backups-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose() }}>
      <h2 id="clear-backups-title">Clear backup copies?</h2>
      <p>Tick the folders to remove. Lucent keeps its own backups of the files it changed, which Uninstall restores from, whatever you clear here.</p>
      <fieldset className="uninstall-choices" disabled={busy} aria-label="Folders of backup copies to remove">
        {groups.map((group) => <label key={group.folder} className={`card option-row${ticked.has(group.folder) ? ' is-selected' : ''}`}>
          <input type="checkbox" checked={ticked.has(group.folder)} onChange={(e) => toggle(group.folder, e.target.checked)} />
          <span><strong>{group.folder}</strong>
            <small>{sizeLabel(group.bytes)} · {fileCount(group.files)}. {BACKUP_KIND[group.kind]}</small>
            {group.kind === 'kept' && <small className="is-caution">Once removed, these files can’t be put back.</small>}</span>
        </label>)}
      </fieldset>
      <footer className="confirm-actions">
        <button className="btn is-ghost" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="btn is-primary" disabled={busy || recoveryRequired || !chosen.length} onClick={() => void clear()}>
          {busy ? <LoaderCircle size={14} strokeWidth={1.75} className="spin" /> : <Eraser size={14} strokeWidth={1.75} />}{busy ? 'Clearing…' : chosen.length ? `Clear ${sizeLabel(chosen.reduce((sum, group) => sum + group.bytes, 0))}` : 'Clear'}
        </button>
      </footer>
    </dialog>
  )
}

function ResetDialog({ backupPath, onClose }: { backupPath: string; onClose: () => void }) {
  const [state, core] = useCore()
  const { busy } = state
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  const reset = async () => {
    await core.resetSetup()
    onClose()
  }
  return (
    <dialog ref={ref} className="confirm" aria-labelledby="reset-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose() }}>
      <h2 id="reset-title">Reset this setup?</h2>
      <p>Lucent will offer the first-install choices again and write the tested setup. Your current config files will be backed up first at <Path path={backupPath} />.</p>
      <footer className="confirm-actions">
        <button className="btn is-ghost" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="btn is-primary" disabled={!gameActionsAvailable(state)} onClick={() => void reset()}>
          {busy ? <LoaderCircle size={14} strokeWidth={1.75} className="spin" /> : <RotateCcw size={14} strokeWidth={1.75} />}{busy ? 'Opening…' : 'Reset setup'}
        </button>
      </footer>
    </dialog>
  )
}

function UninstallDialog({ originals, onClose }: { originals: string[]; onClose: () => void }) {
  const [state, core] = useCore()
  const { busy } = state
  const ref = useRef<HTMLDialogElement>(null)
  const [restore, setRestore] = useState(true)
  const name = useId()
  useEffect(() => { ref.current?.showModal() }, [])
  const uninstall = async () => {
    await core.uninstall(restore)
    onClose()
  }
  const count = originals.length
  const files = count === 1 ? 'file' : `${count.toLocaleString('en')} files`
  const shown = originals.slice(0, 3).map((path) => path.split(/[\\/]/).at(-1))
  return (
    <dialog ref={ref} className="confirm" aria-labelledby="uninstall-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose() }}>
      <h2 id="uninstall-title">Uninstall from this game?</h2>
      {count > 0 ? <>
        <p>Lucent removes everything it added. When you installed, it backed up {count === 1 ? 'a file' : <>{files}</>} from your game folder and replaced {count === 1 ? 'it' : 'them'}. What should happen to {count === 1 ? 'it' : 'them'}?</p>
        <fieldset className="uninstall-choices" disabled={busy} aria-label="What to do with the backed-up files">
          <label className={`card option-row ${restore ? 'is-selected' : ''}`}>
            <input type="radio" name={name} checked={restore} onChange={() => setRestore(true)} />
            <span><strong>Put my earlier {count === 1 ? 'file' : 'files'} back</strong>
              <small>Restores {shown.join(', ')}{count > shown.length ? ` and ${count - shown.length} more` : ''} exactly as they were before Lucent.</small></span>
          </label>
          <label className={`card option-row ${restore ? '' : 'is-selected'}`}>
            <input type="radio" name={name} checked={!restore} onChange={() => setRestore(false)} />
            <span><strong>Restore the game to vanilla</strong>
              <small>Leaves {count === 1 ? 'that file' : 'those files'} out, so the game folder has no mods. Copies stay in Lucent’s backup folder.</small></span>
          </label>
        </fieldset>
        <p className="uninstall-note">Your own presets and shaders stay either way.</p>
      </> : <p>Lucent removes everything it added, including the logs the mods wrote. It didn’t replace any of your files, so there’s nothing to restore. Your own presets and shaders stay.</p>}
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
    // The app update is actionable right below; a content update still has to be applied from Versions.
    const note = contentUpdate ? ' · update content from Versions' : ''
    return `${label[0].toUpperCase()}${label.slice(1)} ${available.length > 1 ? 'are' : 'is'} available${note}`
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
