/**
 * Decides which display frames the crystal paints, and how far its motion advances on each.
 *
 * Paints are counted in display frames rather than timed. A time threshold such as "33.3 ms since the last paint"
 * lands on a whole number of frames at 60, 120 and 240 Hz, so timestamp jitter decides each time whether the paint
 * waits one frame longer: steps of 33 and 50 ms alternate in runs that drift with the display clock, and each long
 * step reads as the crystal jumping.
 */
export function framePacer(rate: number) {
  let frameMs = 1000 / 60, samples = 0, divisor = Math.max(1, Math.round(60 / rate)), waited = 0, lastFrame = 0, lastPaint = 0
  return {
    /** Starts counting again after a pause; the paused time is never played back as motion. */
    reset(now: number) {
      lastFrame = lastPaint = now
      waited = 0
    },
    /** The seconds of motion to paint at this display frame, or null when the frame is skipped. */
    frame(now: number): number | null {
      const delta = now - lastFrame
      lastFrame = now
      // Learn the display's frame time from ordinary frames; a stall says nothing about it.
      if (delta > 2 && delta < 60) {
        frameMs += (delta - frameMs) * (samples < 20 ? 0.3 : 0.03)
        samples++
        // Rounded toward fewer paints, so the rate is a ceiling. Once the frame time is learned, a margin past each
        // rounding edge keeps jitter from flipping the divisor of a display that sits near one (63 Hz, 100 Hz).
        const ideal = 1000 / rate / frameMs
        if (samples <= 20 || ideal > divisor + 0.3 || ideal <= divisor - 1.1) divisor = Math.max(1, Math.ceil(ideal - 0.1))
      }
      if (++waited < divisor) return null
      waited = 0
      // After a hitch the crystal resumes from where it was rather than leaping ahead by the time it lost.
      const elapsed = Math.min(Math.max(now - lastPaint, 0), divisor * frameMs * 1.5)
      lastPaint = now
      return elapsed / 1000
    },
  }
}
