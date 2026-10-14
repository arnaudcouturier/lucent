// What the first-install choices offer and default to. Pure: the core supplies the card and XIV's screen.
import type { FrameGenerationId, FrameGenerationOption, HdrMode, HdrOption, TierRecipe } from '../shared/manifest'
import { defaultFrameGenerationMode, frameGenerationOptionsForGpu } from './frameGeneration'
import type { PlanSelection } from './planner'
import { resolvedPeakNits, type ResolvedScreen } from './screen'

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

/** The HDR mode a baseline is written with once the choice is made: the stored one where the content offers it, otherwise Off. */
export function storedHdrChoice(recipe: TierRecipe, stored: HdrMode | null): HdrMode | null {
  if (!recipe.hdrOptions?.length) return null
  if (stored && recipe.hdrOptions.some((option) => option.id === stored)) return stored
  return recipe.hdrOptions.some((option) => option.id === 'off') ? 'off' : null
}

/**
 * What a baseline is written from when the first-install choices were made earlier (an update's replace rule, Repair of a
 * missing config): the stored frame generation and HDR modes where the content still offers them, and XIV's screen as it is now.
 */
export function storedSelection(stored: { frameGenerationMode?: FrameGenerationId | null; hdrMode?: HdrMode | null }, recipe: TierRecipe, gpuName: string, screen: ResolvedScreen | null): PlanSelection {
  const frameGenerationOptions = frameGenerationOptionsForGpu(recipe.frameGenerationOptions ?? [], gpuName)
  // A null value means the player chose no frame generation (the 0.1.1 migration
  // also records this explicitly). It must not be treated like the card's current
  // default when a later content version starts offering frame generation.
  const frameGenerationMode = stored.frameGenerationMode == null
    ? frameGenerationOptions.some((option) => option.id === 'off') ? 'off' : null
    : frameGenerationChoice(frameGenerationOptions, stored.frameGenerationMode, screen?.refreshHz ?? 60)
  return {
    gpuName, outputHeight: screen?.height, frameGenerationOptions,
    frameGenerationMode,
    hdrMode: storedHdrChoice(recipe, stored.hdrMode ?? null), hdrOn: screen?.hdrOn ?? false, screen,
  }
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
