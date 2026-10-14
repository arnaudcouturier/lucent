// Original Ember silhouette: an irregular spire, a floating cluster, and two orbiting shards.
// Coordinates are in world units; the renderer projects them into a small canvas.
export type Vec3 = [number, number, number]
export type Point = [number, number]
export type Transform = (point: Vec3) => Vec3
export interface Mesh {
  vertices: Vec3[]
  faces: [number, number, number][]
  center: Vec3
}

export const TAU = Math.PI * 2
export const rotateX = (angle: number): Transform => {
  const c = Math.cos(angle), s = Math.sin(angle)
  return ([x, y, z]) => [x, y * c - z * s, y * s + z * c]
}
export const rotateY = (angle: number): Transform => {
  const c = Math.cos(angle), s = Math.sin(angle)
  return ([x, y, z]) => [x * c + z * s, y, -x * s + z * c]
}
export const rotateZ = (angle: number): Transform => {
  const c = Math.cos(angle), s = Math.sin(angle)
  return ([x, y, z]) => [x * c - y * s, x * s + y * c, z]
}
export const scale = (amount: number): Transform => ([x, y, z]) => [x * amount, y * amount, z * amount]
export const move = ([dx, dy, dz]: Vec3): Transform => ([x, y, z]) => [x + dx, y + dy, z + dz]
export const compose = (...transforms: Transform[]): Transform => (point) => transforms.reduce((p, transform) => transform(p), point)
export const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const normalize = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a) || 1
  return [a[0] / length, a[1] / length, a[2] / length]
}

function spire(top: Vec3, bands: { y: number; radius: number; jitter: number[] }[], bottom: Vec3, sides: number): Mesh {
  const vertices: Vec3[] = [top]
  const faces: Mesh['faces'] = []
  for (const [band, { y, radius, jitter }] of bands.entries()) {
    for (let i = 0; i < sides; i++) {
      const angle = i * TAU / sides + (band % 2) * Math.PI / sides
      const r = radius * (1 + jitter[i % jitter.length])
      vertices.push([Math.cos(angle) * r, y, Math.sin(angle) * r])
    }
  }
  vertices.push(bottom)
  const at = (band: number, side: number) => 1 + band * sides + (side % sides)
  for (let i = 0; i < sides; i++) faces.push([0, at(0, i), at(0, i + 1)])
  for (let band = 0; band < bands.length - 1; band++) {
    for (let i = 0; i < sides; i++) {
      const next = i + (band % 2)
      faces.push([at(band, i), at(band + 1, next), at(band, i + 1)])
      faces.push([at(band, i + 1 - band % 2), at(band + 1, i), at(band + 1, i + 1)])
    }
  }
  for (let i = 0; i < sides; i++) faces.push([vertices.length - 1, at(bands.length - 1, i + 1), at(bands.length - 1, i)])
  return { vertices, faces, center: [0, (top[1] + bottom[1]) / 2, 0] }
}

export const SPIRE = spire([0.04, 1.78, 0.02], [
  { y: 0.78, radius: 0.25, jitter: [0.06, -0.04, 0.05, -0.07, 0.03, -0.02] },
  { y: 0.08, radius: 0.37, jitter: [-0.03, 0.05, -0.06, 0.04, -0.04, 0.06] },
  { y: -0.55, radius: 0.27, jitter: [0.05, -0.05, 0.03, -0.06, 0.06, -0.02] },
], [0, -1.02, 0], 6)
const SATELLITE = spire([0.02, 1, 0], [{ y: 0.02, radius: 0.23, jitter: [0.06, -0.05, 0.04, -0.06, 0.02] }], [0, -0.5, 0], 5)
export const SHARD = spire([0, 1, 0], [{ y: 0.12, radius: 0.32, jitter: [0.05, -0.08, 0.03, -0.02] }], [0, -0.72, 0], 4)
export const CLUSTER = [
  { azimuth: 0.3, lean: 0.36, radius: 0.2, y: -0.42, size: 0.78, spin: 0.4 },
  { azimuth: 1.55, lean: 0.48, radius: 0.22, y: -0.55, size: 0.55, spin: 1.3 },
  { azimuth: 2.6, lean: 0.3, radius: 0.2, y: -0.38, size: 0.86, spin: 2.2 },
  { azimuth: 3.8, lean: 0.52, radius: 0.24, y: -0.6, size: 0.5, spin: 0.9 },
  { azimuth: 5, lean: 0.4, radius: 0.21, y: -0.48, size: 0.7, spin: 1.8 },
].map((c) => ({
  mesh: SATELLITE,
  transform: compose(scale(c.size), rotateY(c.spin), rotateZ(-c.lean), move([c.radius, c.y, 0]), rotateY(c.azimuth)),
}))
/** The tilted, precessing path the two shards follow around the spire; nothing draws the path itself. */
export const ORBIT = { radius: 1.14, tilt: 0.3, precession: 0.22, speed: 0.3, phase: 0.6 }

export function hull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const turn = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (list: Point[]) => {
    const result: Point[] = []
    for (const point of list) {
      while (result.length >= 2 && turn(result[result.length - 2], result[result.length - 1], point) <= 0) result.pop()
      result.push(point)
    }
    return result.slice(0, -1)
  }
  return [...half(sorted), ...half(sorted.reverse())]
}
