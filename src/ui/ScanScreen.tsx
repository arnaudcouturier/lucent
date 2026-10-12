// Scan: shows the game folder Lucent found and lets the player change it, or pick it when none was found.
import { Check, Cpu, Folder, FolderOpen, LoaderCircle, TriangleAlert } from 'lucide-react'
import { GAME_EXECUTABLE, type GameFolderSource } from '../core/gameFolder'
import { Path } from './Path'
import { useCore } from './useCore'
import { Screen } from './Window'
import { FlowError } from './DeploymentScreens'

const SOURCE_LABEL: Record<GameFolderSource, string> = {
  xivlauncher: 'XIVLauncher',
  steam: 'Steam',
  'square-enix': 'Square Enix launcher',
  default: 'Default location',
  picked: 'Chosen by you',
}

export function ScanScreen() {
  const [state, core] = useCore()
  return (
    <Screen title="Scan" sub="Lucent looks for your game folder, graphics card and launcher.">
      {!state.recoveryRequired && <><ul className="card list">
        <GameFolderRow />
        <XivLauncherRow />
        <GraphicsFeaturesRow />
      </ul>
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
      <FlowError />
      {!state.recoveryRequired && <footer className="screen-actions"><button className="btn is-primary" disabled={state.busy || !!state.error || state.gameFolder.status !== 'found' || state.graphics.status !== 'found' || !state.graphics.tier} onClick={() => void core.continueSetup()}>Continue</button></footer>}
    </Screen>
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
  const [{ manifest, graphics }, core] = useCore()
  const failed = manifest.status === 'update-required' || manifest.status === 'invalid' || manifest.status === 'unavailable'
  if (!failed && graphics.status !== 'not-found' && graphics.status !== 'unavailable') return null
  return (
    <div className="callout" role="alert">
      <TriangleAlert size={14} strokeWidth={1.75} />
      <div className="scan-notice">
        {manifest.status === 'update-required' ? <>
          <span>Update Lucent to continue. This content needs a newer app.</span>
          <span>Download the latest app from Lucent’s GitHub releases, then open it again.</span>
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
