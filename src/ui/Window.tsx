// The frameless window: the rail on the left, the pane with its title strip on the right.
// The rail and the title strip are the drag regions; a double-click on either maximizes or restores the window.
// Once there is a deployment, the rail navigates between its sections.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { closeWindow, dragWindow, minimizeWindow, observeMaximized, toggleMaximizeWindow } from './shell'
import { Rail } from './Rail'
import { useCore } from './useCore'

export type Section = 'home' | 'keys' | 'versions' | 'mods' | 'logs' | 'settings' | 'help'

/** The main screen's section, which the rail's navigation switches. */
export const SectionContext = createContext<{ section: Section; setSection(section: Section): void }>({ section: 'home', setSection: () => {} })
export const useSection = () => useContext(SectionContext)

export function Window({ children }: { children: ReactNode }) {
  const [{ activity }] = useCore()
  const [section, setSection] = useState<Section>('home')
  const [maximized, setMaximized] = useState(false)
  useEffect(() => observeMaximized(setMaximized), [])
  // A new setup or an uninstall starts over on Home.
  useEffect(() => { if (activity.kind !== 'deployment') setSection('home') }, [activity.kind])
  return (
    <SectionContext.Provider value={{ section, setSection }}>
      <div className="window">
        <Rail />
        <section className="pane">
          <div className="pane-content">{children}</div>
          {/* After the content in the tab order; the titlebar is positioned over the pane's top strip. */}
          <div className="titlebar" onMouseDown={dragWindow}>
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
        </section>
      </div>
    </SectionContext.Provider>
  )
}

export function Screen({ title, sub, actions, children }: { title: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="screen" key={title}>
      <header className={`screen-head${actions ? ' has-actions' : ''}`}>
        <div>
          <h1>{title}</h1>
          {sub && <p>{sub}</p>}
        </div>
        {actions && <div className="screen-head-actions">{actions}</div>}
      </header>
      {children}
    </div>
  )
}
