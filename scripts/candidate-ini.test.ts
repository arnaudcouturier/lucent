import { describe, expect, it } from 'vitest'
import { mergeIni } from './candidate-ini'

const fork = [
  '[Upscalers]', '; comment = kept', 'Dx11Upscaler=auto', 'Dx12Upscaler=auto',
  '[DlssNr]', 'Enabled=auto', 'Passes=auto', 'SkinProtection=false', 'SkinDetail=1.0', 'Precision=0',
  '[Menu]', 'AccentColorR=auto', 'FontSize=auto', '',
].join('\r\n')
const previous = [
  '[Upscalers]', 'Dx11Upscaler = dlss_12', 'Dx12Upscaler = auto',
  '[DlssNr]', 'Enabled = true', 'Passes = 2', 'SkinProtection = true', 'SkinDetail = 0.750000', 'Precision = auto', 'Gone = 5', 'EmptyOne = ',
  '[Menu]', 'AccentColorR = auto', '',
].join('\r\n')

describe('mergeIni', () => {
  it('carries the previous tuned values over the fork defaults, keeping the fork layout and line endings', () => {
    const { text, carried } = mergeIni(fork, previous, [])
    expect(text).toContain('Dx11Upscaler=dlss_12\r\n')
    expect(text).toContain('Enabled=true\r\n')
    expect(text).toContain('; comment = kept\r\n')
    expect(text.split('\r\n')).toHaveLength(fork.split('\r\n').length)
    expect(text).not.toMatch(/[^\r]\n/)
    expect(carried.map((c) => `${c.section}|${c.key}`)).toEqual([
      'Upscalers|Dx11Upscaler', 'DlssNr|Enabled', 'DlssNr|Passes', 'DlssNr|SkinProtection', 'DlssNr|SkinDetail', 'DlssNr|Precision',
    ])
  })

  it('lets the saved value win over a different explicit fork value, auto included', () => {
    const { text } = mergeIni(fork, previous, [])
    expect(text).toContain('SkinProtection=true')
    expect(text).toContain('SkinDetail=0.750000')
    expect(text).toContain('Precision=auto')
  })

  it('reports the previous non-default values the fork no longer has', () => {
    expect(mergeIni(fork, previous, []).lost).toEqual([{ section: 'DlssNr', key: 'Gone', value: '5' }])
  })

  it('leaves the keys the install decides at the fork default, and says what it left', () => {
    const { text, carried, skipped } = mergeIni(fork, previous, [], [{ section: 'dlssnr', key: 'PASSES' }, { section: 'Upscalers', key: 'Dx11Upscaler' }])
    expect(text).toContain('Passes=auto')
    expect(text).toContain('Dx11Upscaler=auto')
    expect(text).toContain('Enabled=true')
    expect(carried.map((c) => c.key)).not.toContain('Passes')
    expect(skipped).toEqual([{ section: 'Upscalers', key: 'Dx11Upscaler', value: 'dlss_12' }, { section: 'DlssNr', key: 'Passes', value: '2' }])
  })

  it('applies overrides last and refuses a key the fork does not have', () => {
    const { text, overridden } = mergeIni(fork, previous, [{ section: 'menu', key: 'accentcolorr', value: '1.000000' }, { section: 'Menu', key: 'FontSize', value: '13.0' }])
    expect(text).toContain('AccentColorR=1.000000')
    expect(text).toContain('FontSize=13.0')
    expect(overridden).toHaveLength(2)
    expect(() => mergeIni(fork, previous, [{ section: 'Menu', key: 'Nope', value: '1' }])).toThrow("no [Menu] Nope")
  })
})
