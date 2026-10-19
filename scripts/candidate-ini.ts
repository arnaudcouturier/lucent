// Builds a candidate's OptiScaler.ini: the fork's packaged ini (every value `auto`) with the maintainer's saved values
// carried over, then fixed overrides such as the menu theme on top. Pure text in, text out. The saved ini is how the defaults
// should read, so a key it leaves at `auto` goes back to `auto` even where the fork's template pins a value.
export interface IniOverride { section: string; key: string; value: string }
export interface IniChange { section: string; key: string; from: string; to: string }
export interface IniKey { section: string; key: string }
export interface IniMerge {
  text: string
  /** Saved values written over the fork's, including keys the saved ini leaves at `auto` where the template pins a value. */
  carried: IniChange[]
  /** Saved values left out on purpose, because the install or Lucent decides them. */
  skipped: { section: string; key: string; value: string }[]
  /** Overrides applied last. */
  overridden: IniChange[]
  /** Saved non-default values whose key does not exist in the fork's ini: they disappear silently. */
  lost: { section: string; key: string; value: string }[]
}

const keyOf = (section: string, key: string) => `${section.toLowerCase()}|${key.toLowerCase()}`
const NO_VALUE = new Set(['auto', ''])
const EMPTY = ''

interface Entry { section: string; key: string; value: string }

function entries(text: string): Entry[] {
  const found: Entry[] = []
  let section = ''
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (header) { section = header[1]; continue }
    if (/^\s*[;#]/.test(line)) continue
    const at = line.indexOf('=')
    if (at > 0) found.push({ section, key: line.slice(0, at).trim(), value: line.slice(at + 1).trim() })
  }
  return found
}

/** Replaces `Key=value` lines in place, keeping the fork's own layout (`Key=value`, no spaces) and line endings. */
function rewrite(text: string, change: (section: string, key: string, value: string) => string | undefined): string {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  let section = ''
  return text.split(/\r?\n/).map((line) => {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (header) { section = header[1]; return line }
    if (/^\s*[;#]/.test(line)) return line
    const at = line.indexOf('=')
    if (at <= 0) return line
    const key = line.slice(0, at).trim()
    const next = change(section, key, line.slice(at + 1).trim())
    return next === undefined ? line : `${key}=${next}`
  }).join(newline)
}

/** `saved` is the maintainer's own ini; a key in `skip` keeps the fork's value whatever `saved` holds. */
export function mergeIni(fork: string, saved: string, overrides: IniOverride[], skip: IniKey[] = []): IniMerge {
  const old = new Map(entries(saved).map((e) => [keyOf(e.section, e.key), e]))
  const present = new Set(entries(fork).map((e) => keyOf(e.section, e.key)))
  const skipped = new Set(skip.map((s) => keyOf(s.section, s.key)))
  const carried: IniChange[] = []
  const left: IniMerge['skipped'] = []
  let text = rewrite(fork, (section, key, value) => {
    const before = old.get(keyOf(section, key))
    if (!before || before.value === EMPTY || before.value === value) return undefined
    if (skipped.has(keyOf(section, key))) { if (before.value !== 'auto') left.push({ section, key, value: before.value }); return undefined }
    carried.push({ section, key, from: value, to: before.value })
    return before.value
  })
  const wanted = new Map(overrides.map((o) => [keyOf(o.section, o.key), o]))
  for (const o of overrides) {
    if (!present.has(keyOf(o.section, o.key))) throw new Error(`The fork's ini has no [${o.section}] ${o.key}.`)
  }
  const overridden: IniChange[] = []
  text = rewrite(text, (section, key, value) => {
    const override = wanted.get(keyOf(section, key))
    if (!override) return undefined
    overridden.push({ section, key, from: value, to: override.value })
    return override.value
  })
  const lost = entries(saved).filter((e) => !NO_VALUE.has(e.value) && !present.has(keyOf(e.section, e.key)))
    .map(({ section, key, value }) => ({ section, key, value }))
  return { text, carried, skipped: left, overridden, lost }
}
