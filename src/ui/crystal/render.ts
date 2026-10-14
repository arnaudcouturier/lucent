import type { CrystalState } from '../../core/crystal'
import { CLUSTER, ORBIT, SHARD, SPIRE, TAU, compose, cross, dot, hull, move, normalize, rotateX, rotateY, rotateZ, scale, subtract, type Mesh, type Point, type Transform, type Vec3 } from './geometry'
import { ACCENT_COLOR, GLASS_EDGE, LIGHT_COLOR, LIT_EDGE, WARM_COLOR, shade, type Material } from './materials'

export const WIDTH = 248
export const HEIGHT = 214
const SIZE = HEIGHT * 0.29
const CENTER: Point = [WIDTH / 2, HEIGHT * 0.5 + SIZE * 0.36]
const camera = rotateX(0.24)
const LIGHT = normalize([-0.45, 0.65, 0.62])
const HALF_LIGHT = normalize([LIGHT[0], LIGHT[1], LIGHT[2] + 1])
const DARK_FACETS = new Set([2, 9, 13, 20, 26, 31])

/** Separate phases avoid jumps when speed changes. `fill` is the light level on screen, easing toward progress. */
export interface Motion {
  spin: number
  orbit: number
  float: number
  effects: number
  fall: number
  fill: number
}
export const initialMotion = (): Motion => ({ spin: 0.5, orbit: 0, float: 0, effects: 0, fall: 0, fill: 0 })

/** The fill's time constant: progress arrives in steps, and the light glides between them. */
const FILL_EASE_SECONDS = 0.45

export function advanceMotion(motion: Motion, seconds: number, state: CrystalState) {
  motion.fill = state.mode === 'fill' ? motion.fill + (state.fill - motion.fill) * (1 - Math.exp(-seconds / FILL_EASE_SECONDS)) : 0
  if (state.mode === 'disabled') return
  const pace = state.mode === 'busy' ? 3.2 : state.mode === 'drift' ? 0.35 : 1
  motion.spin += seconds * 0.16 * pace
  motion.orbit += seconds * pace
  motion.float += seconds
  motion.effects += seconds
  motion.fall = state.mode === 'drift' ? Math.min(1, motion.fall + seconds / 0.9) : 0
}

interface Facet {
  points: Point[]
  depth: number
  front: boolean
  light: number
  alpha: number
  edge: number
  dark: boolean
}
interface Layer {
  depth: number
  paint(): void
}

const project = ([x, y, z]: Vec3): Point => {
  const perspective = 5 / (5 - z)
  return [CENTER[0] + x * SIZE * perspective, CENTER[1] - y * SIZE * perspective]
}

function place(mesh: Mesh, transform: Transform, dark?: Set<number>) {
  const vertices = mesh.vertices.map((point) => camera(transform(point)))
  const center = camera(transform(mesh.center))
  const points = vertices.map(project)
  const facets: Facet[] = mesh.faces.map((indices, index) => {
    const [a, b, c] = indices.map((i) => vertices[i])
    const centroid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]
    let normal = normalize(cross(subtract(b, a), subtract(c, a)))
    if (dot(normal, subtract(centroid, center)) < 0) normal = normal.map((v) => -v) as Vec3
    const front = normal[2] > 0
    const diffuse = Math.max(0, dot(normal, LIGHT))
    const specular = Math.pow(Math.max(0, dot(normal, HALF_LIGHT)), 28)
    const rim = 1 - Math.abs(normal[2])
    return {
      points: indices.map((i) => points[i]), depth: centroid[2], front,
      light: front ? 0.1 + 0.6 * diffuse + 0.26 * rim + 0.6 * specular : 0.12 + 0.38 * Math.max(0, -dot(normal, LIGHT)) + 0.14 * rim,
      alpha: front ? Math.min(1, 0.5 + 0.4 * specular + 0.12 * diffuse) : 0.55,
      edge: front ? Math.max(0, 0.6 * rim + 0.8 * specular - 0.18) : 0.12,
      dark: dark?.has(index) ?? false,
    }
  })
  return { points, facets, center: project(center) }
}

