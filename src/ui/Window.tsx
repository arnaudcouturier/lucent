// The frameless window, 880×580 at its smallest: the rail on the left, the pane with its title strip on the right.
// The rail and the title strip are the drag regions; a double-click on either maximizes or restores the window.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { closeWindow, dragWindow, minimizeWindow, observeMaximized, toggleMaximizeWindow } from './shell'
import { Rail } from './Rail'
import { Menu } from './Menu'
import { useCore } from './useCore'
import { CreditsScreen } from './CreditsScreen'
import { VersionsScreen } from './VersionsScreen'

export function Window({ children }: { children: ReactNode }) {
  const [{ activity }] = useCore()
  const [menuScreen, setMenuScreen] = useState<'credits' | 'versions' | null>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const [maximized, setMaximized] = useState(false)
  useEffect(() => observeMaximized(setMaximized), [])
  const showMenuScreen = menuScreen && activity.kind === 'deployment'
  useEffect(() => { if (activity.kind !== 'deployment') setMenuScreen(null) }, [activity.kind])
  const onBack = () => {
    setMenuScreen(null)
    requestAnimationFrame(() => menuButtonRef.current?.focus())
  }
  return (
    <div className="window">
      <Rail />
      <section className="pane">
        <div className="titlebar" onMouseDown={dragWindow}>
          {activity.kind === 'deployment' && <Menu onOpenCredits={() => setMenuScreen('credits')} onOpenVersions={() => setMenuScreen('versions')} returnFocusRef={menuButtonRef} />}
          <button className="caption" aria-label="Minimize" onClick={minimizeWindow}>
            <Minus size={14} strokeWidth={1.75} />
          </button>
          <button className="caption" aria-label={maximized ? 'Restore' : 'Maximize'} onClick={toggleMaximizeWindow}>
            {maximized ? <Copy size={12} strokeWidth={1.75} className="caption-restore" /> : <Square size={11} strokeWidth={1.75} />}
          </button>
          <button className="caption caption-close" aria-label="Close" onClick={closeWindow}>
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
        <div className="pane-content" hidden={!!showMenuScreen}>{children}</div>
        {showMenuScreen && (menuScreen === 'credits' ? <CreditsScreen onBack={onBack} /> : <VersionsScreen onBack={onBack} />)}
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
