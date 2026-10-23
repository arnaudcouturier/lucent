import type { State } from '../core/core'

/** Why the controls that write to the game folder are waiting, said once: in the status card, and beside the disabled
    buttons in Settings, where no status card shows. */
export const GAME_WAITING = {
  running: { title: 'XIV is running', text: 'Changes wait until you close the game. Your actions will return automatically.' },
  'check-failed': { title: 'Couldn’t check XIV', text: 'Changes wait until Lucent can check whether the game is running. It will try again automatically.' },
  'folder-missing': { title: 'Game folder not found', text: 'The folder Lucent deployed to is gone or has moved.' },
} as const

export type GameWaiting = keyof typeof GAME_WAITING

/** The cause, in the order the status card picks it. Null while something else is running (the card shows its progress). */
export function whyGameActionsWait(state: Pick<State, 'busy' | 'gameRunning' | 'gameFolder'>): GameWaiting | null {
  if (state.gameRunning) return 'running'
  if (state.gameRunning === null && !state.busy) return 'check-failed'
  if (state.gameFolder.status === 'missing') return 'folder-missing'
  return null
}