function polygon(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.beginPath()
  points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y))
  ctx.closePath()
}

function paintFacet(ctx: CanvasRenderingContext2D, facet: Facet, material: Material) {
  const glass = material === 'glass'
  polygon(ctx, facet.points)
  ctx.fillStyle = shade(facet.dark ? 'dark' : material, facet.light)
  ctx.globalAlpha = facet.alpha * (glass ? 0.55 : 1)
  ctx.fill()
  ctx.strokeStyle = glass ? GLASS_EDGE : LIT_EDGE
  ctx.globalAlpha = Math.min(0.85, facet.edge * (glass ? 1.6 : 1) + (glass && facet.front ? 0.12 : 0))
  ctx.lineWidth = facet.front ? 0.7 : 0.5
  ctx.lineJoin = 'round'
  ctx.stroke()
  ctx.globalAlpha = 1
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, alpha: number, hot = false) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(rx, ry)
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
  gradient.addColorStop(0, hot ? LIGHT_COLOR : WARM_COLOR)
  gradient.addColorStop(0.35, hot ? WARM_COLOR : ACCENT_COLOR)
  gradient.addColorStop(1, 'rgba(244,117,33,0)')
  ctx.fillStyle = gradient
  ctx.globalAlpha = alpha
  ctx.beginPath()
  ctx.arc(0, 0, 1, 0, TAU)
  ctx.fill()
  ctx.restore()
}

