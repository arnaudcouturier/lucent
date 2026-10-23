import { describe, expect, it } from 'vitest'
import { DRIFT_FILES_SHOWN, MISSING_NOTE, driftFileList } from './driftFiles'

const shaders = (count: number) => Array.from({ length: count }, (_, i) => `reshade-shaders/Shaders/Effect${i + 1}.fx`)

describe('driftFileList', () => {
  it('lists the missing files before the changed ones, each in the order the health check found them', () => {
    const { groups } = driftFileList(['ReShade64.dll', 'reshade-presets/Example.ini'], ['winmm.dll', 'ReShade.ini'])
    expect(groups).toEqual([
      { label: 'Missing', files: ['ReShade64.dll', 'reshade-presets/Example.ini'], more: null },
      { label: 'Changed', files: ['winmm.dll', 'ReShade.ini'], more: null },
    ])
  })

  it('leaves out a group with nothing in it', () => {
    expect(driftFileList([], ['winmm.dll']).groups).toEqual([{ label: 'Changed', files: ['winmm.dll'], more: null }])
    expect(driftFileList(['winmm.dll'], []).groups).toEqual([{ label: 'Missing', files: ['winmm.dll'], more: null }])
  })

  it('shows every file of a group up to 12, then the first 12 and how many more', () => {
    expect(DRIFT_FILES_SHOWN).toBe(12)
    expect(driftFileList(shaders(12), []).groups[0]).toEqual({ label: 'Missing', files: shaders(12), more: null })
    expect(driftFileList(shaders(13), []).groups[0]).toEqual({ label: 'Missing', files: shaders(12), more: 'and 1 more' })
  })

  it('caps each group on its own', () => {
    const { groups } = driftFileList(['winmm.dll'], shaders(40))
    expect(groups[0]).toEqual({ label: 'Missing', files: ['winmm.dll'], more: null })
    expect(groups[1].files).toEqual(shaders(12))
    expect(groups[1].more).toBe('and 28 more')
  })

  it('counts the rest with a thousands separator, as a patch can replace a whole deployment', () => {
    expect(driftFileList([], shaders(1212)).groups[0].more).toBe('and 1,200 more')
  })

  it('adds the Windows Security line only when a file is missing', () => {
    expect(driftFileList(['nvngx_dlssnr.dll'], ['winmm.dll']).note).toBe(MISSING_NOTE)
    expect(driftFileList(['nvngx_dlssnr.dll'], []).note).toBe(MISSING_NOTE)
    expect(driftFileList([], ['winmm.dll']).note).toBeNull()
  })

  it('names the likely cause and the way back, never an exclusion or turning protection off', () => {
    expect(MISSING_NOTE).toBe('A missing file can mean Windows Security moved it away. Repair puts it back.')
    expect(MISSING_NOTE).not.toMatch(/exclu|exception|allow|whitelist|trust|disabl|turn(ing)?\s+(it\s+)?off|switch(ing)?\s+off|pause|real-time|tamper|settings/i)
  })
})
