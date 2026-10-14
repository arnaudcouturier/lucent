// The app's crystal in the hero's window, drawn by the same renderer as the app's rail. It paints at most 30 times
// a second, only while it's on screen and the tab is visible, and holds still for reduced motion.
import type { CrystalState } from '../src/core/crystal.ts'
import { framePacer } from '../src/ui/crystal/pacing.ts'
import { HEIGHT, WIDTH, advanceMotion, drawCrystal, initialMotion } from '../src/ui/crystal/render.ts'

const canvas = document.querySelector<HTMLCanvasElement>('canvas.mock-crystal')
const ctx = canvas?.getContext('2d')

if (canvas && ctx) {
  const state: CrystalState = { mode: 'lit', fill: 0 }
  const motion = initialMotion()
  const pacer = framePacer(30)
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  let raf = 0
  let onScreen = false

  const paint = () => drawCrystal(ctx, state, motion)
  const resize = () => {
    const ratio = Math.min(2, window.devicePixelRatio || 1) * Math.max(1, canvas.clientWidth) / WIDTH
    canvas.width = Math.round(WIDTH * ratio)
    canvas.height = Math.round(HEIGHT * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    paint()
  }
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick)
    const seconds = pacer.frame(now)
    if (seconds === null) return
    advanceMotion(motion, seconds, state)
    paint()
  }
  const reconcile = () => {
    cancelAnimationFrame(raf)
    raf = 0
    if (!onScreen || document.hidden || reducedMotion.matches) return
    pacer.reset(performance.now())
    raf = requestAnimationFrame(tick)
  }

  new ResizeObserver(resize).observe(canvas)
  new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; reconcile() }).observe(canvas)
  document.addEventListener('visibilitychange', reconcile)
  reducedMotion.addEventListener('change', reconcile)
  canvas.hidden = false
  canvas.previousElementSibling?.remove()
}
