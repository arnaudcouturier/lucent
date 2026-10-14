import { describe, expect, it } from 'vitest'
import { choiceOptions, frameGenerationChoice, hdrChoice, hdrDescription, storedHdrChoice, storedSelection } from './choices'
import { HDR_FRAME_GENERATION_MANIFEST } from '../platform/contentFixture'

const recipe = HDR_FRAME_GENERATION_MANIFEST.versions[0].tiers['rtx-30-40']
const ids = (options: { id: string }[]) => options.map((option) => option.id)

describe('choiceOptions', () => {
  it('filters one tier’s frame generation options by GPU model', () => {
    expect(ids(choiceOptions(recipe, 'NVIDIA GeForce RTX 4090', true).frameGenerationOptions)).toEqual(['off', '2x', '3x', '4x', '5x', '6x', 'dynamic'])
    expect(ids(choiceOptions(recipe, 'NVIDIA GeForce RTX 3080', true).frameGenerationOptions)).toEqual(['off', '2x'])
  })

  it('offers HDR only on an HDR monitor', () => {
    expect(ids(choiceOptions(recipe, 'NVIDIA GeForce RTX 4090', true).hdrOptions)).toEqual(['off', 'hdr', 'scene-hdr'])
    expect(choiceOptions(recipe, 'NVIDIA GeForce RTX 4090', false).hdrOptions).toEqual([])
  })
})

describe('frameGenerationChoice', () => {
  const options = choiceOptions(recipe, 'NVIDIA GeForce RTX 4090', true).frameGenerationOptions
  it('defaults to 2× from 120 Hz and Off below', () => {
    expect(frameGenerationChoice(options, null, 120)).toBe('2x')
    expect(frameGenerationChoice(options, null, 119)).toBe('off')
  })
  it('keeps a pick the card still offers, and falls back to the default otherwise', () => {
    expect(frameGenerationChoice(options, '4x', 60)).toBe('4x')
    const rtx30 = choiceOptions(recipe, 'NVIDIA GeForce RTX 3080', true).frameGenerationOptions
    expect(frameGenerationChoice(rtx30, '4x', 240)).toBe('2x')
  })
  it('is null when the tier offers no frame generation', () => {
    expect(frameGenerationChoice([], '2x', 240)).toBeNull()
  })
})

describe('hdrChoice', () => {
  const offered = choiceOptions(recipe, 'NVIDIA GeForce RTX 4090', true).hdrOptions
  it('defaults to HDR, keeps a pick that is still offered', () => {
    expect(hdrChoice(recipe, offered, null)).toBe('hdr')
    expect(hdrChoice(recipe, offered, 'scene-hdr')).toBe('scene-hdr')
  })
  it('is Off when the monitor offers nothing, and null for content without HDR', () => {
    expect(hdrChoice(recipe, [], 'hdr')).toBe('off')
    expect(hdrChoice({ ...recipe, hdrOptions: undefined }, [], null)).toBeNull()
  })
})

describe('hdrDescription', () => {
  const facts = { windowsHdrOn: true, nvidia: true, peakNits: 1000 }
  it('says Auto HDR goes off for XIV, the peak brightness, and that RTX HDR stays the player’s', () => {
    const [summary, ...notes] = hdrDescription('hdr', facts)
    expect(summary).toBe('Expands XIV’s SDR image to HDR.')
    expect(notes).toEqual([
      'Lucent turns Windows Auto HDR off for XIV.',
      'Peak brightness is 1,000 nits, from your monitor; the Windows HDR Calibration app fixes a wrong value.',
      'Turn RTX HDR off for XIV in the NVIDIA app; Lucent can’t.',
    ])
  })
  it('explains how to turn Windows HDR on when it is off, and skips RTX HDR off NVIDIA', () => {
    const notes = hdrDescription('scene-hdr', { windowsHdrOn: false, nvidia: false, peakNits: null }).slice(1)
    expect(notes[0]).toBe('Windows HDR is off, so XIV stays SDR until you turn it on (Win+Alt+B).')
    expect(notes.join(' ')).not.toMatch(/RTX HDR/)
    expect(notes.join(' ')).toMatch(/1,100 nits/)
  })
  it('has nothing to add for Off', () => {
    expect(hdrDescription('off', facts)).toEqual(['XIV stays SDR.'])
  })
})

describe('stored first-install choices', () => {
  it('keeps the stored HDR mode where the content offers it, and writes Off otherwise', () => {
    expect(storedHdrChoice(recipe, 'scene-hdr')).toBe('scene-hdr')
    expect(storedHdrChoice(recipe, null)).toBe('off')
    expect(storedHdrChoice({ ...recipe, hdrOptions: undefined }, 'hdr')).toBeNull()
  })

  it('plans from the stored frame generation and HDR modes, with the screen as it is now', () => {
    const screen = { deviceName: 'DISPLAY1', refreshHz: 240, width: 3840, height: 2160, hdrSupported: true, hdrOn: true, peakNits: 1000, frameCap: 224 }
    expect(storedSelection({ frameGenerationMode: '4x', hdrMode: 'hdr' }, recipe, 'NVIDIA GeForce RTX 4090', screen))
      .toMatchObject({ frameGenerationMode: '4x', hdrMode: 'hdr', hdrOn: true, outputHeight: 2160, screen })
    // A card that no longer offers the stored multiplier gets the default for its refresh rate.
    expect(storedSelection({ frameGenerationMode: '4x', hdrMode: null }, recipe, 'NVIDIA GeForce RTX 3080', screen))
      .toMatchObject({ frameGenerationMode: '2x', hdrMode: 'off' })
  })

  it('keeps a stored Off selection Off when newer content starts offering frame generation', () => {
    const screen = { deviceName: 'DISPLAY1', refreshHz: 240, width: 3840, height: 2160, hdrSupported: true, hdrOn: true, peakNits: 1000, frameCap: 224 }
    expect(storedSelection({ frameGenerationMode: null, hdrMode: null }, recipe, 'NVIDIA GeForce RTX 4090', screen))
      .toMatchObject({ frameGenerationMode: 'off', hdrMode: 'off' })
  })
})
