// Scan: shows the game folder Lucent found and lets the player change it, or pick it when none was found.
import { useState } from 'react'
import { Archive, Check, ChevronDown, Cpu, Folder, FolderOpen, LoaderCircle, TriangleAlert } from 'lucide-react'
import { GAME_EXECUTABLE, type GameFolderSource } from '../core/gameFolder'
import { onChannel } from '../core/updates'
import { Path } from './Path'
import { FileTree } from './FileTree'
import { useCore } from './useCore'
import { Screen } from './Window'
import { FlowError, StatusCard } from './DeploymentScreens'

export const SOURCE_LABEL: Record<GameFolderSource, string> = {
  xivlauncher: 'XIVLauncher',
  steam: 'Steam',
  'square-enix': 'Square Enix launcher',
  default: 'Default location',
  picked: 'Chosen by you',
}

export function ScanScreen() {
  const [state, core] = useCore()
  const tierId = state.graphics.status === 'found' ? state.graphics.tier?.id : undefined
  const contentAvailable = !!tierId && state.manifest.status === 'ready'
    && state.manifest.manifest.versions.some((v) => v.tiers[tierId] && onChannel(v, state.channel))
  return (
    <Screen title="Scan" sub="Lucent looks for your game folder, graphics card and launcher.">
      <StatusCard />
      <FlowError />
      {!state.recoveryRequired && <><ul className="card list">
        <GameFolderRow />
        <XivLauncherRow />
        <GraphicsFeaturesRow />
        <BackupRow />
      </ul>
      <SetupContentNotice />
      <ManifestNotice /></>}
      {state.rejectedFolder && (
        <p className="callout" role="alert">
          <TriangleAlert size={14} strokeWidth={1.75} />
          <span>
            <Path path={state.rejectedFolder} /> doesn't hold the game. Pick the folder that contains{' '}
            <span className="mono nowrap">{GAME_EXECUTABLE}</span>.
          </span>
        </p>
      )}
      {!state.recoveryRequired && <footer className="screen-actions"><button className="btn is-primary" disabled={state.busy || !!state.error || state.gameFolder.status !== 'found' || !contentAvailable} onClick={() => void core.continueSetup()}>Continue</button></footer>}
    </Screen>
  )
}

