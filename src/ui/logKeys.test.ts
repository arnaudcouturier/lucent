import { describe, expect, it } from 'vitest'
import type { LogLine } from '../core/log'
import { keyLines } from './logKeys'

const line = (text: string, time: string | null = '19:14:05'): LogLine => ({ date: time ? '2026-10-13' : null, time, level: 'info', text })
const ids = (lines: { id: number }[]) => lines.map((l) => l.id)
/** A full tail: `size` distinct lines starting at line `from`. */
const tail = (from: number, size: number) => Array.from({ length: size }, (_, i) => line(`wrote file ${from + i}`, `19:14:${String((from + i) % 60).padStart(2, '0')}`))

describe('keyLines', () => {
  it('gives the first read unique keys', () => {
    const keyed = keyLines(undefined, tail(0, 5))
    expect(new Set(ids(keyed)).size).toBe(5)
    expect(keyed.map((l) => l.text)).toEqual(tail(0, 5).map((l) => l.text))
  })

  it('keeps every key when lines are appended', () => {
    const first = keyLines(null, tail(0, 5))
    const second = keyLines(first, tail(0, 8))
    expect(ids(second).slice(0, 5)).toEqual(ids(first))
    expect(new Set(ids(second)).size).toBe(8)
  })

  it('keeps the other lines keyed as they were once the 500-line tail is full and slides by one', () => {
    const full = keyLines(null, tail(0, 500))
    const slid = keyLines(full, tail(1, 500))
    expect(ids(slid).slice(0, 499)).toEqual(ids(full).slice(1))
    expect(new Set(ids(slid)).size).toBe(500)
  })

  it('keeps them when a flood slides the tail by many lines at once', () => {
    const full = keyLines(null, tail(0, 500))
    const slid = keyLines(full, tail(120, 500))
    expect(ids(slid).slice(0, 380)).toEqual(ids(full).slice(120))
    expect(new Set(ids(slid)).size).toBe(500)
  })

  it('tells identical lines apart, and keeps them apart as the tail slides', () => {
    const repeated = [line('Config OptiScaler.ini'), line('Config OptiScaler.ini'), line('Config OptiScaler.ini'), line('Done')]
    const first = keyLines(null, repeated)
    expect(new Set(ids(first)).size).toBe(4)
    const slid = keyLines(first, [...repeated.slice(1), line('Next')])
    expect(ids(slid).slice(0, 3)).toEqual(ids(first).slice(1))
    expect(new Set(ids(slid)).size).toBe(4)
  })

  it('keys a tool log, whose lines carry no time, by what they say', () => {
    const first = keyLines(null, [line('a', null), line('b', null), line('b', null)])
    const slid = keyLines(first, [line('b', null), line('b', null), line('c', null)])
    expect(ids(slid).slice(0, 2)).toEqual(ids(first).slice(1))
  })

  it('never reuses a key when the log is replaced or cut back', () => {
    const first = keyLines(null, tail(0, 5))
    const replaced = keyLines(first, tail(100, 5))
    expect(replaced.map((l) => l.id).filter((id) => ids(first).includes(id))).toEqual([])
    const next = keyLines(replaced, tail(100, 8))
    expect(ids(next).slice(0, 5)).toEqual(ids(replaced))
  })

  it('handles an empty tail', () => {
    expect(keyLines(keyLines(null, tail(0, 3)), [])).toEqual([])
    expect(ids(keyLines([], tail(0, 2)))).toHaveLength(2)
  })
})
