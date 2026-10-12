// PROTOTYPE: original faceted crystal. Its light is the deployment state.
import { useId } from 'react'

export type CrystalMode = 'scan' | 'glass' | 'lit' | 'drift' | 'update' | 'fill' | 'flare'

const P = {
  T: [100, 6],
  UL: [34, 88],
  UF: [84, 108],
  UM: [128, 100],
  UR: [166, 80],
  LL: [42, 208],
  LF: [88, 228],
  LM: [128, 220],
  LR: [158, 198],
  B: [98, 298],
} as const
type K = keyof typeof P
const pts = (...ks: K[]) => ks.map((k) => P[k].join(',')).join(' ')

const FACES: { id: string; keys: K[] }[] = [
  { id: 'capL', keys: ['T', 'UL', 'UF'] },
  { id: 'capC', keys: ['T', 'UF', 'UM'] },
  { id: 'capR', keys: ['T', 'UM', 'UR'] },
  { id: 'midL', keys: ['UL', 'UF', 'LF', 'LL'] },
  { id: 'midC', keys: ['UF', 'UM', 'LM', 'LF'] },
  { id: 'midR', keys: ['UM', 'UR', 'LR', 'LM'] },
  { id: 'botL', keys: ['LL', 'LF', 'B'] },
  { id: 'botC', keys: ['LF', 'LM', 'B'] },
  { id: 'botR', keys: ['LM', 'LR', 'B'] },
]

const GRAD: Record<string, [string, string]> = {
  capL: ['#6fb2ff', '#2a56d4'],
  capC: ['#e4f7ff', '#7ccdff'],
  capR: ['#aee0ff', '#4c8ef2'],
  midL: ['#2c5ad0', '#0e1a52'],
  midC: ['#8fdcff', '#2449d8'],
  midR: ['#58adff', '#1c36a8'],
  botL: ['#162a6a', '#0a1233'],
  botC: ['#3366e6', '#12236a'],
  botR: ['#24439f', '#0d1745'],
}

const OUTLINE = pts('T', 'UR', 'LR', 'B', 'LL', 'UL')
const EDGES = [
  ['UL', 'UF'], ['UF', 'UM'], ['UM', 'UR'], ['LL', 'LF'], ['LF', 'LM'], ['LM', 'LR'],
  ['UF', 'LF'], ['UM', 'LM'], ['T', 'UF'], ['T', 'UM'], ['LF', 'B'], ['LM', 'B'],
] as [K, K][]

export function Crystal({ mode, fill = 1, height, busy = false }: { mode: CrystalMode; fill?: number; height: number; busy?: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const id = (s: string) => `${uid}${s}`
  const lit = mode === 'lit' || mode === 'drift' || mode === 'update' || mode === 'fill' || mode === 'flare'
  const fillY = 298 - fill * 292
  return (
    <svg
      className={`cr is-${mode} ${lit ? 'is-on' : ''} ${busy ? 'is-busy' : ''}`}
      viewBox="-50 -40 300 380"
      style={{ height, width: (height * 300) / 380 }}
      aria-hidden
    >
      <defs>
        {Object.entries(GRAD).map(([k, [a, b]]) => (
          <linearGradient key={k} id={id(k)} x1="0" y1="0" x2="0.35" y2="1">
            <stop offset="0" stopColor={a} />
            <stop offset="1" stopColor={b} />
          </linearGradient>
        ))}
        <linearGradient id={id('amber')} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#ffd08a" />
          <stop offset="1" stopColor="#b5541a" />
        </linearGradient>
        <radialGradient id={id('glow')}>
          <stop offset="0" stopColor="#4fb8ff" stopOpacity="0.55" />
          <stop offset="0.45" stopColor="#3b6dff" stopOpacity="0.18" />
          <stop offset="1" stopColor="#3b6dff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id('core')}>
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="0.5" stopColor="#9fe4ff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#9fe4ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id('sweep')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id('scan')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7fd4ff" stopOpacity="0" />
          <stop offset="0.85" stopColor="#7fd4ff" stopOpacity="0.45" />
          <stop offset="1" stopColor="#e6f8ff" stopOpacity="0.9" />
        </linearGradient>
        <clipPath id={id('shape')}>
          <polygon points={OUTLINE} />
        </clipPath>
        <clipPath id={id('fill')}>
          <rect x="-50" y={fillY} width="300" height="400" />
        </clipPath>
      </defs>

      <ellipse className="cr-glow" cx="100" cy="150" rx="150" ry="185" fill={`url(#${id('glow')})`} />
      <ellipse className="cr-floor" cx="100" cy="326" rx="78" ry="9" fill={`url(#${id('glow')})`} />
      <ellipse className="cr-ring" cx="100" cy="152" rx="96" ry="150" fill="none" stroke="#bfeaff" strokeWidth="1" />

      <g className="cr-glass">
        {FACES.map((f, i) => (
          <polygon key={f.id} points={pts(...f.keys)} fill="#cfe6ff" fillOpacity={0.025 + (i % 3) * 0.02} />
        ))}
      </g>

      <g className="cr-lit" clipPath={`url(#${id('fill')})`}>
        {FACES.map((f) => (
          <polygon key={f.id} points={pts(...f.keys)} fill={`url(#${id(f.id)})`} />
        ))}
        <ellipse className="cr-core" cx="104" cy="168" rx="26" ry="78" fill={`url(#${id('core')})`} />
      </g>

      <g className="cr-amber">
        <polygon points={pts('UM', 'UR', 'LR', 'LM')} fill={`url(#${id('amber')})`} />
        <polyline points="146,102 151,128 143,146 154,170 146,194 150,214" fill="none" stroke="#fff3df" strokeWidth="1.4" strokeLinejoin="round" />
      </g>

      <g clipPath={`url(#${id('shape')})`}>
        <rect className="cr-sweep" x="-60" y="-40" width="70" height="380" fill={`url(#${id('sweep')})`} transform="skewX(-18)" />
        <rect className="cr-band" x="0" y="-60" width="200" height="60" fill={`url(#${id('scan')})`} />
        {mode === 'fill' && fill < 1 && <line x1="0" x2="200" y1={fillY} y2={fillY} stroke="#e6f8ff" strokeWidth="1.5" opacity="0.9" />}
      </g>

      <g className="cr-edges" fill="none" strokeLinejoin="round">
        <polygon points={OUTLINE} pathLength={100} />
        {EDGES.map(([a, b]) => (
          <line key={a + b} x1={P[a][0]} y1={P[a][1]} x2={P[b][0]} y2={P[b][1]} pathLength={100} />
        ))}
      </g>

      <g className="cr-shards">
        <polygon points="-18,132 -10,116 -2,132 -10,150" />
        <polygon points="200,58 206,46 212,58 206,72" />
        <polygon points="190,250 194,242 198,250 194,259" />
      </g>
    </svg>
  )
}
