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

  it('offers the DLSS model, UI mode, DLSS-G preset, the character preview and the three pass preset hints, in that order, from the latest candidate', () => {
    expect(latest.settingChoices.map((choice) => choice.id)).toEqual(['dlss-model', 'ui-mode', 'dlssg-preset', 'preview-nr', 'nr-hint-pass-1', 'nr-hint-pass-2', 'nr-hint-pass-3'])
  })

  it('writes the preset hints the content shipped before by default, so nothing changes until a player picks', () => {
    // The base ini carries Preset=1, Pass2Preset=0 and Pass3Preset=0, from the maintainer's own saved values.
    const resolved = resolveSettingChoices(latest.settingChoices, undefined, ctx('NVIDIA GeForce RTX 4090'))
    expect(resolved).toMatchObject({ 'nr-hint-pass-1': 'preset-1', 'nr-hint-pass-2': 'default', 'nr-hint-pass-3': 'default' })
    expect(keys(latest.settingChoices, resolved)).toMatchObject({ 'DlssNr.Preset': '1', 'DlssNr.Pass2Preset': '0', 'DlssNr.Pass3Preset': '0' })
  })

  it('turns the character preview’s Neural Rendering off by default, and writes On as true', () => {
    const preview = latest.settingChoices.find((choice) => choice.id === 'preview-nr')!
    expect(preview.defaultOption).toBe('off')
    expect(preview.options.map((option) => option.id)).toEqual(['off', 'on'])
    const written = (picks?: Record<string, string>) => keys(latest.settingChoices, resolveSettingChoices(latest.settingChoices, picks, ctx('NVIDIA GeForce RTX 4090')))['FFXIV.PreviewNR']
    expect(written()).toBe('false')
    expect(written({ 'preview-nr': 'on' })).toBe('true')
    expect(written({ 'preview-nr': 'off' })).toBe('false')
    // Players are told why: it takes a lot of video memory for each open preview window.
    expect(preview.options.map((option) => option.description)).toEqual([expect.stringMatching(/lot of video memory/), expect.stringMatching(/lot of video memory/)])
    // A plain block in the Neural Rendering card, ahead of the hints' collapsed group so that group stays last.
    expect(preview.placement).toEqual({ in: 'neural-rendering' })
    expect(preview.minPasses).toBeUndefined()
    expect(latest.settingChoices.findIndex((choice) => choice.id === 'preview-nr')).toBeLessThan(latest.settingChoices.findIndex((choice) => choice.id === 'nr-hint-pass-1'))
  })

  it('maps the hint options to the values the fork reads: 0 to 3, and auto for a later pass to inherit pass 1', () => {
    const value = (id: string, option: string) => keys(latest.settingChoices, resolveSettingChoices(latest.settingChoices, { [id]: option }, ctx('NVIDIA GeForce RTX 4090')))
    expect(['default', 'preset-1', 'preset-2', 'preset-3'].map((option) => value('nr-hint-pass-1', option)['DlssNr.Preset'])).toEqual(['0', '1', '2', '3'])
    expect(['auto', 'default', 'preset-1', 'preset-2', 'preset-3'].map((option) => value('nr-hint-pass-2', option)['DlssNr.Pass2Preset'])).toEqual(['auto', '0', '1', '2', '3'])
    expect(['auto', 'default', 'preset-1', 'preset-2', 'preset-3'].map((option) => value('nr-hint-pass-3', option)['DlssNr.Pass3Preset'])).toEqual(['auto', '0', '1', '2', '3'])
    // Pass 1 has no inherit option: it has nothing to inherit from.
    expect(latest.settingChoices.find((choice) => choice.id === 'nr-hint-pass-1')!.options.map((option) => option.id)).toEqual(['default', 'preset-1', 'preset-2', 'preset-3'])
  })

  it('puts the hints inside the Neural Rendering card under one collapsed group, the second and third needing that many passes', () => {
    const hints = latest.settingChoices.filter((choice) => choice.id.startsWith('nr-hint-'))
    expect(hints.map((choice) => [choice.minPasses ?? null, choice.placement?.in])).toEqual([[null, 'neural-rendering'], [2, 'neural-rendering'], [3, 'neural-rendering']])
    expect(new Set(hints.map((choice) => choice.placement?.group)).size).toBe(1)
    expect(hints[0].placement?.group).toMatch(/effect unverified/)
    expect(latest.settingChoices.filter((choice) => !choice.id.startsWith('nr-hint-') && choice.id !== 'preview-nr').every((choice) => !choice.placement)).toBe(true)
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

  it('shows the DLSS model, the character preview and the Pass 1 hint to every NVIDIA card, with frame generation on or off, and the UI mode and DLSS-G preset only where DLSS frame generation runs', () => {
    const ids = (gpuName: string, mode: '2x' | 'off', passes = 1) => shownSettingChoices(latest.settingChoices, undefined, ctx(gpuName, mode, passes)).map((c) => c.choice.id)
    expect(ids('NVIDIA GeForce RTX 4090', '2x')).toEqual(['dlss-model', 'ui-mode', 'dlssg-preset', 'preview-nr', 'nr-hint-pass-1'])
    expect(ids('NVIDIA GeForce RTX 4090', 'off')).toEqual(['dlss-model', 'preview-nr', 'nr-hint-pass-1'])
    expect(ids('NVIDIA GeForce RTX 3080', '2x')).toEqual(['dlss-model', 'preview-nr', 'nr-hint-pass-1'])
    expect(ids('NVIDIA GeForce RTX 2080 Ti', 'off')).toEqual(['dlss-model', 'preview-nr', 'nr-hint-pass-1'])
  })

  it('shows the Pass 2 hint from two passes and the Pass 3 hint from three, on every NVIDIA card', () => {
    const hints = (gpuName: string, passes: number | null) => shownSettingChoices(latest.settingChoices, undefined, { ...ctx(gpuName, 'off'), passes }).map((c) => c.choice.id).filter((id) => id.startsWith('nr-hint-'))
    for (const gpu of ['NVIDIA GeForce RTX 5090', 'NVIDIA GeForce RTX 4090', 'NVIDIA GeForce RTX 3080', 'NVIDIA GeForce RTX 2080 Ti']) {
      expect(hints(gpu, 1)).toEqual(['nr-hint-pass-1'])
      expect(hints(gpu, 2)).toEqual(['nr-hint-pass-1', 'nr-hint-pass-2'])
      expect(hints(gpu, 3)).toEqual(['nr-hint-pass-1', 'nr-hint-pass-2', 'nr-hint-pass-3'])
    }
    // A tier with no Neural Rendering passes control has no passes to hint.
    expect(hints('NVIDIA GeForce RTX 4090', null)).toEqual(['nr-hint-pass-1'])
  })
})
