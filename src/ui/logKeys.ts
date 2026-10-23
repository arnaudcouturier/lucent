import type { LogLine } from '../core/log'

/** A log line with a key that stays with it while the tail slides past it. */
export type KeyedLine = LogLine & { id: number }

const same = (a: LogLine, b: LogLine) => a.date === b.date && a.time === b.time && a.text === b.text

/** Keys a fresh read of the tail. The tail slides once it is full (500 lines), so a line keeps the key it had when it
    is still there: the first node goes, the rest keep their identity, and scroll anchoring holds a reader's place.
    A line's own text can repeat, so the old tail is matched as a whole against the start of the new one. */
export function keyLines(previous: readonly KeyedLine[] | null | undefined, next: readonly LogLine[]): KeyedLine[] {
  const old = previous ?? []
  // How many old lines the tail slid past; none of them match when the log was replaced or cut back.
  let slid = 0
  while (slid < old.length) {
    const overlap = Math.min(old.length - slid, next.length)
    if (old.slice(slid, slid + overlap).every((line, i) => same(line, next[i]))) break
    slid++
  }
  const kept = Math.min(old.length - slid, next.length)
  let id = (old.at(-1)?.id ?? -1) + 1
  return next.map((line, i) => ({ ...line, id: i < kept ? old[slid + i].id : id++ }))
}
