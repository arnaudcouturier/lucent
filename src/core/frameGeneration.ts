import { FRAME_GENERATION_IDS, type FrameGenerationId, type FrameGenerationOption, type IniSetting } from '../shared/manifest'

const settingId = ({ file, section, key }: Pick<IniSetting, 'file' | 'section' | 'key'>) =>
  `${file.replace(/\\/g, '/').toLowerCase()}\0${section.toLowerCase()}\0${key.toLowerCase()}`

/** Normalized INI keys owned by every available frame-generation variant in a deployed recipe. */
export function frameGenerationSettingKeys(options: FrameGenerationOption[]): Set<string> {
  return new Set(options.flatMap((option) => [...option.settings, ...(option.hdrSettings ?? [])].map(({ file, section, key }) =>
    `${file.replace(/\\/g, '/').toLowerCase()}|${section.toLowerCase()}|${key.toLowerCase()}`)))
}

/** Returns one matching manifest variant per mode, in the fixed Off, 2×–6×, Dynamic order. */
export function frameGenerationOptionsForGpu(options: FrameGenerationOption[], gpuName: string): FrameGenerationOption[] {
  const matching = options.filter((option) => !option.gpuNamePatterns?.length
    || option.gpuNamePatterns.some((pattern) => new RegExp(pattern, 'i').test(gpuName)))
  return FRAME_GENERATION_IDS.flatMap((id) => {
    const variants = matching.filter((option) => option.id === id)
    // A GPU-specific option replaces a generic option with the same id. If multiple specific patterns
    // match, manifest order is the deterministic tie-breaker.
    const chosen = variants.find((option) => !!option.gpuNamePatterns?.length) ?? variants[0]
    return chosen ? [chosen] : []
  })
}

/** Defaults to 2× at 120 Hz or higher and Off below; use the first offered mode when that choice is absent. */
export function defaultFrameGenerationMode(options: FrameGenerationOption[], refreshHz: number): FrameGenerationId | null {
  if (!options.length) return null
  // 119.88 Hz panels are 120 Hz screens, and Windows' whole-number rate calls them 119.
  const preferred: FrameGenerationId = refreshHz >= 119 ? '2x' : 'off'
  return options.some((option) => option.id === preferred) ? preferred : options[0].id
}

/** Combines an option's base values with any HDR-on overrides, replacing matching keys in place. */
export function effectiveFrameGenerationSettings(option: FrameGenerationOption, hdrOn: boolean): IniSetting[] {
  const values = new Map<string, IniSetting>()
  for (const setting of option.settings) values.set(settingId(setting), setting)
  if (hdrOn) for (const setting of option.hdrSettings ?? []) values.set(settingId(setting), setting)
  return [...values.values()]
}

/** The one-line explanation of the cap, multiplier or Dynamic mode. */
export function frameGenerationDescription(mode: FrameGenerationId, frameCap: number, refreshHz: number): string {
  const cap = format(frameCap)
  const refresh = format(refreshHz)
  if (mode === 'off') return `Capped at ${cap} fps for your ${refresh} Hz screen`
  if (mode === 'dynamic') return `Aims for ${cap} fps on your ${refresh} Hz screen`
  const multiplier = Number(mode.slice(0, -1))
  return `XIV renders up to ${Math.floor(frameCap / multiplier)} fps, shown at ${cap} on your ${refresh} Hz screen`
}

function format(value: number) {
  return Number.isInteger(value) ? String(value) : new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value)
}
