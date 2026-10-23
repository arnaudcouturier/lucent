import { describe, expect, it } from 'vitest'
import { SETTING_CHOICES } from '../platform/contentFixture'
import { optionBlock, resolveSettingChoices, settingChoiceSettings, settingChoiceSummary, shownSettingChoices, type ChoiceContext } from './settingChoices'

const rtx4090: ChoiceContext = { gpuName: 'NVIDIA GeForce RTX 4090', frameGenerationMode: '2x', hdrMode: 'off' }
const [ui, preset] = SETTING_CHOICES

describe('resolving the setting choices', () => {
  it('uses each choice’s default until the player picks', () => {
    expect(resolveSettingChoices(SETTING_CHOICES, undefined, rtx4090)).toEqual({ 'ui-mode': 'recomposition', 'dlssg-preset': 'auto' })
    expect(resolveSettingChoices(SETTING_CHOICES, null, rtx4090)).toEqual({ 'ui-mode': 'recomposition', 'dlssg-preset': 'auto' })
    expect(resolveSettingChoices(SETTING_CHOICES, {}, rtx4090)).toEqual({ 'ui-mode': 'recomposition', 'dlssg-preset': 'auto' })
  })

  it('keeps a pick that is allowed', () => {
    expect(resolveSettingChoices(SETTING_CHOICES, { 'ui-mode': 'off', 'dlssg-preset': 'c' }, rtx4090)).toEqual({ 'ui-mode': 'off', 'dlssg-preset': 'c' })
    expect(resolveSettingChoices(SETTING_CHOICES, { 'ui-mode': 'ui-free', 'dlssg-preset': 'a' }, rtx4090)).toEqual({ 'ui-mode': 'ui-free', 'dlssg-preset': 'a' })
    expect(resolveSettingChoices(SETTING_CHOICES, { 'ui-mode': 'recomposition', 'dlssg-preset': 'b' }, rtx4090)).toEqual({ 'ui-mode': 'recomposition', 'dlssg-preset': 'b' })
  })

  it('writes the default for a preset that recomposition turns off, and keeps the pick for when recomposition goes', () => {
    const picks = { 'ui-mode': 'recomposition', 'dlssg-preset': 'c' }
    expect(resolveSettingChoices(SETTING_CHOICES, picks, rtx4090)['dlssg-preset']).toBe('auto')
    expect(resolveSettingChoices(SETTING_CHOICES, { ...picks, 'ui-mode': 'off' }, rtx4090)['dlssg-preset']).toBe('c')
  })

  it('writes the default for UI-free while HDR is on, and the stored UI-free comes back with HDR off', () => {
    const picks = { 'ui-mode': 'ui-free' }
    expect(resolveSettingChoices(SETTING_CHOICES, picks, { ...rtx4090, hdrMode: 'hdr' })['ui-mode']).toBe('recomposition')
    expect(resolveSettingChoices(SETTING_CHOICES, picks, { ...rtx4090, hdrMode: 'scene-hdr' })['ui-mode']).toBe('recomposition')
    expect(resolveSettingChoices(SETTING_CHOICES, picks, { ...rtx4090, hdrMode: 'off' })['ui-mode']).toBe('ui-free')
    expect(resolveSettingChoices(SETTING_CHOICES, picks, { ...rtx4090, hdrMode: null })['ui-mode']).toBe('ui-free')
  })

  it('falls back to the default for a pick the content no longer offers', () => {
    expect(resolveSettingChoices(SETTING_CHOICES, { 'ui-mode': 'gone', 'dlssg-preset': 'z', 'removed-choice': 'x' }, rtx4090)).toEqual({ 'ui-mode': 'recomposition', 'dlssg-preset': 'auto' })
  })

  it('finds a free option when the default is blocked too', () => {
    const blockedDefault = [{ ...ui }, { ...preset, defaultOption: 'a' }]
    expect(resolveSettingChoices(blockedDefault, { 'dlssg-preset': 'c' }, rtx4090)).toEqual({ 'ui-mode': 'recomposition', 'dlssg-preset': 'auto' })
  })

  it('writes the unoffered option for a card the choice is not offered to, and nothing where there is none', () => {
    const rtx3080 = { ...rtx4090, gpuName: 'NVIDIA GeForce RTX 3080' }
    expect(resolveSettingChoices(SETTING_CHOICES, { 'ui-mode': 'recomposition', 'dlssg-preset': 'c' }, rtx3080)).toEqual({ 'ui-mode': 'off' })
    expect(resolveSettingChoices(SETTING_CHOICES, undefined, { ...rtx4090, gpuName: 'NVIDIA GeForce RTX 2080 Ti' })).toEqual({ 'ui-mode': 'off' })
    expect(resolveSettingChoices(SETTING_CHOICES, undefined, { ...rtx4090, gpuName: 'NVIDIA GeForce RTX 5090' })).toEqual({ 'ui-mode': 'recomposition', 'dlssg-preset': 'auto' })
  })

  it('still resolves the picks while frame generation is Off, so turning it on later finds them', () => {
    expect(resolveSettingChoices(SETTING_CHOICES, { 'ui-mode': 'off', 'dlssg-preset': 'b' }, { ...rtx4090, frameGenerationMode: 'off' })).toEqual({ 'ui-mode': 'off', 'dlssg-preset': 'b' })
    expect(resolveSettingChoices(SETTING_CHOICES, undefined, { ...rtx4090, frameGenerationMode: null })).toEqual({ 'ui-mode': 'recomposition', 'dlssg-preset': 'auto' })
  })

  it('resolves nothing for content without choices', () => {
    expect(resolveSettingChoices(undefined, { 'ui-mode': 'off' }, rtx4090)).toEqual({})
    expect(resolveSettingChoices([], undefined, rtx4090)).toEqual({})
  })
})

