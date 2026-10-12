// PROTOTYPE: original crystal spire with two spinning rings, rendered as real 3D meshes projected into SVG.
// Evokes an aetheryte-like silhouette (clustered spire, tilted orbiting rings, shards riding a ring) without
// copying Square Enix's design: no cup/prong base, our own facet studs on the rings, floating cluster.
// Its light and motion are the deployment state.
import { useEffect, useId, useState, type ReactNode } from 'react'

export type CrystalMode = 'lit' | 'drift' | 'update' | 'busy' | 'glass' | 'scan' | 'fill'
export type CrystalPalette = 'ember' | 'aether'

type V3 = [number, number, number]
type Face = [number, number, number]
type Xf = (p: V3) => V3
interface Mesh {
  v: V3[]
  f: Face[]
  center: V3
}

const TAU = Math.PI * 2
const RAMPS = {
  ember: ['#1a0602', '#4a1404', '#9c3208', '#ec6a1c', '#ff9c50', '#ffd2a2', '#fff7ec'],
  aether: ['#040a26', '#0d2670', '#1c50d0', '#3b88ff', '#7cc2ff', '#c6ebff', '#f3fbff'],
  glass: ['#0b0c0f', '#16181c', '#24262c', '#3a3d45', '#666a74', '#a9adb6', '#e6e8ec'],
  dead: ['#0b0a0a', '#151313', '#211e1d', '#2e2a28', '#3f3a37', '#58524e', '#7d7672'],
  gold: ['#1d150b', '#4a3720', '#86663c', '#c49d66', '#e6c793', '#f7e5c4', '#fffaf0'],
  steel: ['#0e0f11', '#1c1d21', '#2c2e33', '#45484f', '#6b6f78', '#9a9ea7', '#c9ccd2'],
}
type RampName = keyof typeof RAMPS

/* ---------- tiny 3D kit ---------- */
const rotY = (a: number): Xf => {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return ([x, y, z]) => [x * c + z * s, y, -x * s + z * c]
}
const rotX = (a: number): Xf => {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return ([x, y, z]) => [x, y * c - z * s, y * s + z * c]
}
const rotZ = (a: number): Xf => {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return ([x, y, z]) => [x * c - y * s, x * s + y * c, z]
}
const scale = (k: number): Xf => ([x, y, z]) => [x * k, y * k, z * k]
const move = (d: V3): Xf => ([x, y, z]) => [x + d[0], y + d[1], z + d[2]]
const chain = (...fs: Xf[]): Xf => (p) => fs.reduce((q, f) => f(q), p)
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const LIGHT = norm([-0.45, 0.65, 0.62])
const HALF = norm([LIGHT[0], LIGHT[1], LIGHT[2] + 1])

