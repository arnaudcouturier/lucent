import { ArrowLeft, Download, RotateCcw } from 'lucide-react'
import type { VersionChoice } from '../core/versions'
import { FlowError, sizeLabel, StatusCard } from './DeploymentScreens'
import { useCore } from './useCore'

export function VersionsScreen({ onBack }: { onBack: () => void }) {
  const [state, core] = useCore()
  const { versions, deployment, busy, recoveryRequired, activity } = state
  const groups: { title: string; versions: VersionChoice[] }[] = [
    { title: 'Current', versions: versions.filter((v) => v.current) },
    { title: 'Cached versions', versions: versions.filter((v) => !v.current && v.cached) },
    { title: 'Skipped versions', versions: versions.filter((v) => !v.current && !v.cached && v.skipped) },
    { title: 'Other versions on your channel', versions: versions.filter((v) => !v.current && !v.cached && !v.skipped) },
  ]
  return <div className="versions-screen">
    <div className="screen">
      <header className="screen-head">
        <h1>Versions</h1>
        <p>Roll back using cached files, or apply another content version. Your profile and Enabled stay as they are.</p>
      </header>
      <p className="screen-note">Rolling back pins that version and skips the one you leave behind. Newer content is still announced.</p>
      {state.manifest.status !== 'ready' && <p className="screen-note">Published versions are unavailable. You can still roll back to a cached version.</p>}
      {activity.kind === 'deployment' && activity.operation && <StatusCard />}
      <FlowError />
      {groups.filter((group) => group.versions.length).map((group) => <section className="versions-section" key={group.title} aria-label={group.title}>
        <h2>{group.title}</h2>
        <ul className="list version-list">{group.versions.map((version) => {
          const rollback = !!deployment && version.id < deployment.contentVersion
          const labels = [version.current && 'Current', version.pinned && 'Pinned', version.cached && 'Cached', version.skipped && 'Skipped'].filter(Boolean)
          const download = version.downloadSize === 0 ? 'Nothing to download' : version.downloadSize === null ? null
            : `${sizeLabel(version.downloadSize)} to download`
          return <li className="card version-choice" key={version.id}>
            <div className="version-choice-body">
              <h3 className="mono">{version.id}</h3>
              {!!labels.length && <p className="version-labels">{labels.join(' · ')}</p>}
              {version.changelog[0] && <p>{version.changelog[0]}</p>}
              {!version.current && <p>{version.unavailable ?? download}</p>}
            </div>
            {!version.current && <button className="btn" disabled={busy || recoveryRequired || !!version.unavailable}
              aria-label={`${rollback ? 'Roll back to' : 'Apply'} content ${version.id}`} onClick={() => void core.applyVersion(version.id)}>
              {rollback ? <RotateCcw size={14} /> : <Download size={14} />}{rollback ? 'Roll back' : 'Apply'}
            </button>}
          </li>
        })}</ul>
      </section>)}
    </div>
    <footer className="credits-actions">
      <button className="btn is-ghost" autoFocus disabled={busy} onClick={onBack}><ArrowLeft size={14} />Back</button>
    </footer>
  </div>
}
