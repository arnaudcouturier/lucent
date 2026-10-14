// What the first-install choices offer and default to. Pure: the core supplies the card and XIV's screen.
import type { FrameGenerationId, FrameGenerationOption, HdrMode, HdrOption, TierRecipe } from '../shared/manifest'
import { defaultFrameGenerationMode, frameGenerationOptionsForGpu } from './frameGeneration'
import { resolvedPeakNits } from './screen'

export interface ChoiceOptions {
  /** Filtered to the card, in the fixed Off, 2×–6×, Dynamic order. */
  frameGenerationOptions: FrameGenerationOption[]
  /** Empty unless XIV's monitor supports HDR. */
  hdrOptions: HdrOption[]
}

export function choiceOptions(recipe: TierRecipe, gpuName: string, hdrMonitor: boolean): ChoiceOptions {
  return {
    frameGenerationOptions: frameGenerationOptionsForGpu(recipe.frameGenerationOptions ?? [], gpuName),
    hdrOptions: hdrMonitor ? recipe.hdrOptions ?? [] : [],
  }
}

/** A pick the card still offers stays; otherwise 2× from 120 Hz and Off below. */
export function frameGenerationChoice(options: FrameGenerationOption[], current: FrameGenerationId | null, refreshHz: number): FrameGenerationId | null {
  return current && options.some((option) => option.id === current) ? current : defaultFrameGenerationMode(options, refreshHz)
}

/** HDR by default. A monitor without HDR is Off, which the config files say outright; content without HDR has no mode. */
export function hdrChoice(recipe: TierRecipe, offered: HdrOption[], current: HdrMode | null): HdrMode | null {
  if (!recipe.hdrOptions?.length) return null
  if (!offered.length) return recipe.hdrOptions.some((option) => option.id === 'off') ? 'off' : null
  if (current && offered.some((option) => option.id === current)) return current
  return offered.find((option) => option.id === 'hdr')?.id ?? offered[0].id
}

export interface HdrFacts {
  /** Windows HDR is on for XIV's monitor. */
  windowsHdrOn: boolean
  nvidia: boolean
  peakNits: number | null
}

/** The line under the HDR control: what the mode does, then what the player should know. The first entry is the line itself. */
export function hdrDescription(mode: HdrMode, facts: HdrFacts): string[] {
  if (mode === 'off') return ['XIV stays SDR.']
  const nits = new Intl.NumberFormat('en').format(resolvedPeakNits(facts.peakNits))
  return [
    mode === 'hdr' ? 'Expands XIV’s SDR image to HDR.' : 'Uses OptiScaler’s scene method, which can look better but is less tested.',
    ...(facts.windowsHdrOn ? [] : ['Windows HDR is off, so XIV stays SDR until you turn it on (Win+Alt+B).']),
    'Lucent turns Windows Auto HDR off for XIV.',
    `Peak brightness is ${nits} nits, from your monitor; the Windows HDR Calibration app fixes a wrong value.`,
    ...(facts.nvidia ? ['Turn RTX HDR off for XIV in the NVIDIA app; Lucent can’t.'] : []),
  ]
}

/** How a frame generation mode reads on the Profile step, Review and Done. */
export const frameGenerationLabel = (mode: FrameGenerationId) => mode === 'off' ? 'Off' : mode === 'dynamic' ? 'Dynamic' : `${mode.slice(0, -1)}×`

export const hdrLabel = (mode: HdrMode) => mode === 'off' ? 'Off' : mode === 'hdr' ? 'HDR' : 'Scene HDR'
