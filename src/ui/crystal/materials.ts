// Facet ramps are illustration materials, separate from Ember's UI colour roles.
const RAMPS = {
  ember: ['#1a0602', '#4a1404', '#9c3208', '#ec6a1c', '#ff9c50', '#ffd2a2', '#fff7ec'],
  glass: ['#0b0c0f', '#16181c', '#24262c', '#3a3d45', '#666a74', '#a9adb6', '#e6e8ec'],
  dark: ['#0b0a0a', '#151313', '#211e1d', '#2e2a28', '#3f3a37', '#58524e', '#7d7672'],
  steel: ['#0e0f11', '#1c1d21', '#2c2e33', '#45484f', '#6b6f78', '#9a9ea7', '#c9ccd2'],
}
export type Material = keyof typeof RAMPS
const RGB = Object.fromEntries(Object.entries(RAMPS).map(([name, colors]) => [name, colors.map((hex) => {
  const value = parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
})])) as Record<Material, number[][]>

export function shade(material: Material, light: number): string {
  const ramp = RGB[material]
  const position = Math.min(0.9999, Math.max(0, light)) * (ramp.length - 1)
  const index = Math.floor(position), fraction = position - index
  const rgb = ramp[index].map((v, i) => Math.round(v + (ramp[index + 1][i] - v) * fraction))
  return `rgb(${rgb.join(',')})`
}

export const LIGHT_COLOR = '#fff3e0'
export const WARM_COLOR = '#ffb36b'
export const ACCENT_COLOR = '#f47521'
export const GLASS_EDGE = '#e6e8ec'
export const LIT_EDGE = '#ffe4c8'
