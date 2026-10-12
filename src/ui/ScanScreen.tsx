// Scan: shows the game folder Lucent found and lets the player change it, or pick it when none was found.
import { Check, Folder, FolderOpen, LoaderCircle, TriangleAlert } from 'lucide-react'
import { GAME_EXECUTABLE, type GameFolderSource } from '../core/gameFolder'
import { Path } from './Path'
import { useCore } from './useCore'
import { Screen } from './Window'

const SOURCE_LABEL: Record<GameFolderSource, string> = {
  xivlauncher: 'XIVLauncher',
  steam: 'Steam',
  'square-enix': 'Square Enix launcher',
  default: 'Default location',
  picked: 'Chosen by you',
}

export function ScanScreen() {
  const [state] = useCore()
  return (
    <Screen title="Scan" sub="Lucent looks for your game folder.">
      <ul className="card list">
        <GameFolderRow />
      </ul>
      {state.rejectedFolder && (
        <p className="callout" role="alert">
          <TriangleAlert size={14} strokeWidth={1.75} />
          <span>
            <Path path={state.rejectedFolder} /> doesn't hold the game. Pick the folder that contains{' '}
            <span className="mono nowrap">{GAME_EXECUTABLE}</span>.
          </span>
        </p>
      )}
    </Screen>
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
