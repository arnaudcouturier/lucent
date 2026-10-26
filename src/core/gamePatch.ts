// Settings' "After a game patch" switch: OptiScaler-FFXIV (v0.3.0 on) finds the game's code addresses by searching the executable, and
// after an XIV patch runs the features that read or hook the game's code only when `[FFXIV] FfxivUnknownBuildHooks` is `true`.
// The key has no control in OptiScaler's menu; this reads it, and `setUnknownBuildHooks` (deployment.ts) writes it.
import type { Platform } from './platform'
import { readConfig, type ConfigRead } from './configs'
import { readIni } from './ini'
import { joinPath } from './paths'
import { UNKNOWN_BUILD_HOOKS } from './planner'

/** `on` is the key reading `true`; `auto` (the ini's own value, off) and `false` both read off. */
export type PatchSwitch = { status: 'ready'; on: boolean } | { status: 'unavailable'; reason: string }

export const NEEDS_NEWER_CONTENT = 'This setup’s OptiScaler.ini doesn’t have the setting yet. Update to the newest content first.'

/** Why the ini can't be read or changed, in words for the Settings card. */
export function patchSwitchProblem(read: ConfigRead): string {
  switch (read.kind) {
    case 'missing': return 'OptiScaler.ini is missing. Repair puts it back.'
    case 'locked': return 'OptiScaler.ini is open in another program.'
    default: return 'Lucent can’t read OptiScaler.ini.'
  }
}

/** The switch as OptiScaler.ini says now. */
export async function readPatchSwitch(platform: Platform, gameFolder: string): Promise<PatchSwitch> {
  const read = await readConfig(platform, await platform.resolveGamePath(joinPath(gameFolder, 'game'), UNKNOWN_BUILD_HOOKS.file))
  if (read.kind !== 'readable') return { status: 'unavailable', reason: patchSwitchProblem(read) }
  const value = readIni(read.text).get(UNKNOWN_BUILD_HOOKS.section, UNKNOWN_BUILD_HOOKS.key)
  return value === undefined ? { status: 'unavailable', reason: NEEDS_NEWER_CONTENT } : { status: 'ready', on: value.trim().toLowerCase() === 'true' }
}
