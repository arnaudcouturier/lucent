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
    toString: () => bom + lines.map((line) => line.text + line.ending).join(''),
  }
}

/** A path as an INI value compares: slashes either way, case and a leading `.\` ignored. */
const samePath = (a: string, b: string) => {
  const plain = (value: string) => value.trim().replace(/\//g, '\\').replace(/^\.\\/, '').toLowerCase()
  return plain(a) === plain(b)
}

/**
 * A content version's `setKeys` for a config the player has: each key is set to the content's value, or, with `ifPath`,
 * only when its current value is that path. Every other key, the layout and the comments stay as the disk has them.
 */
export function setConfigKeys(diskText: string, settings: { section: string; key: string; value: string; ifPath?: string }[]): { text: string; changed: string[] } {
  const disk = readIni(diskText)
  const changed: string[] = []
  for (const { section, key, value, ifPath } of settings) {
    const current = disk.get(section, key)
    if (ifPath !== undefined && (current === undefined || !samePath(current, ifPath))) continue
    if (current === value) continue
    disk.set(section, key, value)
    changed.push(`${section}/${key}`)
  }
  return { text: changed.length ? disk.toString() : diskText, changed }
}

/**
 * The config update rule `addMissingKeys`: every key of the baseline that the disk text lacks is written with the
 * baseline's value, and every other key, the layout and the comments stay as the disk has them.
 */
export function addMissingKeys(diskText: string, baselineText: string): { text: string; added: string[] } {
  const disk = readIni(diskText)
  const added: string[] = []
  for (const { section, key, value } of readIni(baselineText).entries()) {
    if (disk.get(section, key) !== undefined) continue
    disk.set(section, key, value)
    added.push(`${section}/${key}`)
  }
  return { text: added.length ? disk.toString() : diskText, added }
}
