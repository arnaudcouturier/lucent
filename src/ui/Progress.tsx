// Progress that glides. Reports reach the UI at most ten times a second (see `pacedProgress`), so a bar or a figure
// that jumped to each one would step; these ease toward the latest value instead, writing to the DOM every frame
// without rendering React again.
import { useEffect, useLayoutEffect, useRef } from 'react'

/** How long the displayed value takes to cover most of the way to a new report. */
const EASE_SECONDS = 0.35

/** Calls `apply` with a value that eases toward `target`. A lower target (a new phase starting) is shown at once. */
export function useEased(target: number, apply: (value: number) => void, seconds = EASE_SECONDS) {
  const eased = useRef({ value: target, target, raf: 0, last: 0 })
  const applyRef = useRef(apply)
  applyRef.current = apply
  useLayoutEffect(() => applyRef.current(eased.current.value), [])
  useEffect(() => {
    const e = eased.current
    e.target = target
    if (target <= e.value || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      cancelAnimationFrame(e.raf)
      e.raf = 0
      e.value = target
      applyRef.current(target)
      return
    }
    if (e.raf) return
    e.last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, now - e.last) / 1000)
      e.last = now
      e.value += (e.target - e.value) * (1 - Math.exp(-dt / seconds))
      if (Math.abs(e.target - e.value) < 1e-4 * Math.max(1, Math.abs(e.target))) e.value = e.target
      applyRef.current(e.value)
      e.raf = e.value === e.target ? 0 : requestAnimationFrame(step)
    }
    e.raf = requestAnimationFrame(step)
  }, [target, seconds])
  useEffect(() => () => {
    cancelAnimationFrame(eased.current.raf)
    eased.current.raf = 0
  }, [])
}

/** A thin bar for a value from 0 to 1, with a soft sheen while it moves. */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  const fill = useRef<HTMLDivElement>(null)
  const clamped = Math.min(1, Math.max(0, value))
  useEased(clamped, (v) => { if (fill.current) fill.current.style.transform = `translateX(${(v - 1) * 100}%)` })
  return <div className={`progress-track${clamped >= 1 ? ' is-complete' : ''}`} role="progressbar" aria-label={label}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped * 100)}>
    <div className="progress-fill" ref={fill} />
  </div>
}

/** A number that counts toward `value` rather than jumping, formatted on every frame. */
export function EasedNumber({ value, format, className }: { value: number; format: (value: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEased(value, (v) => { if (ref.current) ref.current.textContent = format(v) })
  // No text children: React would write the latest value over the eased one on every render.
  return <span ref={ref} className={className} aria-hidden />
}

export function percentLabel(value: number) {
  return `${Math.floor(Math.min(1, Math.max(0, value)) * 100 + 1e-6)}%`
}
