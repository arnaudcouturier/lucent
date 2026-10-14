import { useEffect, useRef } from 'react'
import type { CrystalMode, CrystalState } from '../../core/crystal'
import { inTauri, observeWindowFocus } from '../shell'
import { HEIGHT, WIDTH, advanceMotion, drawCrystal, initialMotion } from './render'
import { framePacer } from './pacing'

const LABELS: Record<CrystalMode, string> = {
  scan: 'Scanning', glass: 'Ready for setup', fill: 'Deploying', lit: 'Healthy',
  update: 'Update available', busy: 'Working', drift: 'Needs repair', disabled: 'Disabled',
}

/**
 * Paints per second. At rest the game may be running beside Lucent, so the crystal stays at 30; filling and
 * repair/update/rollback can't run while XIV does, so they paint at up to 120.
 */
const restingRate = 30
const workingRate = 120

export function Crystal({ state }: { state: CrystalState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const motion = useRef(initialMotion())
  // The fill target changes with every progress report; the loop reads it here instead of restarting.
  const target = useRef(state)
  target.current = state
  const repaint = useRef<() => void>(() => {})

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
    const stillPreview = import.meta.env.DEV && new URLSearchParams(location.search).has('crystal-still')
    const reduced = () => reducedMotion.matches || stillPreview
    const measure = import.meta.env.DEV && new URLSearchParams(location.search).has('crystal-perf')
    const costs: number[] = []
    let paints = 0, raf = 0
    const pacer = framePacer(state.mode === 'fill' || state.mode === 'busy' ? workingRate : restingRate)
    let nativeFocused = !inTauri
    if (state.mode !== 'drift') motion.current.fall = 0

    const paint = () => {
      const start = measure ? performance.now() : 0
      // Reduced motion still presents the fallen shard, a visible, stationary scan line and the current fill.
      const pose = reduced()
        ? { ...motion.current, fall: state.mode === 'drift' ? 1 : 0, effects: state.mode === 'scan' ? 0.85 : motion.current.effects, fill: target.current.fill }
        : motion.current
      drawCrystal(ctx, target.current, pose)
      if (measure) {
        costs.push(performance.now() - start)
        if (costs.length > 60) costs.shift()
        paints++
        if (paints === 1 || paints % 60 === 0) {
          const sorted = [...costs].sort((a, b) => a - b)
          canvas.dispatchEvent(new CustomEvent('crystal-performance', { bubbles: true, detail: {
            frames: paints, mean: costs.reduce((sum, cost) => sum + cost, 0) / costs.length,
            p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
          } }))
        }
      }
    }
    const resize = () => {
      // No oversized backing store on high DPI monitors; at most 496×428 pixels.
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(WIDTH * ratio)
      canvas.height = Math.round(HEIGHT * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const seconds = pacer.frame(now)
      if (seconds === null) return
      advanceMotion(motion.current, seconds, target.current)
      paint()
    }
    const reconcile = () => {
      cancelAnimationFrame(raf)
      raf = 0
      const visible = !document.hidden && (inTauri ? nativeFocused : document.hasFocus())
      canvas.dataset.motion = !visible ? 'paused' : reduced() ? 'reduced' : state.mode === 'disabled' ? 'disabled' : 'running'
      if (!visible) return
      paint()
      if (!reduced() && state.mode !== 'disabled') {
        pacer.reset(performance.now())
        raf = requestAnimationFrame(tick)
      }
    }
    // Without a running loop, a new fill still needs a paint.
    repaint.current = () => {
      if (canvas.dataset.motion === 'running') return
      motion.current.fill = target.current.mode === 'fill' ? target.current.fill : 0
      paint()
    }
    // Resizing clears the canvas, so it paints again even while paused.
    const onResize = () => { resize(); paint(); reconcile() }
    resize()
    reconcile()
    // First mount paints even in an unfocused window so the rail never starts empty.
    if (canvas.dataset.motion === 'paused') paint()
    const stopFocus = observeWindowFocus((focused) => { nativeFocused = focused; reconcile() })
    document.addEventListener('visibilitychange', reconcile)
    window.addEventListener('focus', reconcile)
    window.addEventListener('blur', reconcile)
    window.addEventListener('resize', onResize)
    reducedMotion.addEventListener('change', reconcile)
    return () => {
      cancelAnimationFrame(raf)
      repaint.current = () => {}
      stopFocus()
      document.removeEventListener('visibilitychange', reconcile)
      window.removeEventListener('focus', reconcile)
      window.removeEventListener('blur', reconcile)
      window.removeEventListener('resize', onResize)
      reducedMotion.removeEventListener('change', reconcile)
    }
  }, [state.mode])

  useEffect(() => repaint.current(), [state.fill])

  const label = state.mode === 'fill' ? `Deploying ${Math.round(state.fill * 100)}%` : LABELS[state.mode]
  return <canvas ref={canvasRef} className="crystal" width={WIDTH} height={HEIGHT} role="img" aria-label={`Lucent crystal: ${label}`} />
}
