import {
  DEFAULT_PROFILE, LEGACY_DEFAULT_PROFILE, type LegacyProfileId, type PerformanceProfile, type ProfileId,
  type ProfileSetting, type TierRecipe, type ResolutionColumn,
} from '../shared/manifest'
import type { IniSetting } from '../shared/manifest'
import { frameGenerationSettingKeys } from './frameGeneration'

/** Resolution columns use XIV's output height; 3440×1440 ultrawide therefore uses 1440p. */
export function resolutionColumnForHeight(outputHeight: number): ResolutionColumn {
  return outputHeight < 1300 ? '1080p' : outputHeight < 2000 ? '1440p' : '4k+'
}

/** Turns a manifest profile into the concrete INI values for the resolution XIV is using. */
export function profileSettingsForHeight(profile: PerformanceProfile, outputHeight: number): IniSetting[] {
  const column = resolutionColumnForHeight(outputHeight)
  return profile.settings.map((setting) => ({ ...setting, value: profileValueAt(setting, column) }))
}

/** Uses a concise content-authored Home line when available, otherwise the full profile description. */
export function profileSummaryForHeight(profile: PerformanceProfile, outputHeight: number): string {
  if (profile.summary === undefined) return profile.description
  return typeof profile.summary === 'string' ? profile.summary : profile.summary[resolutionColumnForHeight(outputHeight)]
}

/** Settings that may follow a new monitor resolution without taking back a value the player changed. */
export function profileResolutionSettingsForHeight(
  profile: PerformanceProfile, outputHeight: number,
  currentValue: (file: string, section: string, key: string) => string | undefined,
  lastWrittenValue: (file: string, section: string, key: string) => string | undefined,
  isOwnedByAnotherFeature: (file: string, section: string, key: string) => boolean = () => false,
): IniSetting[] {
  return profile.settings.flatMap((setting) => {
    if (typeof setting.value === 'string' || isOwnedByAnotherFeature(setting.file, setting.section, setting.key)) return []
    const { file, section, key } = setting
    const current = currentValue(file, section, key)
    const baseline = lastWrittenValue(file, section, key)
    if (current === undefined || baseline === undefined || !sameIniValue(current, baseline)) return []
    return [{ file, section, key, value: profileValueAt(setting, resolutionColumnForHeight(outputHeight)) }]
  })
}

/** INI overlays can serialize booleans, numbers and case differently without changing their meaning. */
export function sameIniValue(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
    || (left !== '' && right.trim() !== '' && Number(left) === Number(right))
}

/** Setting keys whose values are managed by a screen-derived or frame-generation choice. */
export function profileOwnedElsewhereSettingKeys(recipe: TierRecipe): Set<string> {
  return new Set([
    ...frameGenerationSettingKeys(recipe.frameGenerationOptions ?? []),
    ...(recipe.screenDerivedSettings ?? []).map(({ file, section, key }) => `${file.replace(/\\/g, '/').toLowerCase()}|${section.toLowerCase()}|${key.toLowerCase()}`),
  ])
}

function profileValueAt(setting: ProfileSetting, column: ResolutionColumn): string {
  return typeof setting.value === 'string' ? setting.value : setting.value[column]
}

/** New recipes use their first matching recommended profile; an unmatched card gets Balanced. */
export function recommendedProfile(profiles: PerformanceProfile[], gpuName: string): PerformanceProfile | null {
  const recommended = profiles.find((profile) => profile.gpuNamePatterns?.some((pattern) => new RegExp(pattern, 'i').test(gpuName)))
  return recommended ?? profiles.find((profile) => profile.id === DEFAULT_PROFILE) ?? profiles[0] ?? null
}

/** Uses the new four-profile field when present, otherwise exposes old profiles through the shared UI shape. */
export function profilesForRecipe(recipe: TierRecipe): PerformanceProfile[] {
  if (recipe.performanceProfilesV2 !== undefined) return recipe.performanceProfilesV2
  return (recipe.performanceProfiles ?? []).map((profile) => ({ ...profile, settings: profile.settings }))
}

/** Legacy recipes retain Fidelity as their default; four-profile recipes use the card recommendation. */
export function defaultProfileForRecipe(recipe: TierRecipe, gpuName: string): ProfileId | null {
  if (recipe.performanceProfilesV2 !== undefined) return recommendedProfile(recipe.performanceProfilesV2, gpuName)?.id ?? null
  return recipe.performanceProfiles?.length ? LEGACY_DEFAULT_PROFILE : null
}

/** Chooses the profile to apply to an update or tier switch while preserving the deployed choice where possible. */
export function selectProfileForUpdate(
  target: TierRecipe, previous: TierRecipe, selected: ProfileId | null, gpuName: string,
): ProfileId | null {
  if (target.performanceProfilesV2 !== undefined) {
    // Legacy Fidelity meant two passes. The new Fidelity means one, so move it once to Ultra.
    if (previous.performanceProfilesV2 === undefined && previous.performanceProfiles?.some((profile) => profile.id === 'fidelity')
      && selected === 'fidelity' && target.performanceProfilesV2.some((profile) => profile.id === 'ultra')) return 'ultra'
    if (selected && target.performanceProfilesV2.some((profile) => profile.id === selected)) return selected
    return recommendedProfile(target.performanceProfilesV2, gpuName)?.id ?? null
  }
  if (selected && target.performanceProfiles?.some((profile) => profile.id === selected as LegacyProfileId)) return selected
  return target.performanceProfiles?.length ? LEGACY_DEFAULT_PROFILE : null
}
