import { describe, expect, it } from 'vitest'
import { SETTING_CHOICE_MANIFEST } from '../platform/contentFixture'
import { frameGenerationOptionsForGpu } from './frameGeneration'
import { planDeployment, type PlanSelection } from './planner'

const content = SETTING_CHOICE_MANIFEST.versions[0]
const tierId = 'rtx-20-30-40'
const tier = SETTING_CHOICE_MANIFEST.tiers.find((t) => t.id === tierId)!
const scan = { files: [], ownedFiles: [], cachedFiles: [] }
const plan = (gpuName: string, selection: PlanSelection = {}) => planDeployment(content, tier, true, scan, null, true, {
  gpuName, frameGenerationOptions: frameGenerationOptionsForGpu(content.tiers[tierId].frameGenerationOptions!, gpuName), frameGenerationMode: '2x', hdrMode: 'off', ...selection,
})
const iniValues = (p: ReturnType<typeof planDeployment>) => p.steps.flatMap((s) => s.kind === 'ini_set' ? [`${s.section}.${s.key}=${s.value}`] : [])
const RTX_4090 = 'NVIDIA GeForce RTX 4090'

describe('planning the setting choices', () => {
  it('writes the defaults for a card the choices are offered to, and records the picks', () => {
    const p = plan(RTX_4090)
    expect(p.settingChoices).toEqual({ 'ui-mode': 'recomposition', 'dlssg-preset': 'auto' })
    expect(iniValues(p)).toEqual(expect.arrayContaining(['HudLess.Mode=recomposition', 'DLSSG.RenderPreset=0']))
  })

  it('writes the player’s picks after the frame generation values', () => {
    const p = plan(RTX_4090, { settingChoices: { 'ui-mode': 'off', 'dlssg-preset': 'c' } })
    expect(p.settingChoices).toEqual({ 'ui-mode': 'off', 'dlssg-preset': 'c' })
    const values = iniValues(p)
    expect(values).toEqual(expect.arrayContaining(['HudLess.Mode=off', 'DLSSG.RenderPreset=3']))
    expect(values.indexOf('HudLess.Mode=off')).toBeGreaterThan(values.indexOf('FrameGeneration.Mode=2x'))
    expect(values.indexOf('DLSSG.RenderPreset=3')).toBeGreaterThan(values.indexOf('HudLess.Mode=off'))
  })

  it('writes a preset that recomposition turns off as Auto, and UI-free with HDR as Recomposition', () => {
    const blocked = plan(RTX_4090, { settingChoices: { 'ui-mode': 'recomposition', 'dlssg-preset': 'a' } })
    expect(blocked.settingChoices).toEqual({ 'ui-mode': 'recomposition', 'dlssg-preset': 'auto' })
    expect(iniValues(blocked)).toContain('DLSSG.RenderPreset=0')
    const hdr = plan(RTX_4090, { hdrMode: 'hdr', settingChoices: { 'ui-mode': 'ui-free' } })
    expect(hdr.settingChoices?.['ui-mode']).toBe('recomposition')
    expect(iniValues(hdr)).toContain('HudLess.Mode=recomposition')
  })

  it('still writes the picks with frame generation Off', () => {
    const p = plan(RTX_4090, { frameGenerationMode: 'off', settingChoices: { 'ui-mode': 'off', 'dlssg-preset': 'b' } })
    expect(p.settingChoices).toEqual({ 'ui-mode': 'off', 'dlssg-preset': 'b' })
    expect(iniValues(p)).toEqual(expect.arrayContaining(['HudLess.Mode=off', 'DLSSG.RenderPreset=2']))
  })

  it('writes UI mode Off and no preset for an RTX 30 card, whatever was picked', () => {
    const p = plan('NVIDIA GeForce RTX 3080', { settingChoices: { 'ui-mode': 'recomposition', 'dlssg-preset': 'c' } })
    expect(p.settingChoices).toEqual({ 'ui-mode': 'off' })
    const values = iniValues(p)
    expect(values).toContain('HudLess.Mode=off')
    expect(values.some((v) => v.startsWith('DLSSG.RenderPreset='))).toBe(false)
  })

  it('records nothing and writes nothing for content without choices', () => {
    const plain = SETTING_CHOICE_MANIFEST.versions[0]
    const without = { ...plain, tiers: { ...plain.tiers, [tierId]: { ...plain.tiers[tierId], settingChoices: undefined } } }
    const p = planDeployment(without, tier, true, scan, null, true, { gpuName: RTX_4090, frameGenerationMode: '2x', hdrMode: 'off', settingChoices: { 'ui-mode': 'off' } })
    expect(p.settingChoices).toEqual({})
    expect(iniValues(p).some((v) => v.startsWith('HudLess.') || v.startsWith('DLSSG.RenderPreset'))).toBe(false)
  })

  it('keeps the tier’s choices in the recipe the record stores, so Reset can offer them again', () => {
    const p = plan(RTX_4090)
    expect(p.recipe.settingChoices?.map((c) => c.id)).toEqual(['ui-mode', 'dlssg-preset'])
  })
})
