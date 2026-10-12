interface Line { text: string; ending: string }
const normalizedName = (value: string) => value.trim().toLowerCase()

/** Neither ReShade nor OptiScaler (SimpleIni) has inline comments: everything after `=` is the value. */
function parseSetting(text: string) {
  const match = /^(\s*([^;#=\s][^=]*?)\s*=\s*)(.*?)(\s*)$/.exec(text)
  return match && { key: normalizedName(match[2]), rawKey: match[2].trim(), prefix: match[1], value: match[3], suffix: match[4] }
}

const keyId = (section: string, key: string) => `${normalizedName(section)}\0${normalizedName(key)}`

/** Keeps the original lines, BOM and endings rather than serializing a map of settings. */
export function readIni(text: string) {
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : ''
  const lines: Line[] = (text.slice(bom.length).match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? [])
    .filter(Boolean).map((line) => {
      const ending = /(?:\r\n|\r|\n)$/.exec(line)?.[0] ?? ''
      return { text: line.slice(0, line.length - ending.length), ending }
    })
  const newline = lines.find((line) => line.ending)?.ending ?? '\n'
  const finalNewline = /[\r\n]$/.test(text)
  const insert = (index: number, text: string) => {
    if (index > 0 && !lines[index - 1].ending) lines[index - 1].ending = newline
    lines.splice(index, 0, { text, ending: index < lines.length || finalNewline ? newline : '' })
  }
  const matches = (section: string, key: string) => {
    let current = ''
    const result: { line: Line; parsed: NonNullable<ReturnType<typeof parseSetting>> }[] = []
    for (const line of lines) {
      const heading = /^\s*\[([^\]]+)\]/.exec(line.text)
      if (heading) { current = normalizedName(heading[1]); continue }
      const parsed = parseSetting(line.text)
      if (current === normalizedName(section) && parsed?.key === normalizedName(key)) result.push({ line, parsed })
    }
    return result
  }
  return {
    get(section: string, key: string): string | undefined { return matches(section, key).at(-1)?.parsed.value },
    /** One entry per distinct (section, key), in first-appearance order; the value is the last occurrence's. */
    entries(): { section: string; key: string; value: string }[] {
      let section = ''
      const byId = new Map<string, { section: string; key: string; value: string }>()
      for (const line of lines) {
        const heading = /^\s*\[([^\]]+)\]/.exec(line.text)
        if (heading) { section = heading[1].trim(); continue }
        const parsed = parseSetting(line.text)
        if (!parsed) continue
        byId.set(keyId(section, parsed.rawKey), { section, key: parsed.rawKey, value: parsed.value })
      }
      return [...byId.values()]
    },
    set(section: string, key: string, value: string) {
      if (/[\[\]\r\n\0]/.test(section) || section !== section.trim() || !key.trim() || key !== key.trim() || /[=;#\[\]\r\n\0]/.test(key) || /[\r\n\0]/.test(value)) throw new Error('Invalid INI setting.')
      const found = matches(section, key)
      for (const { line, parsed } of found) {
        if (parsed.value !== value) line.text = parsed.prefix + value + parsed.suffix
      }
      if (found.length) return
      let start = -1
      let end = lines.length
      for (let i = 0; i < lines.length; i++) {
        const heading = /^\s*\[([^\]]+)\]/.exec(lines[i].text)
        if (!heading) continue
        if (normalizedName(heading[1]) === normalizedName(section)) { start = i; end = lines.length }
        else if (start >= 0 && end === lines.length) end = i
      }
      if (!section) {
        end = lines.findIndex((line) => /^\s*\[/.test(line.text))
        if (end < 0) end = lines.length
        while (end > 0 && !lines[end - 1].text.trim()) end--
      } else if (start < 0) {
        if (lines.length && lines.at(-1)!.text.trim()) insert(lines.length, '')
        insert(lines.length, `[${section}]`)
        end = lines.length
      } else {
        while (end > start + 1 && !lines[end - 1].text.trim()) end--
      }
      insert(end, `${key}=${value}`)
    },
    /** Removes every occurrence of a key, keeping the section heading and its other lines. */
    remove(section: string, key: string) {
      const found = new Set(matches(section, key).map(({ line }) => line))
      for (let i = lines.length - 1; i >= 0; i--) if (found.has(lines[i])) lines.splice(i, 1)
    },
    toString: () => bom + lines.map((line) => line.text + line.ending).join(''),
  }
}

/**
 * Three-way merge of an owned config, key by key. The base is Lucent's last-written copy, the
 * second side is what's on disk, and the third is what the new version ships. The result follows
 * the new version's layout and comments: keys it dropped are removed, and a key the player added
 * that Lucent never shipped is kept. A reset key always takes the new version's value.
 */
export function mergeIni(baseText: string, diskText: string, incomingText: string, resetKeys: readonly { section: string; key: string }[] = []): string {
  const base = readIni(baseText)
  const disk = readIni(diskText)
  const incoming = readIni(incomingText)
  const merged = readIni(incomingText)
  const reset = new Set(resetKeys.map((k) => keyId(k.section, k.key)))
  for (const { section, key } of incoming.entries()) {
    if (reset.has(keyId(section, key))) continue
    const baseValue = base.get(section, key)
    const diskValue = disk.get(section, key)
    const incomingValue = incoming.get(section, key)!
    if (baseValue === undefined) continue
    if (diskValue === undefined) {
      // The player deleted the key: it stays deleted unless Lucent changed it.
      if (incomingValue === baseValue) merged.remove(section, key)
      continue
    }
    if (diskValue !== baseValue && incomingValue === baseValue) merged.set(section, key, diskValue)
  }
  for (const { section, key, value } of disk.entries()) {
    if (reset.has(keyId(section, key))) continue
    if (base.get(section, key) === undefined && incoming.get(section, key) === undefined) merged.set(section, key, value)
  }
  return merged.toString()
}
