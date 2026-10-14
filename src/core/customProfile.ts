import type { ProfileId } from '../shared/manifest'
import type { DeploymentRecord } from './deployment'
import { readIni, sameIniValue } from './ini'
import { joinPath } from './paths'
import type { Platform } from './platform'
import { fileKey } from './planner'
import { profileOwnedElsewhereSettingKeys, profileSettingsForHeight, profilesForRecipe } from './profileValues'

/** One of the profile's settings whose value on disk differs. */
export interface ChangedSetting { file: string; section: string; key: string; value: string | undefined }

/** The selected performance profile after the player changed one of its settings on disk. */
export interface CustomProfile {
  basedOn: ProfileId
  changed: ChangedSetting[]
}

/** Compares profile settings with Lucent's last-written copy; unreadable configs are drift, the health check's job. */
export async function detectCustomProfile(platform: Platform, record: DeploymentRecord, outputHeight = 2160): Promise<CustomProfile | null> {
  const profile = profilesForRecipe(record.recipe).find((p) => p.id === record.profile)
  if (!profile) return null
  const root = joinPath(record.gameFolder, 'game')
  const configs = new Map<string, { disk: ReturnType<typeof readIni> | null; baseline: ReturnType<typeof readIni> | null }>()
  const changed: ChangedSetting[] = []
  const profileKeys = profileOwnedElsewhereSettingKeys(record.recipe)
  for (const { file, section, key } of profileSettingsForHeight(profile, outputHeight)) {
    if (profileKeys.has(`${fileKey(file)}|${section.toLowerCase()}|${key.toLowerCase()}`)) continue
    const config = Object.keys(record.ownedConfigs).find((p) => fileKey(p) === fileKey(file))
    if (!config) continue
    if (!configs.has(config)) {
      const disk = await platform.readText(await platform.resolveGamePath(root, config)).then(readIni, () => null)
      const baseline = typeof record.ownedConfigs[config] === 'string' ? readIni(record.ownedConfigs[config]) : null
      configs.set(config, { disk, baseline })
    }
    const configState = configs.get(config)!
    const disk = configState.disk?.get(section, key)
    const baseline = configState.baseline?.get(section, key)
    if (configState.disk && (baseline === undefined || disk === undefined || !sameIniValue(disk, baseline))) changed.push({ file: config, section, key, value: disk })
  }
  return changed.length ? { basedOn: profile.id, changed } : null
}

/** "Passes set to 2" or a compact list of the user's changed setting values. */
export function customProfileSummary(changed: ChangedSetting[]): string {
  return changed.map(({ key, value }) => value === undefined ? `${key} removed` : value === '' ? `${key} cleared` : `${key} set to ${value}`).join(', ')
}
