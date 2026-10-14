import { describe, expect, it } from 'vitest'
import type { HdrOption } from '../shared/manifest'
import { disableAutoHdr, latestAutoHdrDisableIndex, matchHdrMode, restoreAutoHdr } from './hdr'

const options: HdrOption[] = [
  { id: 'off', settings: [{ file: 'OptiScaler.ini', section: 'HDR', key: 'FfxivHDR', value: 'false' }] },
  { id: 'hdr', settings: [
    { file: 'OptiScaler.ini', section: 'HDR', key: 'FfxivHDR', value: 'true' },
    { file: 'OptiScaler.ini', section: 'HDR', key: 'Mode', value: '0' },
  ] },
  { id: 'scene-hdr', experimental: true, settings: [
    { file: 'OptiScaler.ini', section: 'HDR', key: 'FfxivHDR', value: 'true' },
    { file: 'OptiScaler.ini', section: 'HDR', key: 'Mode', value: '1' },
  ] },
]

describe('HDR mode matching', () => {
  it.each([
    ['Off', '[HDR]\nFfxivHDR = false\nMode = 1', 'off'],
    ['HDR', '[HDR]\nFfxivHDR = true\nMode = 0', 'hdr'],
    ['Scene HDR', '[HDR]\nFfxivHDR = true\nMode = 1', 'scene-hdr'],
    ['a custom combination', '[HDR]\nFfxivHDR = true\nMode = 2', null],
    ['a missing key', '[HDR]\nFfxivHDR = true', null],
  ] as const)('reads %s from the on-disk keys', (_, text, expected) => {
    expect(matchHdrMode(options, text)).toBe(expected)
  })
})

describe('HDR mode matching', () => {
  it('matches declared HDR keys across more than one owned config', () => {
    const multiFileOptions: HdrOption[] = [
      { id: 'off', settings: [{ file: 'OptiScaler.ini', section: 'HDR', key: 'FfxivHDR', value: 'false' }] },
      { id: 'hdr', settings: [
        { file: 'OptiScaler.ini', section: 'HDR', key: 'FfxivHDR', value: 'true' },
        { file: 'Renderer.ini', section: 'HDR', key: 'Mode', value: '0' },
      ] },
      { id: 'scene-hdr', settings: [
        { file: 'OptiScaler.ini', section: 'HDR', key: 'FfxivHDR', value: 'true' },
        { file: 'Renderer.ini', section: 'HDR', key: 'Mode', value: '1' },
      ] },
    ]
    const values = new Map([
      ['optiscaler.ini|hdr|ffxivhdr', 'true'],
      ['renderer.ini|hdr|mode', '1'],
    ])
    expect(matchHdrMode(multiFileOptions, (file, section, key) => values.get(`${file.toLowerCase()}|${section.toLowerCase()}|${key.toLowerCase()}`))).toBe('scene-hdr')
    values.set('renderer.ini|hdr|mode', '2')
    expect(matchHdrMode(multiFileOptions, (file, section, key) => values.get(`${file.toLowerCase()}|${section.toLowerCase()}|${key.toLowerCase()}`))).toBeNull()
  })
})

