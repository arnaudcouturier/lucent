// The Neural Rendering controls the Profile step offers in place of performance profiles. Pure: the core supplies the card and XIV's screen.
import {
  NR_PASSES, NR_SCALES, type FrameGenerationId, type FrameGenerationOption, type IniSetting, type MfgUnlock, type NeuralRenderingChoice,
  type NeuralRenderingControls, type NrPasses, type NrPresetId, type NrScale, type TierRecipe,
} from '../shared/manifest'

const matches = (patterns: string[], gpuName: string) => patterns.some((pattern) => new RegExp(pattern, 'i').test(gpuName))

/** The scale is written as a fraction of the frame: 75 → 0.750000. */
export const scaleValue = (scale: NrScale) => (scale / 100).toFixed(6)
export const scaleLabel = (scale: NrScale) => `${scale}%`
/** DLAA already costs the most, so it gets a lower starting point. The player decides. */
export const SUGGESTED_DLAA_SCALE: NrScale = 75

/** The card's first-install picks: the first matching default's preset and passes, full-resolution Neural Rendering and both toggles off. */
export function defaultNeuralRendering(controls: NeuralRenderingControls, gpuName: string): NeuralRenderingChoice {
  const found = controls.defaults.find((d) => !d.gpuNamePatterns || matches(d.gpuNamePatterns, gpuName)) ?? controls.defaults.at(-1)!
  return { preset: found.preset, passes: found.passes, scale: 100, spatialCompression: false, residualFg: false }
}

/** Residual frame generation needs NVIDIA frame generation: an RTX 40/50 card with frame generation on. */
export function residualFgAvailable(controls: NeuralRenderingControls, gpuName: string, frameGenerationMode: FrameGenerationId | null): boolean {
  return !!frameGenerationMode && frameGenerationMode !== 'off' && matches(controls.residualFg.gpuNamePatterns, gpuName)
}

/** Whether the card is one the residual toggle is meant for, whatever frame generation is set to. */
export const residualFgCardMatches = (controls: NeuralRenderingControls, gpuName: string) => matches(controls.residualFg.gpuNamePatterns, gpuName)

/** What an extra percentage of Neural Rendering resolution costs, relative to 100%: it falls with the square. */
export const scaleCostPercent = (scale: NrScale) => Math.round((scale / 100) ** 2 * 100)

/** Keeps a pick the controls still offer and removes one they don't: unknown values fall back to the default, a toggle the card can't use is off. */
export function normalizeNeuralRendering(
  choice: Partial<NeuralRenderingChoice> | null | undefined, controls: NeuralRenderingControls, gpuName: string, frameGenerationMode: FrameGenerationId | null,
): NeuralRenderingChoice {
  const base = defaultNeuralRendering(controls, gpuName)
  const preset: NrPresetId = controls.presets.some((p) => p.id === choice?.preset) ? choice!.preset! : base.preset
  const passes: NrPasses = (NR_PASSES as readonly unknown[]).includes(choice?.passes) ? choice!.passes! : base.passes
  const scale: NrScale = (NR_SCALES as readonly unknown[]).includes(choice?.scale) ? choice!.scale! : base.scale
  return {
    preset, passes, scale, spatialCompression: choice?.spatialCompression === true,
    residualFg: choice?.residualFg === true && residualFgAvailable(controls, gpuName, frameGenerationMode),
  }
}

/** The INI values a pick writes. */
export function neuralRenderingSettings(controls: NeuralRenderingControls, choice: NeuralRenderingChoice): IniSetting[] {
  const preset = controls.presets.find((p) => p.id === choice.preset) ?? controls.presets[0]
  return [
    { ...controls.presetKey, value: preset.value },
    { ...controls.passesKey, value: String(choice.passes) },
    { ...controls.scaleKey, value: scaleValue(choice.scale) },
    { ...controls.spatialCompression.key, value: String(choice.spatialCompression) },
    { ...controls.residualFg.key, value: String(choice.residualFg) },
  ]
}

/** "Quality · 2 passes · 100%": the one line Review and Done use. */
export function neuralRenderingSummary(controls: NeuralRenderingControls | null, choice: NeuralRenderingChoice): string {
  const label = controls?.presets.find((p) => p.id === choice.preset)?.label ?? choice.preset
  return `${label} · ${choice.passes} ${choice.passes === 1 ? 'pass' : 'passes'} · ${scaleLabel(choice.scale)}`
}

/** The toggles that are on, by their labels, for Review and Done. */
export function neuralRenderingExtras(controls: NeuralRenderingControls | null, choice: NeuralRenderingChoice): string[] {
  return [
    ...(choice.spatialCompression ? [controls?.spatialCompression.label ?? 'Spatial compression'] : []),
    ...(choice.residualFg ? [controls?.residualFg.label ?? 'Residual frame generation'] : []),
  ]
}

/** What a preset renders at on XIV's screen, such as 2560×1440 for Quality at 4K. */
export function presetRenderResolution(ratio: number, width: number, height: number): { width: number; height: number } {
  return { width: Math.round(width / ratio), height: Math.round(height / ratio) }
}

/** The multi-frame unlock where the card is offered it, else null. */
export function mfgUnlockFor(recipe: TierRecipe | undefined, gpuName: string): MfgUnlock | null {
  const unlock = recipe?.mfgUnlock
  return unlock && matches(unlock.gpuNamePatterns, gpuName) ? unlock : null
}

/** Without the unlock, the modes it gates are not offered. */
export function frameGenerationOptionsForUnlock(options: FrameGenerationOption[], unlock: MfgUnlock | null, unlocked: boolean): FrameGenerationOption[] {
  return unlock && !unlocked ? options.filter((option) => !unlock.gates.includes(option.id)) : options
}

/** The unlock's INI values apply when it is offered and on. */
export function mfgUnlockSettings(unlock: MfgUnlock | null, unlocked: boolean): IniSetting[] {
  return unlock && unlocked ? unlock.settings : []
}