const RGB = Object.fromEntries(
  Object.entries(RAMPS).map(([k, v]) => [
    k,
    v.map((h) => {
      const n = parseInt(h.slice(1), 16)
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    }),
  ]),
) as Record<RampName, number[][]>
function ramp(name: RampName, t: number) {
  const r = RGB[name]
  const x = Math.min(0.9999, Math.max(0, t)) * (r.length - 1)
  const i = Math.floor(x)
  const k = x - i
  const c = r[i].map((a, j) => Math.round(a + (r[i + 1][j] - a) * k))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

function ringPts(n: number, y: number, r: number, off: number, jitter: number[]): V3[] {
  return Array.from({ length: n }, (_, i) => {
    const a = off + (i / n) * TAU
    const rr = r * (1 + jitter[i % jitter.length])
    return [Math.cos(a) * rr, y, Math.sin(a) * rr]
  })
}

/** Pointed crystal: apex, rings (top to bottom, alternately offset by half a step), bottom point. */
function spire(top: V3, rings: { y: number; r: number; jitter: number[] }[], bottom: V3, n: number): Mesh {
  const rs = rings.map((g, k) => ringPts(n, g.y, g.r, (k % 2) * (Math.PI / n), g.jitter))
  const v: V3[] = [top, ...rs.flat(), bottom]
  const f: Face[] = []
  const at = (k: number, i: number) => 1 + k * n + (((i % n) + n) % n)
  for (let i = 0; i < n; i++) f.push([0, at(0, i), at(0, i + 1)])
  for (let k = 0; k < rs.length - 1; k++) {
    for (let i = 0; i < n; i++) {
      if (k % 2 === 0) {
        // next ring is offset forward by half a step
        f.push([at(k, i), at(k + 1, i), at(k, i + 1)])
        f.push([at(k, i + 1), at(k + 1, i), at(k + 1, i + 1)])
      } else {
        // this ring is offset, next ring is not
        f.push([at(k, i), at(k + 1, i + 1), at(k, i + 1)])
        f.push([at(k, i), at(k + 1, i), at(k + 1, i + 1)])
      }
    }
  }
  const last = v.length - 1
  const kL = rs.length - 1
  for (let i = 0; i < n; i++) f.push([last, at(kL, i + 1), at(kL, i)])
  return { v, f, center: [0, (top[1] + bottom[1]) / 2, 0] }
}

// The spire: tall, slightly irregular, with a long point.
const MAIN = spire(
  [0.04, 1.78, 0.02],
  [
    { y: 0.78, r: 0.25, jitter: [0.06, -0.04, 0.05, -0.07, 0.03, -0.02] },
    { y: 0.08, r: 0.37, jitter: [-0.03, 0.05, -0.06, 0.04, -0.04, 0.06] },
    { y: -0.55, r: 0.27, jitter: [0.05, -0.05, 0.03, -0.06, 0.06, -0.02] },
  ],
  [0, -1.02, 0],
  6,
)
const SAT = spire([0.02, 1, 0], [{ y: 0.02, r: 0.23, jitter: [0.06, -0.05, 0.04, -0.06, 0.02] }], [0, -0.5, 0], 5)
const CHIP = spire([0, 1, 0], [{ y: 0.12, r: 0.32, jitter: [0.05, -0.08, 0.03, -0.02] }], [0, -0.72, 0], 4)

// Smaller crystals flaring out from the spire's base, like a cluster.
const CLUSTER = [
  { az: 0.3, lean: 0.36, r: 0.2, y: -0.42, k: 0.78, spin: 0.4 },
  { az: 1.55, lean: 0.48, r: 0.22, y: -0.55, k: 0.55, spin: 1.3 },
  { az: 2.6, lean: 0.3, r: 0.2, y: -0.38, k: 0.86, spin: 2.2 },
  { az: 3.8, lean: 0.52, r: 0.24, y: -0.6, k: 0.5, spin: 0.9 },
  { az: 5.0, lean: 0.4, r: 0.21, y: -0.48, k: 0.7, spin: 1.8 },
]
const satXf = (c: (typeof CLUSTER)[number]): Xf => chain(scale(c.k), rotY(c.spin), rotZ(-c.lean), move([c.r, c.y, 0]), rotY(c.az))

// Facets of the spire that go dark on drift, scattered so it reads as light failing, not a band.
const DEAD = new Set([2, 9, 13, 20, 26, 31])

interface RingSpec {
  R: number
  y: number
  tilt: number
  precess: number
  spin: number
  width: number
  phase: number
}
const RINGS: RingSpec[] = [
  { R: 1.12, y: 0.0, tilt: 0.3, precess: 0.22, spin: 0.5, width: 0.08, phase: 0.6 },
  { R: 0.6, y: 1.02, tilt: -0.42, precess: -0.36, spin: -0.8, width: 0.045, phase: 2.2 },
]

interface Shaded {
  pts: string
  z: number
  front: boolean
  fill: string
  opacity: number
  edge: number
  key: string
}
interface Cam {
  S: number
  cx: number
  cy: number
  tilt: number
}

function project(cam: Cam, p: V3) {
  const k = 5 / (5 - p[2])
  return [cam.cx + p[0] * cam.S * k, cam.cy - p[1] * cam.S * k] as const
}

/** Place a mesh (object transform, then camera tilt) and shade every facet. */
function place(mesh: Mesh, xf: Xf, cam: Cam, pal: RampName, key: string, dead?: Set<number>) {
  const cam3 = rotX(cam.tilt)
  const vv = mesh.v.map((p) => cam3(xf(p)))
  const c = cam3(xf(mesh.center))
  const pv = vv.map((p) => project(cam, p))
  const faces: Shaded[] = mesh.f.map((f, idx) => {
    const [a, b, d] = f.map((i) => vv[i])
    let n = norm(cross(sub(b, a), sub(d, a)))
    const cen: V3 = [(a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3, (a[2] + b[2] + d[2]) / 3]
    if (dot(n, sub(cen, c)) < 0) n = [-n[0], -n[1], -n[2]]
    const front = n[2] > 0
    const diff = Math.max(0, dot(n, LIGHT))
    const spec = Math.pow(Math.max(0, dot(n, HALF)), 28)
    const rim = 1 - Math.abs(n[2])
    const t = front ? 0.1 + 0.6 * diff + 0.26 * rim + 0.6 * spec : 0.12 + 0.38 * Math.max(0, -dot(n, LIGHT)) + 0.14 * rim
    return {
      pts: f.map((i) => pv[i].map((q) => q.toFixed(1)).join(',')).join(' '),
      z: cen[2],
      front,
      fill: ramp(dead?.has(idx) ? 'dead' : pal, t),
      opacity: front ? 0.5 + 0.4 * spec + 0.12 * diff : 0.55,
      edge: front ? Math.max(0, 0.6 * rim + 0.8 * spec - 0.18) : 0.12,
      key: key + idx,
    }
  })
  return { faces, pv, center: project(cam, c) }
}

function hull(points: (readonly [number, number])[]) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cr = (o: readonly number[], a: readonly number[], b: readonly number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: (readonly [number, number])[] = []
  for (const q of p) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop()
    lo.push(q)
  }
  const up: (readonly [number, number])[] = []
  for (const q of p.reverse()) {
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop()
    up.push(q)
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)].map((q) => q.map((x) => x.toFixed(1)).join(',')).join(' ')
}

