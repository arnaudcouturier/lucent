// Checks what a candidate's recipe writes into OptiScaler.ini against the fork's own settings schema, the
// `settings-schema.json` at the root of its release package: a retired or renamed key, a key the fork's ini no longer has
// and a value a key will not take are all refused. Also lists the keys the fork's ini gained and lost against a previous one.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SettingChoice } from '../src/shared/manifest'
import { entries } from './candidate-ini'

export interface ForkSchema { release: string; commit: string; keys: SchemaKey[]; retired: { key: string; note: string }[]; aliases: { key: string; canonical: string; note: string }[] }
export interface SchemaKey { key: string; section: string; name: string; type: 'bool' | 'int' | 'float' | 'enum' | 'string'; values: string[] | null; min: number | null; max: number | null; applies: 'live' | 'start' | 'restart' }
export interface IniWrite { source: string; section: string; key: string; value: string }
export interface SchemaCheck { checked: number; notInSchema: string[]; notLive: { key: string; applies: string; source: string }[]; errors: string[] }

const keyOf = (section: string, key: string) => `${section.toLowerCase()}|${key.toLowerCase()}`
const qualified = (section: string, key: string) => `[${section}] ${key}`

/** Reads a release package's schema, refusing anything this build does not know how to read. */
export function parseForkSchema(text: string): ForkSchema {
  const parsed = JSON.parse(text.replace(/^\uFEFF/, '')) as {
    format?: unknown
    version?: unknown
    release?: string
    generatedFrom?: { commit?: string }
    keys?: SchemaKey[]
    retired?: ForkSchema['retired']
    aliases?: ForkSchema['aliases']
  }
  if (parsed.format !== 'settings-schema-effective' || parsed.version !== 1) {
    throw new Error(`The fork's settings-schema.json is not the effective schema (format "${String(parsed.format)}", version ${String(parsed.version)}).`)
  }
  return {
    release: parsed.release ?? '',
    commit: parsed.generatedFrom?.commit ?? '',
    keys: (parsed.keys ?? []).map((key) => ({
      key: key.key, section: key.section, name: key.name, type: key.type,
      values: key.values ?? null, min: key.min ?? null, max: key.max ?? null, applies: key.applies,
    })),
    retired: (parsed.retired ?? []).map((entry) => ({ key: entry.key, note: entry.note })),
    aliases: (parsed.aliases ?? []).map((entry) => ({ key: entry.key, canonical: entry.canonical, note: entry.note })),
  }
}

/** Whether `value` sits between the key's bounds, both included; a missing bound leaves that side open. */
const inRange = (key: SchemaKey, value: number) => (key.min === null || value >= key.min) && (key.max === null || value <= key.max)

/** `auto` asks for the fork's default, which every key takes. */
function accepts(key: SchemaKey, value: string): boolean {
  const lower = value.toLowerCase()
  if (lower === 'auto') return true
  if (key.type === 'bool') return lower === 'true' || lower === 'false'
  if (key.type === 'int') return /^-?\d+$/.test(value) && inRange(key, Number(value))
  if (key.type === 'float') return value !== '' && Number.isFinite(Number(value)) && inRange(key, Number(value))
  if (key.type === 'enum') return (key.values ?? []).some((member) => member.toLowerCase() === lower)
  return true
}

/** What the key accepts, for the refusal message: its bounds, or the members of its enum. */
function expected(key: SchemaKey): string {
  if (key.type === 'enum') return ` (one of ${(key.values ?? []).join(', ')})`
  return key.min === null && key.max === null ? '' : ` (${key.min} to ${key.max})`
}

/**
 * Refuses each write the schema turns away, at the first reason it finds: a retired key, another name for one, a key the
 * fork's ini does not have, then a value the key does not take. A key the schema does not describe is only listed.
 */
