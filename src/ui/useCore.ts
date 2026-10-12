import { createContext, useContext, useSyncExternalStore } from 'react'
import type { Core, State } from '../core/core'

export const CoreContext = createContext<Core | null>(null)

/** The core's commands and its current state; re-renders on every state change. */
export function useCore(): [State, Core] {
  const core = useContext(CoreContext)
  if (!core) throw new Error('useCore needs a CoreContext provider')
  return [useSyncExternalStore(core.subscribe, core.getState), core]
}
