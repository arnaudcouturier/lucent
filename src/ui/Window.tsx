// The frameless 880×580 window: the rail on the left, the pane with its title strip on the right.
// The rail and the title strip are the drag regions.
import type { ReactNode } from 'react'
import { Minus, X } from 'lucide-react'
import { closeWindow, dragWindow, minimizeWindow } from './shell'
import { Rail } from './Rail'
import { Menu } from './Menu'
import { useCore } from './useCore'

export function Window({ children }: { children: ReactNode }) {
  const [{ activity }] = useCore()
  return (
    <div className="window">
      <Rail />
      <section className="pane">
        <div className="titlebar" onMouseDown={dragWindow}>
          {activity.kind === 'deployment' && <Menu />}
          <button className="caption" aria-label="Minimize" onClick={minimizeWindow}>
            <Minus size={14} strokeWidth={1.75} />
          </button>
          <button className="caption caption-close" aria-label="Close" onClick={closeWindow}>
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}

export function Screen({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="screen" key={title}>
      <header className="screen-head">
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </header>
      {children}
    </div>
  )
}