describe('Auto HDR entry ownership', () => {
  it('adds only the disabled AutoHDR token and preserves existing token spelling, order and terminator', () => {
    expect(disableAutoHdr('SwapEffectUpgradeEnable=257;GpuPreference=2;'))
      .toBe('SwapEffectUpgradeEnable=257;GpuPreference=2;AutoHDREnable=2096;')
    expect(disableAutoHdr('GpuPreference=2;AutoHDREnable=2097;'))
      .toBe('GpuPreference=2;AutoHDREnable=2096;')
  })

  it('leaves unrelated strings byte-for-byte intact when replacing the owned token', () => {
    expect(disableAutoHdr('  GpuPreference = 2;  AutoHDREnable = 2097 ;SwapEffectUpgradeEnable=257'))
      .toBe('  GpuPreference = 2;  AutoHDREnable = 2096 ;SwapEffectUpgradeEnable=257')
  })

  it.each([
    ['2099', '2098'],
    ['4294967295', '4294967294'],
  ])('clears only the enabled bit of DWORD %s', (beforeToken, afterToken) => {
    const before = `AutoHDREnable=${beforeToken};GpuPreference=2;`
    const after = disableAutoHdr(before)
    expect(after).toBe(`AutoHDREnable=${afterToken};GpuPreference=2;`)
    expect(restoreAutoHdr(after, before, after)).toBe(before)
  })

  it('does not claim an already-disabled AutoHDR token', () => {
    expect(disableAutoHdr('GpuPreference=2;AutoHDREnable=2096;')).toBe('GpuPreference=2;AutoHDREnable=2096;')
    expect(latestAutoHdrDisableIndex([{ before: 'GpuPreference=2;AutoHDREnable=2096;', after: 'GpuPreference=2;AutoHDREnable=2096;' }])).toBeNull()
  })

  it('does not reuse a historical disable after an Off restore and later player edit', () => {
    const before = 'GpuPreference=2;AutoHDREnable=2097;'
    const disabled = disableAutoHdr(before)
    const restored = restoreAutoHdr(disabled, before, disabled)!
    const transitions = [
      { before, after: disabled },
      { before: disabled, after: restored },
    ]
    expect(latestAutoHdrDisableIndex(transitions)).toBeNull()
    const playerDisabled = disableAutoHdr(restored)
    expect(playerDisabled).toBe('GpuPreference=2;AutoHDREnable=2096;')
    expect(latestAutoHdrDisableIndex([])).toBeNull()
    expect(playerDisabled).toBe('GpuPreference=2;AutoHDREnable=2096;')
  })

  it('restores the exact previous string when nobody changed the value', () => {
    const before = 'SwapEffectUpgradeEnable=257;GpuPreference=2;AutoHDREnable=2097;'
    const after = disableAutoHdr(before)
    expect(restoreAutoHdr(after, before, after)).toBe(before)
  })

  it('restores only AutoHDR when another app changes a different token during HDR', () => {
    const before = 'GpuPreference=2;'
    const after = disableAutoHdr(before)
    expect(restoreAutoHdr('GpuPreference=1;AutoHDREnable=2096;NewFlag=7;', before, after))
      .toBe('GpuPreference=1;NewFlag=7;')
  })

  it('restores the old AutoHDR token and formatting while preserving current surrounding tokens', () => {
    const before = 'GpuPreference=2; AutoHDREnable = 2097 ;'
    const after = disableAutoHdr(before)
    expect(restoreAutoHdr('NewFlag=5; AutoHDREnable = 2096 ;GpuPreference=1;', before, after))
      .toBe('NewFlag=5; AutoHDREnable = 2097 ;GpuPreference=1;')
  })

  it('does not overwrite an AutoHDR value the player has changed themselves', () => {
    const before = 'GpuPreference=2;'
    const after = disableAutoHdr(before)
    expect(restoreAutoHdr('GpuPreference=2;AutoHDREnable=2097;', before, after))
      .toBe('GpuPreference=2;AutoHDREnable=2097;')
  })

  it('removes only its token when the value was originally absent', () => {
    const after = disableAutoHdr(null)
    expect(restoreAutoHdr('GpuPreference=2;AutoHDREnable=2096;', null, after)).toBe('GpuPreference=2;')
    expect(restoreAutoHdr(after, null, after)).toBeNull()
  })

  it('recovers a crashed Off transition while preserving external edits to other tokens', () => {
    const before = 'GpuPreference=2;AutoHDREnable=2096;'
    const after = 'GpuPreference=2;'
    expect(restoreAutoHdr('GpuPreference=1;NewFlag=5;', before, after))
      .toBe('GpuPreference=1;NewFlag=5;AutoHDREnable=2096;')
  })

  it('rejects ambiguous duplicate AutoHDR tokens instead of silently changing behavior', () => {
    expect(() => disableAutoHdr('AutoHDREnable=2097;AutoHDREnable=2096;')).toThrow(/duplicate AutoHDR/i)
  })
})
