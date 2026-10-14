import { describe, expect, it } from 'vitest'
import { framePacer } from './pacing'

/** Display frame timestamps as Chromium reports them: vsync-aligned, jittered and coarsened to 0.1 ms. */
function displayFrames(hz: number, seconds: number, seed = 1) {
  let random = seed
  const jitter = () => { random = (random * 16807) % 2147483647; return (random / 2147483647 - 0.5) * 0.3 }
  return Array.from({ length: Math.round(hz * seconds) }, (_, i) => Math.round((1000 + i * 1000 / hz + jitter()) * 10) / 10)
}

/** The motion steps, in milliseconds, that a pacer paints for these frames. */
function steps(frames: number[], pace: (now: number) => number | null) {
  return frames.map(pace).filter((s): s is number => s !== null).map((s) => s * 1000)
}

/** Crystal.tsx before the fix: paint once 1000/30 ms have passed since the last paint. */
function thresholdPacer() {
  let last = 1000
  return (now: number) => {
    if (now - last < 1000 / 30) return null
    const seconds = (now - last) / 1000
    last = now
    return seconds
  }
}

describe('Crystal frame pacing', () => {
  it('reproduces the old jump: a 30 fps time threshold alternates 33 and 50 ms steps at 60 Hz', () => {
    const old = steps(displayFrames(60, 20), thresholdPacer())
    expect(old.filter((s) => s > 45).length).toBeGreaterThan(10)
  })

  it.each([60, 59.94, 120, 144, 165, 240])('paints every step the same length at %s Hz', (hz) => {
    const pacer = framePacer(30)
    pacer.reset(1000)
    const painted = steps(displayFrames(hz, 20), pacer.frame).slice(30)
    const median = [...painted].sort((a, b) => a - b)[painted.length >> 1]
    expect(painted.every((s) => Math.abs(s - median) < 1)).toBe(true)
    // Close to 30 per second, never above.
    expect(1000 / median).toBeGreaterThan(26)
    expect(1000 / median).toBeLessThanOrEqual(30.1)
  })

  it('paints at least 60 per second while working', () => {
    const pacer = framePacer(120)
    pacer.reset(1000)
    const painted = steps(displayFrames(144, 5), pacer.frame).slice(30)
    expect(1000 / painted[painted.length >> 1]).toBeGreaterThan(55)
  })

  it('resumes after a hitch instead of leaping ahead by the time lost', () => {
    const pacer = framePacer(30)
    pacer.reset(1000)
    const frames = displayFrames(60, 5)
    for (const now of frames) pacer.frame(now)
    const last = frames.at(-1)!
    // A 400 ms stall: the next paints advance at most one and a half ordinary steps.
    const after = steps([last + 400, last + 416.7, last + 433.3, last + 450], pacer.frame)
    expect(Math.max(...after)).toBeLessThan(51)
  })

  it('never plays a pause back as motion', () => {
    const pacer = framePacer(30)
    pacer.reset(1000)
    for (const now of displayFrames(60, 2)) pacer.frame(now)
    pacer.reset(60_000)
    const after = steps([59_990, 60_006.7, 60_023.3, 60_040], pacer.frame)
    expect(Math.max(...after)).toBeLessThan(51)
  })
})