function useClock(running: boolean) {
  const [t, setT] = useState(0)
  useEffect(() => {
    if (!running || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    let last = 0
    const start = performance.now() - t * 1000
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now - last < 30) return // ~30 fps is plenty for slow motion
      last = now
      setT((now - start) / 1000)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])
  return t
}

type Layered = { z: number; el: ReactNode }

export function Crystal3D({ mode, palette = 'ember', fill = 1, height }: { mode: CrystalMode; palette?: CrystalPalette; fill?: number; height: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const id = (s: string) => `${uid}${s}`
  const glass = mode === 'glass' || mode === 'scan'
  const t = useClock(mode !== 'glass')

  const H = height
  const W = Math.round(height * 1.16)
  const S = H * 0.29
  const cam: Cam = { S, cx: W / 2, cy: H * 0.5 + 0.36 * S, tilt: 0.24 }
  const pace = mode === 'busy' ? 3.2 : mode === 'drift' ? 0.35 : mode === 'scan' ? 1.3 : 1
  const spin = 0.5 + t * 0.16 * pace
  const bob = glass ? 0 : Math.sin(t * 0.9) * 0.035
  const pal: RampName = glass ? 'glass' : palette
  const metal: RampName = mode === 'glass' ? 'steel' : 'gold'
  const world = (local: Xf): Xf => chain(local, rotY(spin), move([0, bob, 0]))
  const cam3 = rotX(cam.tilt)

  // Crystal cluster
  const main = place(MAIN, world((p) => p), cam, pal, 'm', mode === 'drift' ? DEAD : undefined)
  const all = [main, ...CLUSTER.map((c, i) => place(SAT, world(satXf(c)), cam, pal, `s${i}`))]
  const lit = mode === 'fill' ? [place(MAIN, world((p) => p), cam, palette, 'lm'), ...CLUSTER.map((c, i) => place(SAT, world(satXf(c)), cam, palette, `ls${i}`))] : null
  const outline = hull(main.pv)
  const top = main.pv[0]
  const bottom = main.pv[main.pv.length - 1]
  const fillY = bottom[1] - (bottom[1] - top[1] + 6) * fill
  const core = mode === 'glass' ? 0 : mode === 'scan' ? 0.15 : mode === 'drift' ? 0.45 : mode === 'busy' ? 1 : mode === 'fill' ? 0.25 + 0.75 * fill : 0.9

  // Rings: tilted hoops that precess around the spire; studs and riding shards travel along them.
  const layers: Layered[] = []
  RINGS.forEach((r, ri) => {
    const stalled = mode === 'drift' && ri === 1
    const tiltA = r.tilt + (stalled ? 0.45 : 0)
    const beta = r.phase + (stalled ? 0 : t * r.precess * pace)
    const phi = stalled ? 0.3 : t * r.spin * pace
    const toWorld = chain(rotX(tiltA), rotY(beta), move([0, r.y + bob, 0]))
    const origin = toWorld([0, 0, 0])
    const N = 56
    const pts = Array.from({ length: N + 1 }, (_, i) => {
      const u = (i / N) * TAU
      const w = toWorld([Math.cos(u) * r.R, 0, Math.sin(u) * r.R])
      const v = cam3(w)
      return { w, v, p: project(cam, v), radial: norm(cam3(sub(w, origin))) }
    })
    // Band: butt-capped segments, each nudged to overlap its neighbours so the hoop reads as one smooth metal band.
    let run: string[] = []
    let runZ: number[] = []
    const flush = (key: string) => {
      if (run.length > 1) {
        const z = runZ.reduce((x, y) => x + y, 0) / runZ.length + 0.0005
        const wpx = r.width * S
        layers.push({
          z,
          el: <polyline key={key} points={run.join(' ')} fill="none" stroke={ramp(metal, 0.97)} strokeWidth={wpx * 0.24} strokeLinejoin="round" strokeLinecap="round" opacity={0.55} />,
        })
      }
      run = []
      runZ = []
    }
    for (let i = 0; i < N; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const front = a.w[2] + b.w[2] > 0
      const facing = Math.max(0, dot(a.radial, LIGHT))
      const k = 5 / (5 - (a.v[2] + b.v[2]) / 2)
      const shade = front ? 0.38 + 0.5 * facing + 0.12 * Math.max(0, a.radial[2]) : 0.2 + 0.18 * facing
      const wpx = r.width * S * k
      const dx = b.p[0] - a.p[0]
      const dy = b.p[1] - a.p[1]
      const len = Math.hypot(dx, dy) || 1
      const ex = (dx / len) * 0.7
      const ey = (dy / len) * 0.7
      layers.push({
        z: (a.w[2] + b.w[2]) / 2,
        el: (
          <line
            key={`r${ri}-${i}`}
            x1={a.p[0] - ex}
            y1={a.p[1] - ey}
            x2={b.p[0] + ex}
            y2={b.p[1] + ey}
            stroke={ramp(metal, shade)}
            strokeWidth={wpx}
            strokeLinecap="butt"
          />
        ),
      })
      if (front) {
        if (!run.length) run.push(`${a.p[0].toFixed(1)},${a.p[1].toFixed(1)}`)
        run.push(`${b.p[0].toFixed(1)},${b.p[1].toFixed(1)}`)
        runZ.push((a.w[2] + b.w[2]) / 2)
      } else flush(`hl${ri}-${i}`)
    }
    flush(`hl${ri}-end`)
    // Facet studs, our own motif: small rhombi along the hoop.
    const studs = ri === 0 ? 6 : 4
    for (let s = 0; s < studs; s++) {
      const u = phi + (s / studs) * TAU
      const w = toWorld([Math.cos(u) * r.R, 0, Math.sin(u) * r.R])
      const v = cam3(w)
      const p = project(cam, v)
      const tan = project(cam, cam3(toWorld([Math.cos(u + 0.05) * r.R, 0, Math.sin(u + 0.05) * r.R])))
      const ang = (Math.atan2(tan[1] - p[1], tan[0] - p[0]) * 180) / Math.PI
      const sz = r.width * S * (5 / (5 - v[2])) * 0.95
      const front = w[2] > 0
      layers.push({
        z: w[2] + 0.001,
        el: (
          <polygon
            key={`st${ri}-${s}`}
            points={`${-sz * 1.15},0 0,${-sz * 0.7} ${sz * 1.15},0 0,${sz * 0.7}`}
            transform={`translate(${p[0].toFixed(1)} ${p[1].toFixed(1)}) rotate(${ang.toFixed(1)})`}
            fill={ramp(metal, front ? 0.92 : 0.45)}
            opacity={front ? 1 : 0.6}
          />
        ),
      })
    }
    // Two shards riding the big ring.
    if (ri === 0) {
      ;[0.6, 0.6 + Math.PI].forEach((off, si) => {
        const fallen = mode === 'drift' && si === 0
        const u = phi * 0.6 + off
        const xf = fallen
          ? chain(scale(0.2), rotZ(0.9), move([r.R + 0.25, -0.95, 0]), rotY(-u), rotY(beta), move([0, bob, 0]))
          : chain(scale(0.22), rotY(t * 1.4 * pace), rotZ(-0.55), move([r.R + 0.02, 0.05, 0]), rotY(-u), toWorld)
        const chip = place(CHIP, xf, cam, fallen ? 'dead' : pal, `c${si}`)
        const wz = chain(move([r.R, 0, 0]), rotY(-u), toWorld)([0, 0, 0])[2]
        layers.push({
          z: wz,
          el: (
            <g key={`chip${si}`} opacity={fallen ? 0.7 : 1}>
              {chip.faces
                .filter((f) => !f.front)
                .map((f) => (
                  <polygon key={f.key} points={f.pts} fill={f.fill} fillOpacity={f.opacity} />
                ))}
              {chip.faces
                .filter((f) => f.front)
                .map((f) => (
                  <polygon key={f.key} points={f.pts} fill={f.fill} fillOpacity={f.opacity} stroke={glass ? '#e6e8ec' : '#ffe4c8'} strokeOpacity={f.edge} strokeWidth={0.5} />
                ))}
            </g>
          ),
        })
      })
    }
  })
  const behind = layers.filter((l) => l.z < 0).sort((a, b) => a.z - b.z)
  const ahead = layers.filter((l) => l.z >= 0).sort((a, b) => a.z - b.z)

  const facets = (groups: { faces: Shaded[] }[], front: boolean) =>
    groups
      .flatMap((g) => g.faces)
      .filter((f) => f.front === front)
      .sort((a, b) => a.z - b.z)
      .map((f) => (
        <polygon
          key={f.key + (front ? 'f' : 'b')}
          points={f.pts}
          fill={f.fill}
          fillOpacity={f.opacity * (glass ? 0.55 : 1)}
          stroke={glass ? '#e6e8ec' : palette === 'ember' ? '#ffe4c8' : '#dff2ff'}
          strokeOpacity={Math.min(0.85, f.edge * (glass ? 1.6 : 1) + (glass && front ? 0.12 : 0))}
          strokeWidth={front ? 0.7 : 0.5}
          strokeLinejoin="round"
        />
      ))

  const accent = palette === 'ember' ? ['#fff3e0', '#ffb36b', '#f47521'] : ['#f2fbff', '#8fd0ff', '#3b88ff']

  return (
    <svg className={`c3 is-${mode}`} viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
      <defs>
        <radialGradient id={id('aura')}>
          <stop offset="0" stopColor={accent[2]} stopOpacity="0.5" />
          <stop offset="0.5" stopColor={accent[2]} stopOpacity="0.1" />
          <stop offset="1" stopColor={accent[2]} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id('core')}>
          <stop offset="0" stopColor={accent[0]} stopOpacity="1" />
          <stop offset="0.35" stopColor={accent[1]} stopOpacity="0.75" />
          <stop offset="1" stopColor={accent[2]} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id('hot')}>
          <stop offset="0" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="0.4" stopColor={accent[0]} stopOpacity="0.85" />
          <stop offset="1" stopColor={accent[1]} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id('sheen')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0.28" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.4" stopColor="#ffffff" stopOpacity="0.26" />
          <stop offset="0.47" stopColor="#ffffff" stopOpacity="0.04" />
          <stop offset="0.56" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="0.62" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id('depth')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0" />
          <stop offset="0.6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id={id('band')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={accent[1]} stopOpacity="0" />
          <stop offset="0.8" stopColor={accent[1]} stopOpacity="0.5" />
          <stop offset="1" stopColor={accent[0]} stopOpacity="0.95" />
        </linearGradient>
        <clipPath id={id('hull')}>
          <polygon points={outline} />
        </clipPath>
        <clipPath id={id('fill')}>
          <rect x="0" y={fillY} width={W} height={H} />
        </clipPath>
        <filter id={id('soft')} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={H * 0.04} />
        </filter>
      </defs>

      <ellipse className="c3-aura" cx={cam.cx} cy={main.center[1]} rx={S * 1.5} ry={S * 1.9} fill={`url(#${id('aura')})`} />
      <ellipse className="c3-ring" cx={cam.cx} cy={main.center[1]} rx={S * 1.25} ry={S * 1.75} fill="none" stroke={accent[1]} strokeWidth="1" />
      <ellipse className="c3-floor" cx={cam.cx} cy={cam.cy + 1.25 * S} rx={S * 0.7} ry={S * 0.08} fill={`url(#${id('aura')})`} />

      <g className="c3-rings">{behind.map((l) => l.el)}</g>

      <g className="c3-body">
        <polygon points={outline} fill={accent[1]} opacity={glass ? 0 : 0.45 * core} filter={`url(#${id('soft')})`} />
        {facets(all, false)}
        <g clipPath={`url(#${id('hull')})`}>
          <ellipse className="c3-core" cx={main.center[0]} cy={main.center[1] + S * 0.1} rx={S * 0.3} ry={S * 1.05} fill={`url(#${id('core')})`} opacity={core} />
          <ellipse className="c3-core" cx={main.center[0]} cy={main.center[1] + S * 0.1} rx={S * 0.09} ry={S * 0.55} fill={`url(#${id('hot')})`} opacity={core} />
        </g>
        {facets(all, true)}
        {!glass && (
          <g clipPath={`url(#${id('hull')})`}>
            {/* light passing through the front facets, then glass sheen and depth toward the bottom */}
            <ellipse
              className="c3-core"
              cx={main.center[0]}
              cy={main.center[1] + S * 0.1}
              rx={S * 0.14}
              ry={S * 0.7}
              fill={`url(#${id('hot')})`}
              opacity={core * 0.5}
              style={{ mixBlendMode: 'screen' }}
            />
            <rect x={cam.cx - S * 0.6} y={top[1]} width={S * 1.2} height={bottom[1] - top[1]} fill={`url(#${id('sheen')})`} style={{ mixBlendMode: 'screen' }} />
            <rect x="0" y={top[1]} width={W} height={bottom[1] - top[1]} fill={`url(#${id('depth')})`} />
          </g>
        )}
        {lit && (
          <g clipPath={`url(#${id('fill')})`}>
            {facets(lit, false)}
            {facets(lit, true)}
          </g>
        )}
        {mode === 'fill' && fill < 1 && (
          <g clipPath={`url(#${id('hull')})`}>
            <line x1="0" x2={W} y1={fillY} y2={fillY} stroke={accent[0]} strokeWidth="1.5" />
          </g>
        )}
        {mode === 'scan' && (
          <g clipPath={`url(#${id('hull')})`}>
            <rect className="c3-band" x="0" y={top[1] - 40} width={W} height="40" fill={`url(#${id('band')})`} />
          </g>
        )}
      </g>

      {!glass && (
        <g className="c3-sparkles" fill={accent[0]}>
          <path className="c3-spark" d={star(top[0], top[1] + 1, S * 0.09)} />
        </g>
      )}

      <g className="c3-rings">{ahead.map((l) => l.el)}</g>
    </svg>
  )
}

function star(x: number, y: number, r: number) {
  const k = r * 0.18
  return `M${x} ${y - r} L${x + k} ${y - k} L${x + r} ${y} L${x + k} ${y + k} L${x} ${y + r} L${x - k} ${y + k} L${x - r} ${y} L${x - k} ${y - k} Z`
}