describe('what a choice shows', () => {
  it('shows both choices to an RTX 40 or 50 card while frame generation is on', () => {
    expect(shownSettingChoices(SETTING_CHOICES, undefined, rtx4090).map((c) => c.choice.id)).toEqual(['ui-mode', 'dlssg-preset'])
    expect(shownSettingChoices(SETTING_CHOICES, undefined, { ...rtx4090, gpuName: 'NVIDIA GeForce RTX 5080', frameGenerationMode: '4x' }).map((c) => c.choice.id)).toEqual(['ui-mode', 'dlssg-preset'])
  })

  it('hides them while frame generation is Off or unchosen, and from a card the content does not offer them to', () => {
    expect(shownSettingChoices(SETTING_CHOICES, undefined, { ...rtx4090, frameGenerationMode: 'off' })).toEqual([])
    expect(shownSettingChoices(SETTING_CHOICES, undefined, { ...rtx4090, frameGenerationMode: null })).toEqual([])
    expect(shownSettingChoices(SETTING_CHOICES, undefined, { ...rtx4090, gpuName: 'NVIDIA GeForce RTX 3080' })).toEqual([])
    expect(shownSettingChoices(undefined, undefined, rtx4090)).toEqual([])
  })

  it('selects the resolved option and gives the reason for each blocked one', () => {
    const [uiChoice, presetChoice] = shownSettingChoices(SETTING_CHOICES, undefined, rtx4090)
    expect(uiChoice.selected).toBe('recomposition')
    expect(uiChoice.options.map((o) => [o.option.id, o.blocked])).toEqual([['off', null], ['recomposition', null], ['ui-free', null]])
    expect(presetChoice.selected).toBe('auto')
    expect(presetChoice.options.map((o) => [o.option.id, o.blocked !== null])).toEqual([['auto', false], ['a', true], ['b', false], ['c', true]])
    expect(presetChoice.options.find((o) => o.option.id === 'c')!.blocked).toMatch(/turn UI recomposition off/)
  })

  it('blocks UI-free with the HDR reason while HDR is on', () => {
    const [uiChoice] = shownSettingChoices(SETTING_CHOICES, undefined, { ...rtx4090, hdrMode: 'hdr' })
    expect(uiChoice.options.find((o) => o.option.id === 'ui-free')!.blocked).toBe('UI-free isn’t supported with HDR yet.')
  })

  it('opens the presets again once the UI mode is Off', () => {
    const [, presetChoice] = shownSettingChoices(SETTING_CHOICES, { 'ui-mode': 'off', 'dlssg-preset': 'c' }, rtx4090)
    expect(presetChoice.selected).toBe('c')
    expect(presetChoice.options.every((o) => o.blocked === null)).toBe(true)
  })

  it('reports a block for one option against the choices above it', () => {
    const c = preset.options.find((o) => o.id === 'a')!
    expect(optionBlock(c, { 'ui-mode': 'recomposition' }, rtx4090)).toMatch(/Preset A and C/)
    expect(optionBlock(c, { 'ui-mode': 'off' }, rtx4090)).toBeNull()
    expect(optionBlock(c, {}, rtx4090)).toBeNull()
  })
})

