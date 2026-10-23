// The tier's setting choices: which the card is offered, which option each holds and the ini keys that follow. Pure: the core
// supplies the card, the frame-generation mode and the HDR mode. The stored picks may be stale or blocked by a choice above, so
// everything that writes or shows a choice goes through `resolveSettingChoices` rather than reading the picks.
import type { FrameGenerationId, HdrMode, IniSetting, SettingChoice, SettingChoiceOption } from '../shared/manifest'

/** Option ids by choice id. */
export type SettingPicks = Record<string, string>

export interface ChoiceContext {
  gpuName: string
  frameGenerationMode: FrameGenerationId | null
  hdrMode: HdrMode | null
}

const offeredTo = (choice: SettingChoice, gpuName: string) =>
  !choice.gpuNamePatterns || choice.gpuNamePatterns.some((pattern) => new RegExp(pattern, 'i').test(gpuName))

/** Why the option can't be picked now, given what the choices above it hold; null when it can. */
export function optionBlock(choice: SettingChoice, option: SettingChoiceOption, above: SettingPicks, context: ChoiceContext): string | null {
  for (const block of option.blockedWhen ?? []) {
    if (block.hdr && context.hdrMode !== null && context.hdrMode !== 'off') return block.reason
    if (block.choice && block.choice.options.includes(above[block.choice.id])) return block.reason
  }
  return null
}

/**
 * The option each choice is written with. A pick that is unknown or blocked gives way to the choice's default, or to its first
 * free option when the default is blocked too (the manifest guarantees one is free). A choice the card isn't offered writes its
 * `unofferedOption`, or nothing. Frame generation Off changes nothing here: the picks are written either way.
 */
export function resolveSettingChoices(choices: SettingChoice[] | undefined, picks: SettingPicks | null | undefined, context: ChoiceContext): SettingPicks {
  const resolved: SettingPicks = {}
  for (const choice of choices ?? []) {
    if (!offeredTo(choice, context.gpuName)) {
      if (choice.unofferedOption) resolved[choice.id] = choice.unofferedOption
      continue
    }
    const free = (id: string) => {
      const option = choice.options.find((o) => o.id === id)
      return !!option && optionBlock(choice, option, resolved, context) === null
    }
    const pick = picks?.[choice.id]
    const found = [pick, choice.defaultOption, ...choice.options.map((o) => o.id)].find((id): id is string => id !== undefined && free(id))
    if (found) resolved[choice.id] = found
  }
  return resolved
}

/** The ini keys of the resolved options, in the order of the choices. */
export function settingChoiceSettings(choices: SettingChoice[] | undefined, resolved: SettingPicks): IniSetting[] {
  return (choices ?? []).flatMap((choice) => choice.options.find((option) => option.id === resolved[choice.id])?.settings ?? [])
}

export interface ShownChoice {
  choice: SettingChoice
  selected: string
  options: { option: SettingChoiceOption; blocked: string | null }[]
}

/** The choices the Graphics step shows: offered to the card and, where they need it, with frame generation on. */
export function shownSettingChoices(choices: SettingChoice[] | undefined, picks: SettingPicks | null | undefined, context: ChoiceContext): ShownChoice[] {
  const resolved = resolveSettingChoices(choices, picks, context)
  const frameGenerationOn = context.frameGenerationMode !== null && context.frameGenerationMode !== 'off'
  return (choices ?? []).flatMap((choice) => {
    if (!offeredTo(choice, context.gpuName) || (choice.needsFrameGeneration && !frameGenerationOn)) return []
    return [{
      choice, selected: resolved[choice.id],
      options: choice.options.map((option) => ({ option, blocked: optionBlock(choice, option, resolved, context) })),
    }]
  })
}
