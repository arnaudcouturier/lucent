import { describe, expect, it } from 'vitest'
import type { FrameGenerationOption } from '../shared/manifest'
import {
  defaultFrameGenerationMode,
  frameGenerationDescription,
  frameGenerationOptionsForGpu,
  matchFrameGenerationMode,
  frameGenerationSettingKeys,
} from './frameGeneration'

const options: FrameGenerationOption[] = [
  { id: 'dynamic', settings: [{ file: 'OptiScaler.ini', section: 'FrameGen', key: 'Dynamic', value: 'true' }] },
  { id: '4x', settings: [{ file: 'OptiScaler.ini', section: 'FrameGen', key: 'InterpolationCount', value: '3' }] },
  { id: '2x', gpuNamePatterns: ['RTX 30'], settings: [{ file: 'OptiScaler.ini', section: 'FrameGen', key: 'InterpolationCount', value: '1' }] },
  { id: '2x', gpuNamePatterns: ['RTX 40'], experimental: true, settings: [{ file: 'OptiScaler.ini', section: 'FrameGen', key: 'InterpolationCount', value: '1' }, { file: 'OptiScaler.ini', section: 'FrameGen', key: 'AdaMfgUnlock', value: 'true' }] },
  { id: 'off', settings: [{ file: 'OptiScaler.ini', section: 'FrameGen', key: 'Enabled', value: 'false' }] },
  { id: '3x', gpuNamePatterns: ['RTX 40'], settings: [{ file: 'OptiScaler.ini', section: 'FrameGen', key: 'InterpolationCount', value: '2' }] },
]

describe('frame generation choices', () => {
  it('filters by GPU name and renders each id once in the control order', () => {
    expect(frameGenerationOptionsForGpu(options, 'NVIDIA GeForce RTX 3080').map((option) => option.id))
      .toEqual(['off', '2x', '4x', 'dynamic'])
    expect(frameGenerationOptionsForGpu(options, 'NVIDIA GeForce RTX 4090').map((option) => option.id))
      .toEqual(['off', '2x', '3x', '4x', 'dynamic'])
    expect(frameGenerationOptionsForGpu(options, 'NVIDIA GeForce RTX 4090').find((option) => option.id === '2x'))
      .toMatchObject({ experimental: true, settings: [{ key: 'InterpolationCount', value: '1' }, { key: 'AdaMfgUnlock', value: 'true' }] })
  })

  it('chooses 2x at 120 Hz or above, Off below, and the first offered choice as fallback', () => {
    const offered = frameGenerationOptionsForGpu(options, 'NVIDIA GeForce RTX 4090')
    expect(defaultFrameGenerationMode(offered, 60)).toBe('off')
    expect(defaultFrameGenerationMode(offered, 120)).toBe('2x')
    expect(defaultFrameGenerationMode(offered.filter((option) => option.id !== '2x'), 240)).toBe('off')
    expect(defaultFrameGenerationMode(offered.filter((option) => option.id !== 'off'), 60)).toBe('2x')
  })

  it('selects the unique option whose full settings match disk and leaves unmatched or ambiguous values Custom', () => {
    const offered = frameGenerationOptionsForGpu(options, 'NVIDIA GeForce RTX 4090')
    expect(matchFrameGenerationMode(offered, [
      { file: 'OptiScaler.ini', section: 'framegen', key: 'InterpolationCount', value: '1' },
      { file: 'optiscaler.ini', section: 'FRAMEGEN', key: 'adamfgunlock', value: 'TRUE' },
    ])).toBe('2x')
    expect(matchFrameGenerationMode(offered, [
      { file: 'OptiScaler.ini', section: 'FrameGen', key: 'InterpolationCount', value: '2' },
      { file: 'OptiScaler.ini', section: 'FrameGen', key: 'Enabled', value: 'false' },
    ])).toBeNull()
    expect(matchFrameGenerationMode([
      { id: '2x', settings: [{ file: 'OptiScaler.ini', section: 'FrameGen', key: 'Enabled', value: 'true' }] },
      { id: '3x', settings: [{ file: 'OptiScaler.ini', section: 'FrameGen', key: 'Enabled', value: 'true' }] },
    ], [{ file: 'OptiScaler.ini', section: 'FrameGen', key: 'Enabled', value: 'true' }])).toBeNull()
  })

  it('recognizes either declared HDR variant after the display HDR state changes', () => {
    const hdrOption: FrameGenerationOption = {
      id: '2x', settings: [
        { file: 'OptiScaler.ini', section: 'FrameGen', key: 'Mode', value: '2x' },
        { file: 'OptiScaler.ini', section: 'FrameGen', key: 'HdrBoost', value: '0' },
      ], hdrSettings: [{ file: 'OptiScaler.ini', section: 'FrameGen', key: 'HdrBoost', value: '1' }],
    }
    expect(matchFrameGenerationMode([hdrOption], [
      { file: 'OptiScaler.ini', section: 'FrameGen', key: 'Mode', value: '2x' },
      { file: 'OptiScaler.ini', section: 'FrameGen', key: 'HdrBoost', value: '1' },
    ])).toBe('2x')
    expect(frameGenerationSettingKeys([hdrOption])).toEqual(new Set([
      'optiscaler.ini|framegen|mode', 'optiscaler.ini|framegen|hdrboost',
    ]))
  })

  it('describes the effective render rate using the current frame cap and refresh rate', () => {
    expect(frameGenerationDescription('off', 138, 144)).toBe('Capped at 138 fps for your 144 Hz screen')
    expect(frameGenerationDescription('2x', 138, 144)).toBe('XIV renders up to 69 fps, shown at 138 on your 144 Hz screen')
    expect(frameGenerationDescription('dynamic', 230, 240)).toBe('Aims for 230 fps on your 240 Hz screen')
  })
})
