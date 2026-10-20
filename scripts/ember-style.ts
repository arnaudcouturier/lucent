// Gives ReShade's menu the exact palette of OptiScaler-FFXIV's Ember menu style, so the two overlays that share the screen look
// like one. `content/ember/palette.json` is not written by hand: it is what the fork's own palette (ext/menu/EmberPalette.h) builds
// for Lucent's accent and window opacity, dumped by the fork's `ember_palette` test (set EMBER_PALETTE_JSON to a path and run
// `tools\test.ps1 -Filter ember_palette`). This module only renames the fork's slots to ReShade's `[STYLE]` keys and formats the
// numbers the way ReShade writes them.
//
// ReShade reads colours (`r,g,b,a`, six decimals) and these metrics from `[STYLE]`; it has no keys for padding or spacing, so the
// roomier Ember layout stays OptiScaler's. Everything else in `[STYLE]` (fonts, sizes, HDR overlay brightness) is left as it is.

export interface EmberPalette {
  inputs: { accent: [number, number, number]; windowAlpha: number }
  colors: Record<string, number[]>
  metrics: Record<string, number | number[]>
}

/** The Ember metrics ReShade has a `[STYLE]` key for. The rest (padding, spacing, borders, grab size) cannot be set in ReShade. */
const METRIC_KEYS = ['windowRounding', 'childRounding', 'frameRounding', 'popupRounding', 'scrollbarRounding', 'grabRounding', 'tabRounding']

const pascal = (name: string) => name[0].toUpperCase() + name.slice(1)
const colour = (c: number[]) => c.map((v) => v.toFixed(6)).join(',')

/** The `[STYLE]` keys and values the palette sets: every Ember colour, the metrics above, and the FPS counter in the accent. */
export function reshadeStyle(palette: EmberPalette): Record<string, string> {
  const style: Record<string, string> = {}
  for (const [slot, value] of Object.entries(palette.colors)) {
    if (value.length !== 4) throw new Error(`Colour ${slot} needs four components.`)
    style[pascal(slot)] = colour(value)
  }
  for (const slot of METRIC_KEYS) {
    const value = palette.metrics[slot]
    if (typeof value !== 'number') throw new Error(`Metric ${slot} is missing from the palette.`)
    style[pascal(slot)] = value.toFixed(6)
  }
  style.ColFPSText = colour([...palette.inputs.accent, 1])
  return style
}

export interface StyledIni {
  text: string
  /** Keys whose value the palette changed. */
  changed: string[]
  /** Palette slots that have no key in the file's `[STYLE]`: they are not added, so the caller can refuse them. */
  unmapped: string[]
}

/** Writes the palette over the values in the `[STYLE]` section of a ReShade.ini and touches nothing else, line endings included. */
export function applyReshadeStyle(ini: string, palette: EmberPalette): StyledIni {
  const style = reshadeStyle(palette)
  const newline = ini.includes('\r\n') ? '\r\n' : '\n'
  const changed: string[] = []
  const seen = new Set<string>()
  let inStyle = false
  const lines = ini.split(/\r?\n/).map((line) => {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (header) { inStyle = header[1].toUpperCase() === 'STYLE'; return line }
    if (!inStyle) return line
    const at = line.indexOf('=')
    if (at <= 0) return line
    const key = line.slice(0, at).trim()
    const wanted = style[key]
    if (wanted === undefined) return line
    seen.add(key)
    if (line.slice(at + 1).trim() !== wanted) changed.push(key)
    return `${key}=${wanted}`
  })
  const unmapped = Object.keys(style).filter((key) => !seen.has(key))
  return { text: lines.join(newline), changed, unmapped }
}