/** Beta can be chosen before the first deployment; Settings is only available after setup. */
function SetupContentNotice() {
  const [{ manifest, graphics, channel, busy }, core] = useCore()
  if (manifest.status !== 'ready' || graphics.status !== 'found' || !graphics.tier) return null
  const tierId = graphics.tier.id
  const versions = manifest.manifest.versions.filter((v) => v.tiers[tierId])
  const hasContent = versions.some((v) => onChannel(v, channel))
  const hasBeta = versions.some((v) => v.channel === 'beta')
  const changeChannel = async (beta: boolean) => {
    const next = beta ? 'beta' : 'stable'
    await core.setChannel(next)
    // Scan must show the replacements for the newly selected content before the player continues.
    if (core.getState().channel === next && !core.getState().error) await core.scan()
  }
  return <>
    {!hasContent && <p className="callout is-notice" role="status">
      <span>{hasBeta
        ? 'Stable content isn’t published for this graphics card yet. Enable Beta below to try the available setup.'
        : 'No content is published for this graphics card yet. Check back for a tested setup.'}</span>
    </p>}
    {(hasBeta || channel === 'beta') && <label className="card option-row settings-switch setup-channel">
      <span><strong>Beta channel</strong><small>Try beta versions of Lucent and its content. You can change this later in Settings.</small></span>
      <input type="checkbox" role="switch" checked={channel === 'beta'} disabled={busy} onChange={(e) => void changeChannel(e.target.checked)} />
    </label>}
  </>
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`

/**
 * The one place that says what a first deployment does to files already in the game folder: which it backs up, then
 * replaces or removes, where the readable copies go, and which presets it keeps.
 */
function BackupRow() {
  const [{ existingSetups, folderChanges }] = useCore()
  const [open, setOpen] = useState(false)
  const backedUp = folderChanges?.backedUp ?? []
  const carried = folderChanges?.carried ?? []
  if (!existingSetups.length && !backedUp.length && !carried.length) return null
  const facts = [
    backedUp.length ? `${count(backedUp.length, 'file', 'files')} backed up and replaced` : null,
    carried.length ? `${count(carried.length, 'preset', 'presets')} kept` : null,
  ].filter(Boolean)
  return (
    <li className="row backup-row">
      <Archive size={15} strokeWidth={1.75} className="row-icon" />
      <div className="row-main">
        <span className="row-label">{existingSetups.length ? 'Existing setup' : 'Replaced files'}</span>
        <span className="row-value" title={existingSetups.map((s) => s.label).join(', ')}>{existingSetups.length ? new Intl.ListFormat('en').format(existingSetups.map((s) => s.label)) : count(backedUp.length, 'file', 'files')}</span>
        <span className="row-meta">{facts.length ? facts.join(' · ') : 'Stays as it is'}</span>
        {folderChanges && !!(backedUp.length + carried.length) && <button className="row-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide files' : 'Show files'}<ChevronDown size={13} strokeWidth={1.75} />
        </button>}
      </div>
      <span />
      <span />
      {open && folderChanges && <div className="backup-panel">
        {!!backedUp.length && <section>
          <div className="backup-destination">
            <span>Backed up to</span>
            <Path path={folderChanges.backupFolder} />
            <small>Each file keeps its folder there. Uninstall puts every one back where it was.</small>
          </div>
          <FileTree label="Files backed up" files={backedUp.map((f) => ({ path: f.path, note: f.removed ? 'removed' : undefined }))} />
        </section>}
        {!!carried.length && <section>
          <div className="backup-destination">
            <span>Presets kept</span>
            <small>Copied into ReShade’s preset folder, so they stay in its list. Uninstall leaves them.</small>
          </div>
          <FileTree label="Presets kept" files={carried.map((c) => ({ path: c.to, title: `From ${c.from}` }))} />
        </section>}
      </div>}
    </li>
  )
}

function XivLauncherRow() {
  const [{ xivLauncher }] = useCore()
  const pending = xivLauncher.status === 'idle' || xivLauncher.status === 'scanning'
  return (
    <li className="row" aria-busy={pending}>
      <FolderOpen size={15} strokeWidth={1.75} className="row-icon" />
      <div className="row-main">
        <span className="row-label">XIVLauncher</span>
        <span className="row-value">{pending ? <span className="skeleton" /> : xivLauncher.status === 'found' ? 'Found' : xivLauncher.status === 'not-found' ? 'Not found' : 'Could not scan'}</span>
        {!pending && <span className="row-meta">{xivLauncher.status === 'found' ? 'Optional auto-repair integration available.' : 'Lucent works with any launcher.'}</span>}
      </div>
      <span />
      <span className="row-state">{pending ? <LoaderCircle size={14} className="spin" aria-label="Looking" /> : xivLauncher.status === 'found' ? <Check size={14} aria-label="Found" /> : null}</span>
    </li>
  )
}

function GraphicsFeaturesRow() {
  const [{ graphics }] = useCore()
  if (graphics.status !== 'found' || !graphics.tier) return null
  const tier = graphics.tier
  return (
    <li className="row">
      <Cpu size={15} strokeWidth={1.75} className="row-icon" />
      <div className="row-main">
        <span className="row-label">Graphics</span>
        <span className="row-value">{tier.neuralRendering ? 'Neural Rendering available' : 'Neural Rendering unavailable'}</span>
        <span className="row-meta">{tier.requiresReShade ? 'ReShade is included for this tier.' : 'ReShade is optional.'}</span>
      </div>
      <span />
      <span className="row-state"><Check size={14} strokeWidth={1.75} aria-label="Matched" /></span>
    </li>
  )
}

function ManifestNotice() {
  const [{ manifest, graphics, appUpdate }, core] = useCore()
  const failed = manifest.status === 'update-required' || manifest.status === 'invalid' || manifest.status === 'unavailable'
  if (!failed && graphics.status !== 'not-found' && graphics.status !== 'unavailable') return null
  return (
    <div className="callout" role="alert">
      <TriangleAlert size={14} strokeWidth={1.75} />
      <div className="scan-notice">
        {manifest.status === 'update-required' ? <>
          <span>Update Lucent to continue. This content needs a newer app.</span>
          <span>{appUpdate ? 'Use Update above to reopen Lucent with the new app version.' : 'Download the latest app from Lucent’s GitHub releases, then open it again.'}</span>
        </> : <>
          <span>{manifest.status === 'invalid' ? 'The manifest is invalid. Lucent cannot determine your tier.' : manifest.status === 'unavailable' ? 'Could not load the manifest. Check your connection and try again.' : graphics.status === 'not-found' ? 'No hardware graphics card was found. Try Scan again once its driver is available.' : 'Could not scan your graphics card. Try Scan again.'}</span>
          <button className="btn" onClick={() => void core.scan()}>Scan again</button>
        </>}
      </div>
    </div>
  )
}

function GameFolderRow() {
  const [{ gameFolder }, core] = useCore()
  const choose = () => void core.chooseGameFolder()

  if (gameFolder.status === 'found') {
    return (
      <li className="row">
        <Folder size={15} strokeWidth={1.75} className="row-icon" />
        <div className="row-main">
          <span className="row-label">Game folder</span>
          <Path path={gameFolder.path} className="row-value row-path" />
          <span className="row-meta">
            {SOURCE_LABEL[gameFolder.source]} · {gameFolder.version ? <span className="mono">{gameFolder.version}</span> : 'version unknown'}
          </span>
        </div>
        <button className="btn is-ghost row-action" onClick={choose}>
          Change
        </button>
        <span className="row-state">
          <Check size={14} strokeWidth={1.75} aria-label="Found" />
        </span>
      </li>
    )
  }

  if (gameFolder.status === 'not-found') {
    return (
      <li className="row is-warn">
        <Folder size={15} strokeWidth={1.75} className="row-icon" />
        <div className="row-main">
          <span className="row-label">Game folder</span>
          <span className="row-value">Not found</span>
          <span className="row-meta">Show Lucent where the game is.</span>
        </div>
        <button className="btn is-primary row-action" onClick={choose}>
          <FolderOpen size={14} strokeWidth={1.75} />
          Choose folder
        </button>
        <span className="row-state">
          <TriangleAlert size={14} strokeWidth={1.75} aria-label="Not found" />
        </span>
      </li>
    )
  }

  return (
    <li className="row is-pending" aria-busy>
      <Folder size={15} strokeWidth={1.75} className="row-icon" />
      <div className="row-main">
        <span className="row-label">Game folder</span>
        <span className="row-value">
          <span className="skeleton" />
        </span>
      </div>
      <span />
      <span className="row-state">
        <LoaderCircle size={14} className="spin" aria-label="Looking" />
      </span>
    </li>
  )
}