export function checkIniWrites(schema: ForkSchema, forkIniKeys: { section: string; key: string }[], writes: IniWrite[]): SchemaCheck {
  const retired = new Map(schema.retired.map((entry) => [entry.key.toLowerCase(), entry.note]))
  const aliases = new Map(schema.aliases.map((entry) => [entry.key.toLowerCase(), entry.canonical]))
  const present = new Set(forkIniKeys.map((entry) => keyOf(entry.section, entry.key)))
  const known = new Map(schema.keys.map((key) => [keyOf(key.section, key.name), key]))
  const notInSchema: string[] = []
  const listed = new Set<string>()
  const notLive: SchemaCheck['notLive'] = []
  const errors: string[] = []
  let checked = 0
  for (const write of writes) {
    const at = qualified(write.section, write.key)
    const note = retired.get(at.toLowerCase())
    if (note !== undefined) { errors.push(`${write.source}: ${at} is retired in the fork: ${note}`); continue }
    const canonical = aliases.get(at.toLowerCase())
    if (canonical !== undefined) { errors.push(`${write.source}: ${at} is another name for ${canonical}; write ${canonical}`); continue }
    if (!present.has(keyOf(write.section, write.key))) { errors.push(`${write.source}: ${at} is not in the fork's OptiScaler.ini`); continue }
    const key = known.get(keyOf(write.section, write.key))
    if (!key) {
      if (!listed.has(keyOf(write.section, write.key))) { listed.add(keyOf(write.section, write.key)); notInSchema.push(at) }
      continue
    }
    const value = write.value.trim()
    if (!accepts(key, value)) { errors.push(`${write.source}: ${at} = ${value} is not a valid ${key.type}${expected(key)}`); continue }
    checked += 1
    if (key.applies !== 'live') notLive.push({ key: at, applies: key.applies, source: write.source })
  }
  return { checked, notInSchema, notLive, errors }
}

/** Every OptiScaler.ini write the recipe makes, in the order the build makes them, each with what asked for it. */
export function recipeIniWrites(recipe: { settingChoices?: SettingChoice[]; iniOverrides: { section: string; key: string; value: string }[]; optiscalerUpdateKeys?: { section: string; key: string; value: string }[] }): IniWrite[] {
  return [
    ...(recipe.settingChoices ?? []).flatMap((choice) => choice.options.flatMap((option) => option.settings
      .filter((setting) => setting.file === 'OptiScaler.ini')
      .map((setting) => ({ source: `choice ${choice.id}/${option.id}`, section: setting.section, key: setting.key, value: setting.value })))),
    ...recipe.iniOverrides.map((override) => ({ source: 'iniOverrides', section: override.section, key: override.key, value: override.value })),
    ...(recipe.optiscalerUpdateKeys ?? []).map((override) => ({ source: 'optiscalerUpdateKeys', section: override.section, key: override.key, value: override.value })),
  ]
}

/**
 * Reads the fork package's settings schema when the package has one and checks the recipe against it, or reports nothing
 * when it has none. Any refused write stops the build, with every one of them named.
 */
export async function forkSchemaReport(forkRoot: string, packagePaths: string[], recipe: Parameters<typeof recipeIniWrites>[0], forkIniText: string): Promise<{ release: string; commit: string; checked: number; notInSchema: string[]; notLive: SchemaCheck['notLive']; retired: string[] } | null> {
  if (!packagePaths.includes('settings-schema.json')) return null
  const schema = parseForkSchema(await readFile(join(forkRoot, 'settings-schema.json'), 'utf8'))
  const check = checkIniWrites(schema, entries(forkIniText), recipeIniWrites(recipe))
  if (check.errors.length) throw new Error(`The recipe writes keys the fork's settings schema refuses:\n${check.errors.join('\n')}`)
  return {
    release: schema.release,
    commit: schema.commit,
    checked: check.checked,
    notInSchema: check.notInSchema,
    notLive: check.notLive,
    retired: schema.retired.map((entry) => entry.key),
  }
}

/** The keys the new fork ini gained and the ones it dropped, each in its own file's casing and order, without duplicates. */
export function iniKeyDelta(previousIniText: string, forkIniText: string): { added: string[]; removed: string[] } {
  const previous = entries(previousIniText)
  const next = entries(forkIniText)
  const before = new Set(previous.map((entry) => keyOf(entry.section, entry.key)))
  const after = new Set(next.map((entry) => keyOf(entry.section, entry.key)))
  const outside = (list: { section: string; key: string }[], other: Set<string>) => {
    const seen = new Set<string>()
    const found: string[] = []
    for (const entry of list) {
      const id = keyOf(entry.section, entry.key)
      if (other.has(id) || seen.has(id)) continue
      seen.add(id)
      found.push(qualified(entry.section, entry.key))
    }
    return found
  }
  return { added: outside(next, before), removed: outside(previous, after) }
}
