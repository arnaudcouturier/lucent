import type { HdrMode, HdrOption } from '../shared/manifest'
import { readIni } from './ini'
import { sameIniValue } from './profileValues'

/** On-disk keys win. Multiple matches are ambiguous and therefore Custom. */
export type HdrValueReader = (file: string, section: string, key: string) => string | undefined

export function matchHdrMode(options: HdrOption[] | undefined, diskText: string): HdrMode | null
export function matchHdrMode(options: HdrOption[] | undefined, readValue: HdrValueReader): HdrMode | null
export function matchHdrMode(options: HdrOption[] | undefined, diskTextOrReader: string | HdrValueReader): HdrMode | null {
  if (!options?.length) return null
  const ini = typeof diskTextOrReader === 'string' ? readIni(diskTextOrReader) : null
  const readValue = typeof diskTextOrReader === 'string'
    ? (_file: string, section: string, key: string) => ini!.get(section, key)
    : diskTextOrReader
  const matches = options.filter((option) => option.settings.every((setting) => {
    const value = readValue(setting.file, setting.section, setting.key)
    return value !== undefined && sameIniValue(value, setting.value)
  }))
  return matches.length === 1 ? matches[0].id : null
}

const AUTO_HDR_KEY = 'AutoHDREnable'
const DISABLED_AUTO_HDR = '2096'
const tokenPattern = /^(\s*AutoHDREnable\s*=\s*)(.*?)(\s*)$/i
const MAX_DWORD = 0xffff_ffff

function numericTokenValue(value: string | null): number | null {
  if (value === null) return null
  if (!/^\d+$/.test(value)) throw new Error('The per-game Auto HDR preference is not a valid DWORD.')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > MAX_DWORD) throw new Error('The per-game Auto HDR preference is outside the DWORD range.')
  return parsed
}

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

/** Validates that a journal entry changes only this executable's AutoHDREnable token. */
export function isAutoHdrOnlyChange(before: string | null, after: string | null): boolean {
  if (before === after) return false
  const previous = autoHdrParts(before)
  const next = autoHdrParts(after)
  const previousToken = previous.index === null ? null : tokenValue(previous.parts[previous.index])
  const nextToken = next.index === null ? null : tokenValue(next.parts[next.index])
  numericTokenValue(previousToken)
  numericTokenValue(nextToken)
  if (previousToken === nextToken) return false
  const otherTokens = ({ parts, index }: { parts: string[]; index: number | null }) => {
    const tokens = parts.filter((_, i) => i !== index)
    while (tokens.at(-1) === '') tokens.pop()
    return tokens
  }
  return JSON.stringify(otherTokens(previous)) === JSON.stringify(otherTokens(next))
}
export function disableAutoHdr(value: string | null): string {
  const { parts, index } = autoHdrParts(value)
  if (index !== null) {
    const match = tokenPattern.exec(parts[index])!
    const parsed = numericTokenValue(match[2].trim())!
    if (parsed % 2 === 0) return value ?? ''
    const disabled = parsed - 1
    parts[index] = `${match[1]}${disabled}${match[3]}`
    return parts.join(';')
  }
  const original = value ?? ''
  return `${original}${original && !original.endsWith(';') ? ';' : ''}${AUTO_HDR_KEY}=${DISABLED_AUTO_HDR};`
}

/** True only when the journal's captured transition cleared an enabled bit owned by Lucent. */
export function autoHdrDisableWasApplied(before: string | null, after: string | null): boolean {
  if (!isAutoHdrOnlyChange(before, after)) return false
  const previous = autoHdrParts(before)
  const next = autoHdrParts(after)
  const previousToken = previous.index === null ? null : numericTokenValue(tokenValue(previous.parts[previous.index]))
  const nextToken = next.index === null ? null : numericTokenValue(tokenValue(next.parts[next.index]))
  return nextToken !== null && nextToken % 2 === 0
    && (previousToken === null ? nextToken === Number(DISABLED_AUTO_HDR) : previousToken % 2 === 1 && previousToken - 1 === nextToken)
}

/** Returns the latest non-undone transition's ownership state. A later Off transition relinquishes older intent. */
export function latestAutoHdrDisableIndex(transitions: readonly { before: string | null; after: string | null; undone?: boolean }[]): number | null {
  for (let index = transitions.length - 1; index >= 0; index--) {
    const transition = transitions[index]
    if (transition.undone) continue
    return autoHdrDisableWasApplied(transition.before, transition.after) ? index : null
  }
  return null
}

/** Restores Lucent's token while keeping external edits to other per-game preferences. */
export function restoreAutoHdr(current: string | null, before: string | null, after: string | null): string | null {
  if (!isAutoHdrOnlyChange(before, after)) throw new Error('The per-game Auto HDR journal entry is invalid.')
  if (current === after) return before
  const currentParts = autoHdrParts(current)
  const currentToken = currentParts.index === null ? null : currentParts.parts[currentParts.index]
  const expectedToken = autoHdrParts(after)
  const expectedValue = expectedToken.index === null ? null : tokenValue(expectedToken.parts[expectedToken.index])
  const currentValue = currentParts.index === null ? null : tokenValue(currentToken)
  if (currentValue !== expectedValue) return current

  // This intent only authorizes a token that was captured as a valid DWORD. Do not interpret
  // malformed registry data as an Auto HDR switch or overwrite it during recovery.
  numericTokenValue(expectedValue)

  const beforeParts = autoHdrParts(before)
  const priorToken = beforeParts.index === null ? null : beforeParts.parts[beforeParts.index]
  if (priorToken !== null) numericTokenValue(tokenValue(priorToken))
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
