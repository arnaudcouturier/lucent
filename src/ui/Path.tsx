import { Fragment } from 'react'

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
