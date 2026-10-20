import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { applyReshadeStyle, reshadeStyle, type EmberPalette } from './ember-style'

const palette = JSON.parse(await readFile(new URL('../content/ember/palette.json', import.meta.url), 'utf8')) as EmberPalette

/** The `[STYLE]` keys of the ReShade.ini Lucent has shipped since 2026.10.13, with their old values: the file the style is written over. */
const SHIPPED_KEYS = [
  'Alpha', 'Border', 'BorderShadow', 'Button', 'ButtonActive', 'ButtonHovered', 'CheckMark', 'ChildBg', 'ChildRounding', 'ColFPSText',
  'DockingEmptyBg', 'DockingPreview', 'DragDropTarget', 'EditorFont', 'EditorFontSize', 'EditorStyleIndex', 'Font', 'FontSize', 'FPSScale',
  'FrameBg', 'FrameBgActive', 'FrameBgHovered', 'FrameRounding', 'GrabRounding', 'HdrOverlayBrightness', 'HdrOverlayOverwriteColorSpaceTo',
  'Header', 'HeaderActive', 'HeaderHovered', 'InputTextCursor', 'LatinFont', 'MenuBarBg', 'ModalWindowDimBg', 'NavCursor', 'NavWindowingDimBg',
  'NavWindowingHighlight', 'PlotHistogram', 'PlotHistogramHovered', 'PlotLines', 'PlotLinesHovered', 'PopupBg', 'PopupRounding', 'ResizeGrip',
  'ResizeGripActive', 'ResizeGripHovered', 'ScrollbarBg', 'ScrollbarGrab', 'ScrollbarGrabActive', 'ScrollbarGrabHovered', 'ScrollbarRounding',
  'Separator', 'SeparatorActive', 'SeparatorHovered', 'SliderGrab', 'SliderGrabActive', 'StyleIndex', 'Tab', 'TabDimmed', 'TabDimmedSelected',
  'TabDimmedSelectedOverline', 'TabHovered', 'TabRounding', 'TabSelected', 'TabSelectedOverline', 'TableBorderLight', 'TableBorderStrong',
  'TableHeaderBg', 'TableRowBg', 'TableRowBgAlt', 'Text', 'TextDisabled', 'TextLink', 'TextSelectedBg', 'TitleBg', 'TitleBgActive',
  'TitleBgCollapsed', 'TreeLines', 'WindowBg', 'WindowRounding',
]
const shipped = (extra = '') => [
  '[DEPTH]', 'DepthCopyBeforeClears=2', '',
  '[STYLE]', ...SHIPPED_KEYS.map((key) => `${key}=${key === 'Font' ? 'C:\\Windows\\Fonts\\segoeui.ttf' : key.endsWith('Size') ? '13.000000' : '0.100000,0.200000,0.300000,1.000000'}`), extra,
  '[TABS]', 'Border=keep this one', '',
].join('\r\n')

const parse = (text: string) => {
  const out = new Map<string, string>()
  let section = ''
  for (const line of text.split(/\r?\n/)) {
    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header) { section = header[1]; continue }
    const at = line.indexOf('=')
    if (at > 0) out.set(`${section}|${line.slice(0, at)}`, line.slice(at + 1))
  }
  return out
}

describe('the Ember palette in ReShade', () => {
  it('carries every colour the fork builds, to six decimals, under the key ReShade reads', () => {
    const style = reshadeStyle(palette)
    for (const [slot, value] of Object.entries(palette.colors)) {
      expect(style[slot[0].toUpperCase() + slot.slice(1)]).toBe(value.map((v) => v.toFixed(6)).join(','))
    }
    expect(Object.keys(palette.colors)).toHaveLength(60)
  })

  it('is the Ember look: the accent only on state, charcoal surfaces, the orange FPS counter', () => {
    const style = reshadeStyle(palette)
    expect(style.WindowBg).toBe('0.078431,0.082353,0.098039,0.920000')
    expect(style.ChildBg.startsWith('0.101961,0.105882,0.125490,')).toBe(true)
    expect(style.Button).toBe(style.FrameBg)
    expect(style.CheckMark).toBe('1.000000,0.392157,0.039216,1.000000')
    expect(style.SliderGrab).toBe('1.000000,0.392157,0.039216,1.000000')
    expect(style.ColFPSText).toBe('1.000000,0.392157,0.039216,1.000000')
    // the controls carry no orange: button, header and title bar are neutral
    for (const key of ['Button', 'ButtonHovered', 'ButtonActive', 'Header', 'HeaderHovered', 'TitleBg', 'TitleBgActive', 'FrameBg']) {
      const [r, g, b] = style[key].split(',').map(Number)
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.08)
    }
  })

  it('takes the rounding from the palette: 10 window, 8 child and popup, 6 controls', () => {
    const style = reshadeStyle(palette)
    expect(style).toMatchObject({
      WindowRounding: '10.000000', ChildRounding: '8.000000', PopupRounding: '8.000000', FrameRounding: '6.000000', GrabRounding: '6.000000',
      TabRounding: '6.000000', ScrollbarRounding: '8.000000',
    })
  })

  it('writes over the [STYLE] of the shipped file and leaves everything else alone', () => {
    const before = shipped()
    const { text, unmapped } = applyReshadeStyle(before, palette)
    const after = parse(text)
    const old = parse(before)
    // every palette slot has a key in the shipped file, so none is silently dropped
    expect(unmapped).toEqual([])
    // the keys the palette does not own keep their value
    for (const key of ['Alpha', 'EditorFont', 'EditorFontSize', 'Font', 'FontSize', 'FPSScale', 'HdrOverlayBrightness', 'LatinFont', 'StyleIndex', 'EditorStyleIndex']) {
      expect(after.get(`STYLE|${key}`)).toBe(old.get(`STYLE|${key}`))
    }
    // another section is untouched, even a key that shares a name with a style key
    expect(after.get('TABS|Border')).toBe('keep this one')
    expect(after.get('DEPTH|DepthCopyBeforeClears')).toBe('2')
    expect(text).toContain('\r\n')
    expect(text).not.toMatch(/[^\r]\n/)
    // the palette is in: no shipped colour survives where the palette sets one
    expect(after.get('STYLE|WindowBg')).toBe('0.078431,0.082353,0.098039,0.920000')
    expect(after.get('STYLE|ButtonHovered')).toBe(reshadeStyle(palette).ButtonHovered)
  })

  it('reports a slot the file has no key for, and is idempotent', () => {
    const narrow = '[STYLE]\r\nWindowBg=0.1,0.1,0.1,1.0\r\n'
    const first = applyReshadeStyle(narrow, palette)
    expect(first.unmapped).toContain('Button')
    expect(first.changed).toEqual(['WindowBg'])
    const again = applyReshadeStyle(first.text, palette)
    expect(again.text).toBe(first.text)
    expect(again.changed).toEqual([])
  })

  it('refuses a palette without a metric ReShade needs', () => {
    const broken: EmberPalette = { ...palette, metrics: { ...palette.metrics, windowRounding: [1, 2] } }
    expect(() => reshadeStyle(broken)).toThrow('windowRounding')
  })
})
