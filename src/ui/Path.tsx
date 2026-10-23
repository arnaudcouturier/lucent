import { Fragment } from 'react'
import { FolderOpen } from 'lucide-react'
import { useCore } from './useCore'

/** A Windows path in mono that wraps only after a backslash, so no folder name is cut in half. */
export function Path({ path, className = '' }: { path: string; className?: string }) {
  const parts = path.split('\\')
  return (
    <span className={`mono path ${className}`}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && (
            <>
              {'\\'}
              <wbr />
            </>
          )}
        </Fragment>
      ))}
    </span>
  )
}

/** A folder's path with Open folder after it, never alone on a line: only for a folder that exists now. */
export function FolderPath({ path, className }: { path: string; className?: string }) {
  return <span className="folder-path"><Path path={path} className={className} /><OpenFolder path={path} /></span>
}

/** Shows a folder in File Explorer: a quiet icon after its path, or with its label in a toolbar such as the Logs terminal's. */
export function OpenFolder({ path, labelled = false, className = '' }: { path: string; labelled?: boolean; className?: string }) {
  const [, core] = useCore()
  return <button type="button" className={`btn is-ghost open-folder${className ? ` ${className}` : ''}`} aria-label="Open folder" title="Open in File Explorer"
    onClick={() => void core.openFolder(path)}>
    <FolderOpen size={14} strokeWidth={1.75} aria-hidden />{labelled && 'Open folder'}
  </button>
}
