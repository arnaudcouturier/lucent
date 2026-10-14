import type { HdrMode, HdrOption } from '../shared/manifest'
import { readIni } from './ini'

/** On-disk keys win. Multiple matches are ambiguous and therefore Custom. */
export function matchHdrMode(options: HdrOption[] | undefined, diskText: string): HdrMode | null {
  if (!options?.length) return null
  const ini = readIni(diskText)
  const matches = options.filter((option) => option.settings.every((setting) =>
    ini.get(setting.section, setting.key) === setting.value))
  return matches.length === 1 ? matches[0].id : null
}

const AUTO_HDR_KEY = 'AutoHDREnable'
const DISABLED_AUTO_HDR = '2096'
const tokenPattern = /^(\s*AutoHDREnable\s*=\s*)(.*?)(\s*)$/i

function autoHdrParts(value: string | null): { parts: string[]; index: number | null } {
  const parts = (value ?? '').split(';')
  const indexes = parts.flatMap((part, index) => tokenPattern.test(part) ? [index] : [])
  if (indexes.length > 1) throw new Error(`The per-game Auto HDR registry value has duplicate ${AUTO_HDR_KEY} tokens.`)
  return { parts, index: indexes[0] ?? null }
}

function tokenValue(part: string | null | undefined): string | null {
  if (part == null) return null
  return tokenPattern.exec(part)?.[2]?.trim() ?? null
}

export function autoHdrTokenValue(value: string | null): string | null {
  const { parts, index } = autoHdrParts(value)
  return index === null ? null : tokenValue(parts[index])
}

/** Replaces only Windows' AutoHDREnable token; all other tokens and separators stay byte-for-byte intact. */
export function disableAutoHdr(value: string | null): string {
  const { parts, index } = autoHdrParts(value)
  if (index !== null) {
    parts[index] = parts[index].replace(tokenPattern, `$1${DISABLED_AUTO_HDR}$3`)
    return parts.join(';')
  }
  const original = value ?? ''
  return `${original}${original && !original.endsWith(';') ? ';' : ''}${AUTO_HDR_KEY}=${DISABLED_AUTO_HDR};`
}

/** Restores Lucent's token while keeping external edits to other per-game preferences. */
export function restoreAutoHdr(current: string | null, before: string | null, after: string | null): string | null {
  if (current === after) return before
  const currentParts = autoHdrParts(current)
  const currentToken = currentParts.index === null ? null : currentParts.parts[currentParts.index]
  const expectedToken = autoHdrParts(after)
  const expectedValue = expectedToken.index === null ? null : tokenValue(expectedToken.parts[expectedToken.index])
  const currentValue = currentParts.index === null ? null : tokenValue(currentToken)
  if (currentValue !== expectedValue) return current

  const beforeParts = autoHdrParts(before)
  const priorToken = beforeParts.index === null ? null : beforeParts.parts[beforeParts.index]
  if (priorToken === null) {
    if (currentParts.index === null) return current
    currentParts.parts.splice(currentParts.index, 1)
    const restored = currentParts.parts.join(';')
    return restored === '' && before === null ? null : restored
  }
  if (currentParts.index === null) {
    const original = current ?? ''
    return `${original}${original && !original.endsWith(';') ? ';' : ''}${priorToken};`
  }
  currentParts.parts[currentParts.index] = priorToken
  return currentParts.parts.join(';')
}