describe('the ini settings the picks write', () => {
  it('lists each resolved option’s keys in the order of the choices', () => {
    const resolved = resolveSettingChoices(SETTING_CHOICES, { 'ui-mode': 'off', 'dlssg-preset': 'b' }, rtx4090)
    expect(settingChoiceSettings(SETTING_CHOICES, resolved)).toEqual([
      { file: 'OptiScaler.ini', section: 'HudLess', key: 'Mode', value: 'off' },
      { file: 'OptiScaler.ini', section: 'DLSSG', key: 'RenderPreset', value: '2' },
    ])
  })

  it('writes the default values for a new install', () => {
    expect(settingChoiceSettings(SETTING_CHOICES, resolveSettingChoices(SETTING_CHOICES, undefined, rtx4090)).map((s) => `${s.section}.${s.key}=${s.value}`))
      .toEqual(['HudLess.Mode=recomposition', 'DLSSG.RenderPreset=0'])
  })

  it('writes only the unoffered option’s keys for a card without DLSS frame generation', () => {
    const resolved = resolveSettingChoices(SETTING_CHOICES, undefined, { ...rtx4090, gpuName: 'NVIDIA GeForce RTX 3080' })
    expect(settingChoiceSettings(SETTING_CHOICES, resolved)).toEqual([{ file: 'OptiScaler.ini', section: 'HudLess', key: 'Mode', value: 'off' }])
  })

  it('writes nothing for content without choices', () => {
    expect(settingChoiceSettings(undefined, {})).toEqual([])
  })
})

describe('naming what was written', () => {
  it('names each shown choice and the option it was written with', () => {
    expect(settingChoiceSummary(SETTING_CHOICES, { 'ui-mode': 'off', 'dlssg-preset': 'c' }, rtx4090)).toEqual([
      { label: 'UI mode', value: 'Off' }, { label: 'DLSS-G preset', value: 'Preset C' },
    ])
  })

  it('names nothing for picks that were never written, such as a deployment that gained the choices by an update', () => {
    expect(settingChoiceSummary(SETTING_CHOICES, undefined, rtx4090)).toEqual([])
    expect(settingChoiceSummary(SETTING_CHOICES, {}, rtx4090)).toEqual([])
    expect(settingChoiceSummary(SETTING_CHOICES, { 'ui-mode': 'off' }, rtx4090)).toEqual([{ label: 'UI mode', value: 'Off' }])
  })

  it('names nothing while frame generation is Off, or for a card without the choices', () => {
    const picks = { 'ui-mode': 'off', 'dlssg-preset': 'c' }
    expect(settingChoiceSummary(SETTING_CHOICES, picks, { ...rtx4090, frameGenerationMode: 'off' })).toEqual([])
    expect(settingChoiceSummary(SETTING_CHOICES, { 'ui-mode': 'off' }, { ...rtx4090, gpuName: 'NVIDIA GeForce RTX 3080' })).toEqual([])
  })
})
