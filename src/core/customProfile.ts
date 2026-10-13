import type { ProfileId } from '../shared/manifest'
import type { DeploymentRecord } from './deployment'
import { readIni } from './ini'
import { joinPath } from './paths'
import type { Platform } from './platform'
import { fileKey } from './planner'

/** The selected performance profile after the player changed one of its settings on disk. */
export interface CustomProfile {
  basedOn: ProfileId
  /** The profile's settings whose value on disk differs. */
  changed: { file: string; section: string; key: string }[]
}

/** Compares the selected profile's settings with the deployed configs; null unless one differs. Unreadable configs are drift, the health check's job. */
export async function detectCustomProfile(platform: Platform, record: DeploymentRecord): Promise<CustomProfile | null> {
  const profile = record.recipe.performanceProfiles?.find((p) => p.id === record.profile)
  if (!profile) return null
  const root = joinPath(record.gameFolder, 'game')
  const configs = new Map<string, ReturnType<typeof readIni> | null>()
  const changed: CustomProfile['changed'] = []
  for (const { file, section, key, value } of profile.settings) {
    const config = Object.keys(record.ownedConfigs).find((p) => fileKey(p) === fileKey(file))
    if (!config) continue
    if (!configs.has(config)) configs.set(config, await platform.readText(await platform.resolveGamePath(root, config)).then(readIni, () => null))
    const ini = configs.get(config)
    if (ini && ini.get(section, key) !== value) changed.push({ file: config, section, key })
  }
  return changed.length ? { basedOn: profile.id, changed } : null
}

/** "2 settings changed in the OptiScaler and ReShade overlays". */
export function customProfileSummary(changed: CustomProfile['changed']): string {
  const names = new Map<string, string>()
  for (const { file } of changed) if (!names.has(fileKey(file))) names.set(fileKey(file), file.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, ''))
  const overlays = [...names.values()]
  const list = overlays.length > 1 ? `${overlays.slice(0, -1).join(', ')} and ${overlays.at(-1)}` : overlays[0]
  return `${changed.length} ${changed.length === 1 ? 'setting' : 'settings'} changed in the ${list} ${overlays.length === 1 ? 'overlay' : 'overlays'}`
}
