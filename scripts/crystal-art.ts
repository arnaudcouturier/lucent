// Draws the app's crystal into SVG with the app's own renderer, so the README banner and the site's still crystal
// match the 3D asset exactly. Run `npm run build:art` after changing the crystal.
import { writeFileSync } from 'node:fs'
import { HEIGHT, WIDTH, drawCrystal, initialMotion, type Motion } from '../src/ui/crystal/render.ts'

type Matrix = [number, number, number, number, number, number]
const multiply = ([a, b, c, d, e, f]: Matrix, [g, h, i, j, k, l]: Matrix): Matrix =>
  [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f]
const n = (value: number) => Number(value.toFixed(2))

interface Gradient { id: string; kind: 'radial' | 'linear'; coords: number[]; stops: [number, string][]; addColorStop(offset: number, color: string): void }

/** Records the canvas calls the crystal makes as SVG elements. Only what `drawCrystal` uses is supported. */
function svgContext() {
  const body: string[] = []
  const defs: string[] = []
  let path = ''
  let arc: { x: number; y: number; r: number } | null = null
  let state = { transform: [1, 0, 0, 1, 0, 0] as Matrix, clip: '' }
  const stack: (typeof state)[] = []
  let ids = 0
  const point = (x: number, y: number) => {
    const [a, b, c, d, e, f] = state.transform
    return `${n(a * x + c * y + e)} ${n(b * x + d * y + f)}`
  }
  const paint = (style: string | Gradient) => typeof style === 'string' ? style : `url(#${style.id})`
  const clipAttr = () => state.clip ? ` clip-path="url(#${state.clip})"` : ''
  const ctx = {
    fillStyle: '' as string | Gradient,
    strokeStyle: '' as string | Gradient,
    globalAlpha: 1,
    lineWidth: 1,
    lineJoin: 'miter',
    clearRect() {},
    save() { stack.push({ ...state }) },
    restore() { state = stack.pop()! },
    translate(x: number, y: number) { state.transform = multiply(state.transform, [1, 0, 0, 1, x, y]) },
    scale(x: number, y: number) { state.transform = multiply(state.transform, [x, 0, 0, y, 0, 0]) },
    beginPath() { path = ''; arc = null },
    moveTo(x: number, y: number) { path += `M${point(x, y)}` },
    lineTo(x: number, y: number) { path += `L${point(x, y)}` },
    closePath() { path += 'Z' },
    rect(x: number, y: number, w: number, h: number) { path += `M${point(x, y)}L${point(x + w, y)}L${point(x + w, y + h)}L${point(x, y + h)}Z` },
    // The crystal only draws whole circles, under a scale, for its glows.
    arc(x: number, y: number, r: number) { arc = { x, y, r } },
    clip() {
      const id = `c${ids++}`
      defs.push(`<clipPath id="${id}"${state.clip ? ` clip-path="url(#${state.clip})"` : ''}><path d="${path}"/></clipPath>`)
      state.clip = id
    },
    createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): Gradient {
      return { id: `g${ids++}`, kind: 'radial', coords: [x0, y0, r0, x1, y1, r1], stops: [], addColorStop(o, c) { this.stops.push([o, c]) } }
    },
    createLinearGradient(x0: number, y0: number, x1: number, y1: number): Gradient {
      return { id: `g${ids++}`, kind: 'linear', coords: [x0, y0, x1, y1], stops: [], addColorStop(o, c) { this.stops.push([o, c]) } }
    },
    fill() {
      const style = ctx.fillStyle
      if (typeof style !== 'string') {
        // Older SVG renderers ignore rgba() in stop-color, so transparency goes in stop-opacity.
        const stops = style.stops.map(([o, c]) => {
          const rgba = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(c)
          return rgba ? `<stop offset="${o}" stop-color="rgb(${rgba[1]},${rgba[2]},${rgba[3]})" stop-opacity="${rgba[4]}"/>` : `<stop offset="${o}" stop-color="${c}"/>`
        }).join('')
        defs.push(style.kind === 'radial'
          ? `<radialGradient id="${style.id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${style.coords[5]}">${stops}</radialGradient>`
          : `<linearGradient id="${style.id}" gradientUnits="userSpaceOnUse" x1="${n(style.coords[0])}" y1="${n(style.coords[1])}" x2="${n(style.coords[2])}" y2="${n(style.coords[3])}">${stops}</linearGradient>`)
      }
      const opacity = ctx.globalAlpha < 1 ? ` opacity="${n(ctx.globalAlpha)}"` : ''
      if (arc) {
        const [a, , , d, e, f] = state.transform
        body.push(`<g${clipAttr()}><circle transform="matrix(${n(a)} 0 0 ${n(d)} ${n(e)} ${n(f)})" cx="${arc.x}" cy="${arc.y}" r="${arc.r}" fill="${paint(style)}"${opacity}/></g>`)
      } else body.push(`<path d="${path}" fill="${paint(style)}"${opacity}${clipAttr()}/>`)
    },
    stroke() {
      if (ctx.globalAlpha <= 0) return
      body.push(`<path d="${path}" fill="none" stroke="${paint(ctx.strokeStyle)}" stroke-width="${ctx.lineWidth}" stroke-linejoin="${ctx.lineJoin}" opacity="${n(ctx.globalAlpha)}"${clipAttr()}/>`)
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, markup: () => ({ defs: defs.join(''), body: body.join('') }) }
}

/** The lit crystal, as on a healthy Home screen, in a pose where both shards sit clear of the spire. */
export function crystalMarkup(motion: Motion = { ...initialMotion(), spin: 0.35, orbit: 2.3, float: 0.6, effects: 1 }) {
  const { ctx, markup } = svgContext()
  drawCrystal(ctx, { mode: 'lit', fill: 0 }, motion)
  return markup()
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const { defs, body } = crystalMarkup()
  const header = '<!-- Generated by scripts/crystal-art.ts from the app\'s crystal renderer. -->'
  writeFileSync('site/crystal.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" fill="none">\n  ${header}\n  <defs>${defs}</defs>\n  ${body}\n</svg>\n`)
  // The banner: the crystal on the left, the name and one line on the right.
  const scale = 1.55
  writeFileSync('docs/assets/lucent-banner.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 360" role="img" aria-label="Lucent, a manager for XIV graphics mods">
  ${header}
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="360" gradientUnits="userSpaceOnUse"><stop stop-color="#0d0e11"/><stop offset="1" stop-color="#141519"/></linearGradient>
    ${defs}
  </defs>
  <rect width="1200" height="360" rx="18" fill="url(#bg)"/>
  <rect x=".5" y=".5" width="1199" height="359" rx="18" stroke="#fff" stroke-opacity=".08"/>
  <g transform="translate(${n(250 - (WIDTH * scale) / 2)} ${n(180 - (HEIGHT * scale) / 2)}) scale(${scale})">${body}</g>
  <text x="440" y="184" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="80" font-weight="600" fill="#f4f4f5">Lucent</text>
  <text x="443" y="234" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="28" fill="#f47521">A manager for XIV graphics mods</text>
</svg>
`)
  console.log('Wrote site/crystal.svg and docs/assets/lucent-banner.svg')
}
