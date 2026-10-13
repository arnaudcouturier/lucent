import { createContext, useContext, useEffect, useSyncExternalStore } from 'react'
import type { Core, State } from '../core/core'

export const CoreContext = createContext<Core | null>(null)

/** The core's commands and its current state; re-renders on every state change. */
export function useCore(): [State, Core] {
  const core = useContext(CoreContext)
  if (!core) throw new Error('useCore needs a CoreContext provider')
  return [useSyncExternalStore(core.subscribe, core.getState), core]
}

/** Polls whether XIV runs, so game actions come back once it closes. */
export function useGameRunningRefresh(core: Core) {
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      await core.refreshGameRunning()
      if (!stopped) timer = setTimeout(() => void refresh(), 1000)
    }
    void refresh()
    return () => { stopped = true; clearTimeout(timer) }
  }, [core])
}