/** Canvas owns animation and shading; React only supplies a new status when the core changes. */
export function drawCrystal(ctx: CanvasRenderingContext2D, state: CrystalState, motion: Motion) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT)
  const glass = state.mode === 'glass' || state.mode === 'scan' || state.mode === 'disabled' || state.mode === 'fill'
  const material: Material = state.mode === 'disabled' ? 'steel' : glass ? 'glass' : 'ember'
  const bob = Math.sin(motion.float * 0.9) * 0.035
  const world = (local: Transform) => compose(local, rotateY(motion.spin), move([0, bob, 0]))
  const main = place(SPIRE, world((point) => point), state.mode === 'drift' ? DARK_FACETS : undefined)
  const cluster = CLUSTER.map(({ mesh, transform }) => place(mesh, world(transform)))
  const facets = [main, ...cluster].flatMap((mesh) => mesh.facets).sort((a, b) => a.depth - b.depth)
  const outline = hull(main.points)
  const top = main.points[0], bottom = main.points[main.points.length - 1]
  const fill = state.mode === 'fill' ? Math.min(1, Math.max(0, motion.fill)) : 0
  const fillY = bottom[1] - (bottom[1] - top[1] + 6) * fill
  const core = state.mode === 'drift' ? 0.45 : state.mode === 'fill' ? fill : glass ? 0 : 0.9
  const breathe = 0.9 + 0.1 * Math.sin(motion.effects * TAU / 5)
  if (core > 0) {
    glow(ctx, main.center[0], main.center[1], SIZE * 1.5, SIZE * 1.9, core * 0.16 * breathe)
    glow(ctx, CENTER[0], CENTER[1] + SIZE * 1.25, SIZE * 0.7, SIZE * 0.08, core * 0.2)
  }
  if (state.mode === 'update') {
    // An available update swells the light instead of drawing a ring around the crystal.
    const swell = 0.5 - 0.5 * Math.cos(motion.effects * TAU / 2.8)
    glow(ctx, main.center[0], main.center[1], SIZE * (1.55 + swell * 0.3), SIZE * (1.95 + swell * 0.35), 0.05 + swell * 0.12)
  }

  // Two shards ride an unseen orbit that precesses around the spire.
  const layers: Layer[] = []
  const orbit = compose(rotateX(ORBIT.tilt), rotateY(ORBIT.phase + motion.orbit * ORBIT.precession), move([0, bob, 0]))
  const pointAt = (angle: number) => camera(orbit([Math.cos(angle) * ORBIT.radius, 0, Math.sin(angle) * ORBIT.radius]))
  for (let i = 0; i < 2; i++) {
    const angle = motion.orbit * ORBIT.speed + 0.6 + i * Math.PI
    const fall = state.mode === 'drift' && i === 0 ? motion.fall : 0
    const shard = place(SHARD, compose(scale(0.22), rotateY(motion.orbit * 1.4), rotateZ(-0.55 + fall * 1.45), move([ORBIT.radius + fall * 0.25, 0.05 - fall * 1.05, 0]), rotateY(-angle), orbit))
    layers.push({ depth: pointAt(angle)[2], paint() {
      for (const facet of shard.facets.sort((a, b) => a.depth - b.depth)) paintFacet(ctx, facet, fall > 0 ? 'dark' : material)
      if (fill > 0) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, fillY, WIDTH, HEIGHT)
        ctx.clip()
        for (const facet of shard.facets) paintFacet(ctx, facet, 'ember')
        ctx.restore()
      }
    } })
  }
  layers.sort((a, b) => a.depth - b.depth)
  for (const layer of layers) if (layer.depth < 0) layer.paint()

  const paintBody = (front: boolean, pal: Material) => {
    for (const facet of facets) if (facet.front === front) paintFacet(ctx, facet, pal)
  }
  paintBody(false, material)
  ctx.save()
  polygon(ctx, outline)
  ctx.clip()
  if (state.mode === 'fill') {
    ctx.beginPath()
    ctx.rect(0, fillY, WIDTH, HEIGHT)
    ctx.clip()
  }
  if (core > 0) {
    glow(ctx, main.center[0], main.center[1] + SIZE * 0.1, SIZE * 0.3, SIZE * 1.05, core)
    glow(ctx, main.center[0], main.center[1] + SIZE * 0.1, SIZE * 0.09, SIZE * 0.55, core, true)
  }
  ctx.restore()
  paintBody(true, material)
  if (fill > 0) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, fillY, WIDTH, HEIGHT)
    ctx.clip()
    paintBody(false, 'ember')
    paintBody(true, 'ember')
    ctx.restore()
  }
  if (state.mode === 'scan' || (fill > 0 && fill < 0.999)) {
    ctx.save()
    polygon(ctx, outline)
    ctx.clip()
    const y = state.mode === 'scan' ? top[1] + (bottom[1] - top[1]) * (0.5 - Math.cos(motion.effects * Math.PI / 1.7) * 0.5) : fillY
    const band = ctx.createLinearGradient(0, y - 26, 0, y)
    band.addColorStop(0, 'rgba(255,179,107,0)')
    band.addColorStop(1, 'rgba(255,243,224,0.8)')
    ctx.fillStyle = band
    ctx.fillRect(0, y - 26, WIDTH, 26)
    ctx.restore()
  }
  if (!glass && state.mode !== 'drift') {
    const twinkle = 0.5 + Math.sin(motion.effects * TAU / 3.8) * 0.3
    const radius = SIZE * 0.09 * twinkle
    polygon(ctx, [[top[0], top[1] - radius], [top[0] + radius * 0.18, top[1] - radius * 0.18], [top[0] + radius, top[1]], [top[0] + radius * 0.18, top[1] + radius * 0.18], [top[0], top[1] + radius], [top[0] - radius * 0.18, top[1] + radius * 0.18], [top[0] - radius, top[1]], [top[0] - radius * 0.18, top[1] - radius * 0.18]])
    ctx.fillStyle = LIGHT_COLOR
    ctx.fill()
  }
  for (const layer of layers) if (layer.depth >= 0) layer.paint()
}
