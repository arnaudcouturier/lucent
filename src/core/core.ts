// The core: all of Lucent's domain logic, framework-free. It exposes one observable state and the
// commands the UI calls. It reaches the machine only through the Platform port.
import type { Platform } from './platform'
import { checkPickedFolder, findGameFolder, type GameFolder } from './gameFolder'

export type GameFolderState = { status: 'idle' } | { status: 'scanning' } | ({ status: 'found' } & GameFolder) | { status: 'not-found' }

export interface State {
  gameFolder: GameFolderState
  /** The last folder the player picked that turned out not to hold the game; null once a pick succeeds. */
  rejectedFolder: string | null
}

export interface Core {
  getState(): State
  /** Calls `listener` after every state change. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void
  /** Scan: finds the game folder. */
  scan(): Promise<void>
  /** Lets the player pick the game folder, whether or not Scan found one. */
  chooseGameFolder(): Promise<void>
}

export function createCore(platform: Platform): Core {
  let state: State = { gameFolder: { status: 'idle' }, rejectedFolder: null }
  const listeners = new Set<() => void>()
  const set = (patch: Partial<State>) => {
    state = { ...state, ...patch }
    for (const l of listeners) l()
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async scan() {
      set({ gameFolder: { status: 'scanning' }, rejectedFolder: null })
      const found = await findGameFolder(platform)
      set({ gameFolder: found ? { status: 'found', ...found } : { status: 'not-found' } })
    },
    async chooseGameFolder() {
      const picked = await platform.pickFolder({ title: 'Choose the game folder' })
      if (picked === null) return
      const folder = await checkPickedFolder(platform, picked)
      set(folder ? { gameFolder: { status: 'found', ...folder }, rejectedFolder: null } : { rejectedFolder: picked })
    },
  }
}
