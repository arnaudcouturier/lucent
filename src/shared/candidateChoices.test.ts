import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseManifest, type SettingChoice } from './manifest'
import { SETTING_CHOICE_MANIFEST } from '../platform/contentFixture'
import { resolveSettingChoices, settingChoiceSettings, shownSettingChoices } from '../core/settingChoices'

// The setting choices the content candidates declare, read from their recipes: a typo in one would only show up at publication.
const CANDIDATES = 'content/candidates'
const recipes = readdirSync(CANDIDATES).flatMap((id) => {
  try {
    const recipe = JSON.parse(readFileSync(`${CANDIDATES}/${id}/recipe.json`, 'utf8')) as { id: string; settingChoices?: SettingChoice[] }
    return recipe.settingChoices ? [recipe as { id: string; settingChoices: SettingChoice[] }] : []
  } catch { return [] }
})
const asManifest = (choices: SettingChoice[]) => JSON.stringify({
  ...SETTING_CHOICE_MANIFEST,
  versions: SETTING_CHOICE_MANIFEST.versions.map((content) => ({
    ...content,
    tiers: Object.fromEntries(Object.entries(content.tiers).map(([id, tier]) => [id, id.startsWith('rtx-') ? { ...tier, settingChoices: choices } : tier])),
  })),
})
const latest = recipes.at(-1)!
const ctx = (gpuName: string, frameGenerationMode: '2x' | 'off' = '2x', passes = 1) => ({ gpuName, frameGenerationMode, hdrMode: 'off' as const, passes })
const keys = (choices: SettingChoice[], resolved: Record<string, string>) => Object.fromEntries(settingChoiceSettings(choices, resolved).map((s) => [`${s.section}.${s.key}`, s.value]))

describe('the setting choices of the content candidates', () => {
  it.each(recipes.map((recipe) => [recipe.id, recipe] as const))('%s declares choices the manifest schema accepts', (_, recipe) => {
    expect(() => parseManifest(asManifest(recipe.settingChoices))).not.toThrow()
  })

  it('offers the DLSS model, UI mode and DLSS-G preset, in that order, from the latest candidate', () => {
    expect(latest.settingChoices.map((choice) => choice.id)).toEqual(['dlss-model', 'ui-mode', 'dlssg-preset'])
  })

  it('writes Preset M by default, which is what content has shipped for every mode', () => {
    const resolved = resolveSettingChoices(latest.settingChoices, undefined, ctx('NVIDIA GeForce RTX 4090'))
    expect(resolved['dlss-model']).toBe('m')
    expect(keys(latest.settingChoices, resolved)).toMatchObject({ 'DLSS.RenderPresetOverride': 'true', 'DLSS.RenderPresetForAll': '13' })
  })

  it.each([
    ['default', 'false', '0'], ['j', 'true', '10'], ['k', 'true', '11'], ['l', 'true', '12'], ['m', 'true', '13'], ['e', 'true', '5'], ['f', 'true', '6'],
  ])('writes the DLSS model %s as Override=%s and ForAll=%s', (option, override, preset) => {
    const resolved = resolveSettingChoices(latest.settingChoices, { 'dlss-model': option }, ctx('NVIDIA GeForce RTX 3080'))
    expect(resolved['dlss-model']).toBe(option)
    expect(keys(latest.settingChoices, resolved)).toMatchObject({ 'DLSS.RenderPresetOverride': override, 'DLSS.RenderPresetForAll': preset })
  })

  it('offers the presets NVIDIA leaves usable, then the deprecated E and F as Experimental, and nothing NVIDIA says is gone', () => {
    const model = latest.settingChoices.find((choice) => choice.id === 'dlss-model')!
    expect(model.options.map((option) => option.id)).toEqual(['default', 'j', 'k', 'l', 'm', 'e', 'f'])
    expect(model.options.filter((option) => option.experimental).map((option) => option.id)).toEqual(['e', 'f'])
    // NVIDIA's Streamline 2.14.16 header: A to D removed, G to I, N and O revert to the default.
    for (const gone of ['a', 'b', 'c', 'd', 'g', 'h', 'i', 'n', 'o']) expect(model.options.map((option) => option.id)).not.toContain(gone)
  })

  it('keeps Preset M the default, with E and F only ever picked', () => {
    const model = latest.settingChoices.find((choice) => choice.id === 'dlss-model')!
    expect(model.defaultOption).toBe('m')
    expect(resolveSettingChoices(latest.settingChoices, undefined, ctx('NVIDIA GeForce RTX 4090'))['dlss-model']).toBe('m')
  })

  it('shows the DLSS model to every NVIDIA card, with frame generation on or off, and the other two only where DLSS frame generation runs', () => {
    const ids = (gpuName: string, mode: '2x' | 'off') => shownSettingChoices(latest.settingChoices, undefined, ctx(gpuName, mode)).map((c) => c.choice.id)
    expect(ids('NVIDIA GeForce RTX 4090', '2x')).toEqual(['dlss-model', 'ui-mode', 'dlssg-preset'])
    expect(ids('NVIDIA GeForce RTX 4090', 'off')).toEqual(['dlss-model'])
    expect(ids('NVIDIA GeForce RTX 3080', '2x')).toEqual(['dlss-model'])
    expect(ids('NVIDIA GeForce RTX 2080 Ti', 'off')).toEqual(['dlss-model'])
  })
})
