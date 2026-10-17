// The Starter set: what the Mods section reads from the machine and does to it. Plugins are fetched from their own
// repos and placed under Dalamud's `installedPlugins`; mods are only detected, because the player installs them from
// Heliosphere. Lucent forgets the plugins once they are placed: Dalamud owns them from then on (docs/decisions.md).
import { assertGamePath } from '../shared/manifest'
import {
  OFFICIAL_REPO, OFFICIAL_REPO_URL, type StarterMod, type StarterPlugin, type StarterRepo, type StarterSet,
} from '../shared/starterSet'
import { PlatformError, type CopyItem, type Platform } from './platform'
import { joinPath } from './paths'
import { XIVLAUNCHER_EXE } from './xivLauncher'

// ---------------------------------------------------------------------------------------------------------------------
// Where things are

export interface DalamudPaths {
  /** XIVLauncher's roaming folder, which holds Dalamud's config and plugins. */
  root: string
  plugins: string
  config: string
  launcherConfig: string
  /** One folder per Dalamud build, named by its version. */
  hooks: string
  penumbraConfig: string
}

export async function dalamudPaths(platform: Platform): Promise<DalamudPaths> {
  const root = joinPath(await platform.envFolder('AppData'), 'XIVLauncher')
  return {
    root, plugins: joinPath(root, 'installedPlugins'), config: joinPath(root, 'dalamudConfig.json'), launcherConfig: joinPath(root, 'launcherConfigV3.json'),
    hooks: joinPath(root, 'addon', 'Hooks'), penumbraConfig: joinPath(root, 'pluginConfigs', 'Penumbra', 'config', 'penumbra.json'),
  }
}

/** Under Lucent's data folder: each Add downloads and unpacks here, and clears it again. */
export const STAGING_FOLDER = 'starter-staging'

/** What Dalamud writes as `InstalledFromUrl` for a plugin from its own repository (its `SpecialPluginSource.MainRepo`); compared by exact string. */
export const DALAMUD_MAIN_REPO = 'OFFICIAL'

const parseJson = (text: string): unknown => JSON.parse(text.replace(/^﻿/, ''))
const notFound = (error: unknown) => error instanceof PlatformError && error.kind === 'not-found'
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

// ---------------------------------------------------------------------------------------------------------------------
// What is on the machine

/** Why Lucent can't add plugins yet. `ready` means it can. */
export type DalamudStatus =
  | { status: 'ready' }
  | { status: 'no-xivlauncher' | 'dalamud-off' | 'not-run' }
  | { status: 'unreadable'; message: string }

export interface ThirdRepoEntry { url: string; enabled: boolean }

export interface StarterSetScan {
  dalamud: DalamudStatus
  /** Dalamud's plugin API level, the major version of its newest build; null when no build is found. */
  apiLevel: number | null
  /** Dalamud's `ThirdRepoList`, as the player has it. */
  thirdRepos: ThirdRepoEntry[]
  /** The folder names under `installedPlugins`. */
  installedPlugins: string[]
  /** Penumbra's mod directory; null when Penumbra has none yet. */
  modDirectory: string | null
  /** The Heliosphere IDs of the Starter set's mods whose folders were found in the mod directory. */
  installedMods: string[]
}

export const DALAMUD_MESSAGE: Record<Exclude<DalamudStatus['status'], 'ready' | 'unreadable'>, string> = {
  'no-xivlauncher': 'Mods needs XIVLauncher with Dalamud, and Lucent couldn’t find XIVLauncher’s settings on this PC.',
  'dalamud-off': 'Dalamud is turned off in XIVLauncher. Turn it on in XIVLauncher’s settings, launch XIV once, then check again.',
  'not-run': 'Dalamud hasn’t run on this PC yet. Launch XIV once from XIVLauncher with Dalamud on, then check again.',
}

export const dalamudMessage = (dalamud: DalamudStatus): string | null =>
  dalamud.status === 'ready' ? null : dalamud.status === 'unreadable' ? dalamud.message : DALAMUD_MESSAGE[dalamud.status]

/** The repos in Dalamud's config; a config with no list reads as empty. */
export function readThirdRepos(configText: string): ThirdRepoEntry[] {
  const config = parseJson(configText) as { ThirdRepoList?: unknown } | null
  const list = config?.ThirdRepoList
  const entries = Array.isArray(list) ? list : Array.isArray((list as { $values?: unknown } | undefined)?.$values) ? (list as { $values: unknown[] }).$values : []
  return entries.flatMap((entry) => {
    const { Url, IsEnabled } = (entry ?? {}) as { Url?: unknown; IsEnabled?: unknown }
    return typeof Url === 'string' && Url ? [{ url: Url, enabled: IsEnabled !== false }] : []
  })
}

/** The major version of the newest Dalamud build XIVLauncher keeps, which is the API level plugins are built for. */
async function readApiLevel(platform: Platform, hooks: string): Promise<number | null> {
  try {
    const builds = (await platform.listFolders(hooks)).filter((name) => /^\d+(\.\d+)+$/.test(name))
      .map((name) => name.split('.').map(Number))
      .sort((a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (b[i] ?? 0) - (a[i] ?? 0); if (d) return d } return 0 })
    return builds[0]?.[0] ?? null
  } catch { return null }
}

async function readDalamudStatus(platform: Platform, paths: DalamudPaths): Promise<{ dalamud: DalamudStatus; thirdRepos: ThirdRepoEntry[] }> {
  let launcher: { InGameAddonEnabled?: unknown } | null
  try { launcher = parseJson(await platform.readText(paths.launcherConfig)) as typeof launcher }
  catch (error) {
    if (notFound(error)) return { dalamud: { status: 'no-xivlauncher' }, thirdRepos: [] }
    return { dalamud: { status: 'unreadable', message: `Lucent couldn’t read XIVLauncher’s settings. ${message(error)}` }, thirdRepos: [] }
  }
  if (String(launcher?.InGameAddonEnabled).toLowerCase() === 'false') return { dalamud: { status: 'dalamud-off' }, thirdRepos: [] }
  try { return { dalamud: { status: 'ready' }, thirdRepos: readThirdRepos(await platform.readText(paths.config)) } }
  catch (error) {
    if (notFound(error)) return { dalamud: { status: 'not-run' }, thirdRepos: [] }
    return { dalamud: { status: 'unreadable', message: `Lucent couldn’t read Dalamud’s settings. ${message(error)}` }, thirdRepos: [] }
  }
}

/** Heliosphere's page address holds the mod's ID: `https://heliosphere.app/mod/<26 characters>`. */
const HELIOSPHERE_ID_IN_ADDRESS = /heliosphere\.app\/mod\/([0-9a-z]{26})(?![0-9a-z])/i

/** Finds which of the set's mods have a folder in Penumbra's mod directory, by the `Website` in each `meta.json`. */
async function readInstalledMods(platform: Platform, modDirectory: string, wanted: StarterMod[]): Promise<string[]> {
  if (!wanted.length) return []
  const ids = new Set(wanted.map((mod) => mod.id))
  const found = new Set<string>()
  let folders: string[]
  try { folders = await platform.listFolders(modDirectory) } catch { return [] }
  const candidates = folders.filter((name) => !name.startsWith('.'))
  // A mod folder can be gigabytes, but `meta.json` is one small file; a few at a time keeps a large library quick.
  for (let i = 0; i < candidates.length; i += 16) {
    await Promise.all(candidates.slice(i, i + 16).map(async (name) => {
      try {
        const meta = parseJson(await platform.readText(joinPath(modDirectory, name, 'meta.json'))) as { Website?: unknown } | null
        const id = typeof meta?.Website === 'string' ? HELIOSPHERE_ID_IN_ADDRESS.exec(meta.Website)?.[1]?.toLowerCase() : undefined
        if (id && ids.has(id)) found.add(id)
      } catch { /* a folder without a readable meta.json is not a mod this can name */ }
    }))
  }
  return [...found]
}

export async function scanStarterSet(platform: Platform, set: StarterSet): Promise<StarterSetScan> {
  const paths = await dalamudPaths(platform)
  const { dalamud, thirdRepos } = await readDalamudStatus(platform, paths)
  if (dalamud.status !== 'ready') return { dalamud, apiLevel: null, thirdRepos, installedPlugins: [], modDirectory: null, installedMods: [] }
  const [installedPlugins, apiLevel] = await Promise.all([
    platform.listFolders(paths.plugins).catch((error) => { if (notFound(error)) return []; throw error }),
    readApiLevel(platform, paths.hooks),
  ])
  let modDirectory: string | null = null
  try {
    const configured = (parseJson(await platform.readText(paths.penumbraConfig)) as { ModDirectory?: unknown } | null)?.ModDirectory
    if (typeof configured === 'string' && configured.trim()) modDirectory = configured
  } catch { /* Penumbra has not been set up, or its config is unreadable: no mod folder to look in */ }
  const installedMods = modDirectory ? await readInstalledMods(platform, modDirectory, set.mods) : []
  return { dalamud, apiLevel, thirdRepos, installedPlugins, modDirectory, installedMods }
}

/** What the Mods section shows. `unavailable` carries the reason in words for the player. */
export type StarterSetState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'unavailable'; message: string }
  | { status: 'ready'; set: StarterSet; scan: StarterSetScan; progress: string | null; result: SeedOutcome | null }

// ---------------------------------------------------------------------------------------------------------------------
// What each row can do

/** `manual`: Lucent never fetches it, so the row says to install it from Dalamud. `repo-off`: its repository is switched off in Dalamud. */
export type PluginStatus = 'installed' | 'available' | 'manual' | 'repo-off'

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
export const isInstalled = (scan: StarterSetScan, plugin: StarterPlugin) => scan.installedPlugins.some((name) => sameName(name, plugin.internalName))
export const repoOf = (set: StarterSet, plugin: StarterPlugin): StarterRepo | null => set.repos.find((repo) => repo.id === plugin.repo) ?? null

export function pluginStatus(set: StarterSet, scan: StarterSetScan, plugin: StarterPlugin): PluginStatus {
  if (isInstalled(scan, plugin)) return 'installed'
  if (plugin.manual) return 'manual'
  const repo = repoOf(set, plugin)
  if (repo && scan.thirdRepos.some((entry) => entry.url === repo.url && !entry.enabled)) return 'repo-off'
  return 'available'
}

/** The plugins an Add would fetch: the core ones when `core` is on, plus the extras the player ticked, minus what is there already. */
export function pluginsToAdd(set: StarterSet, scan: StarterSetScan, choice: { core: boolean; extras: string[] }): StarterPlugin[] {
  return set.plugins.filter((plugin) => (plugin.group === 'core' ? choice.core : choice.extras.includes(plugin.internalName)) && pluginStatus(set, scan, plugin) === 'available')
}

/** The third-party repos an Add would have to append to Dalamud's list. Dalamud's own repository needs no entry. */
export function reposToAdd(set: StarterSet, scan: StarterSetScan, plugins: StarterPlugin[]): StarterRepo[] {
  const needed = new Set(plugins.map((plugin) => plugin.repo).filter((id) => id !== OFFICIAL_REPO))
  return set.repos.filter((repo) => needed.has(repo.id) && !scan.thirdRepos.some((entry) => entry.url === repo.url))
}

export const modInstalled = (scan: StarterSetScan, mod: StarterMod) => scan.installedMods.includes(mod.id)

// ---------------------------------------------------------------------------------------------------------------------
// Editing Dalamud's config without rewriting it
//
// Dalamud's config is Newtonsoft JSON with type names. A full parse and stringify would reorder numeric keys and round large
// numbers, so the new repos are spliced into the text of `ThirdRepoList` and everything else stays byte for byte.

export class DalamudConfigError extends Error {
  constructor(detail: string) {
    super(`Lucent didn’t change Dalamud’s settings because ${detail}.`)
    this.name = 'DalamudConfigError'
  }
}
const layoutError = () => new DalamudConfigError('they are laid out in a way it doesn’t recognise')

const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r'
const skipSpace = (text: string, i: number) => { while (i < text.length && isSpace(text[i])) i++; return i }
function skipString(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++
    else if (text[i] === '"') return i + 1
  }
  throw layoutError()
}
/** The index just past the JSON value that starts at `start`. */
function skipValue(text: string, start: number): number {
  let i = skipSpace(text, start)
  if (text[i] === '"') return skipString(text, i)
  if (text[i] === '{' || text[i] === '[') {
    let depth = 0
    for (; i < text.length; i++) {
      const c = text[i]
      if (c === '"') i = skipString(text, i) - 1
      else if (c === '{' || c === '[') depth++
      else if (c === '}' || c === ']') { depth--; if (depth === 0) return i + 1 }
    }
    throw layoutError()
  }
  while (i < text.length && !isSpace(text[i]) && text[i] !== ',' && text[i] !== '}' && text[i] !== ']') i++
  return i
}
interface Span { keyStart: number; start: number; end: number }
/** The properties of the object that starts at `start`, with where each one's key and value sit in the text. */
function properties(text: string, start: number): Map<string, Span> {
  if (text[start] !== '{') throw layoutError()
  const found = new Map<string, Span>()
  let i = start + 1
  for (;;) {
    i = skipSpace(text, i)
    if (text[i] === '}') return found
    if (text[i] !== '"') throw layoutError()
    const keyStart = i
    const keyEnd = skipString(text, i)
    const colon = skipSpace(text, keyEnd)
    if (text[colon] !== ':') throw layoutError()
    const valueStart = skipSpace(text, colon + 1)
    const valueEnd = skipValue(text, valueStart)
    found.set(JSON.parse(text.slice(keyStart, keyEnd)) as string, { keyStart, start: valueStart, end: valueEnd })
    i = skipSpace(text, valueEnd)
    if (text[i] === ',') i++
    else if (text[i] !== '}') throw layoutError()
  }
}

/**
 * Appends a `ThirdRepoList` entry for each address the list lacks, in the shape and indentation the file already uses.
 * Addresses are compared by exact string, as Dalamud does. Throws a DalamudConfigError, changing nothing, when the file
 * isn't laid out as Dalamud writes it or the result doesn't check out.
 */
export function addThirdRepos(text: string, urls: string[]): { text: string; added: string[] } {
  const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const root = properties(text, skipSpace(text, bom))
  const list = root.get('ThirdRepoList')
  if (!list) throw new DalamudConfigError('they have no list of custom repositories')
  const listProperties = properties(text, list.start)
  const values = listProperties.get('$values')
  if (!values || text[values.start] !== '[') throw layoutError()
  const existing = JSON.parse(text.slice(values.start, values.end)) as { Url?: unknown }[]
  const have = new Set(existing.map((entry) => typeof entry?.Url === 'string' ? entry.Url : ''))
  const missing = urls.filter((url, i) => !have.has(url) && urls.indexOf(url) === i)
  if (!missing.length) return { text, added: [] }

  // Each entry names its type; copy the first one's, or read it from the list's own type name.
  const elements: Span[] = []
  for (let i = values.start + 1; ;) {
    i = skipSpace(text, i)
    if (text[i] === ']') break
    const end = skipValue(text, i)
    elements.push({ keyStart: i, start: i, end })
    i = skipSpace(text, end)
    if (text[i] === ',') i++
  }
  const valueOf = (span: Span) => JSON.parse(text.slice(span.start, span.end)) as unknown
  let entryType: unknown
  if (elements.length && text[elements[0].start] === '{') {
    const type = properties(text, elements[0].start).get('$type')
    if (type) entryType = valueOf(type)
  }
  if (typeof entryType !== 'string') {
    const type = listProperties.get('$type')
    const listType = type ? valueOf(type) : undefined
    entryType = typeof listType === 'string' ? /\[\[([^\]]+)\]\]/.exec(listType)?.[1] : undefined
  }
  if (typeof entryType !== 'string' || !entryType) throw layoutError()

  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const indentAt = (index: number) => /^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', index - 1) + 1, index))![0]
  const unit = text.includes('\n') ? indentAt([...root.values()][0].keyStart) : ''
  const compact = !text.includes('\n')
  const closing = compact ? '' : indentAt(values.keyStart)
  const entryIndent = compact ? '' : closing + unit
  const gap = compact ? '' : newline
  const entry = (url: string) => `{${gap}${entryIndent + unit}"$type": ${JSON.stringify(entryType)},${gap}${entryIndent + unit}"Url": ${JSON.stringify(url)},${gap}${entryIndent + unit}"IsEnabled": true${gap}${entryIndent}}`
  const joined = missing.map(entry).join(`,${gap}${entryIndent}`)
  const result = elements.length
    ? text.slice(0, elements.at(-1)!.end) + `,${gap}${entryIndent}${joined}` + text.slice(elements.at(-1)!.end)
    : text.slice(0, values.start) + `[${gap}${entryIndent}${joined}${gap}${closing}]` + text.slice(values.end)

  // Before anything is written, the result must read back as the old list plus the new entries, and as nothing else changed.
  try {
    const before = parseJson(text) as Record<string, unknown>
    const after = parseJson(result) as Record<string, unknown>
    const afterRepos = readThirdRepos(result)
    const expected = [...readThirdRepos(text).map((e) => e.url), ...missing]
    const { ThirdRepoList: _a, ...otherBefore } = before
    const { ThirdRepoList: _b, ...otherAfter } = after
    if (JSON.stringify(afterRepos.map((e) => e.url)) !== JSON.stringify(expected) || !afterRepos.slice(-missing.length).every((e) => e.enabled)
      || JSON.stringify(otherBefore) !== JSON.stringify(otherAfter)) throw layoutError()
  } catch (error) {
    if (error instanceof DalamudConfigError) throw error
    throw layoutError()
  }
  return { text: result, added: missing }
}

// ---------------------------------------------------------------------------------------------------------------------
// Adding plugins

/** Heliosphere's terms bar other programs from its endpoints, so nothing at its address is ever fetched. */
function assertFetchable(address: string) {
  const url = new URL(address)
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:') throw new Error('Plugin addresses must use HTTPS.')
  if (host === 'heliosphere.app' || host.endsWith('.heliosphere.app')) throw new Error('Heliosphere doesn’t allow other programs to download from it.')
}

const VERSION = /^\d+(\.\d+){1,3}$/

export interface SeedSkip { name: string; reason: string }
export interface SeedOutcome {
  /** Each plugin placed, with the version Dalamud will find. */
  placed: { name: string; version: string }[]
  skipped: SeedSkip[]
  /** The addresses appended to Dalamud's list of custom repositories. */
  reposAdded: string[]
}

export interface SeedOptions {
  /** A folder of Lucent's own to unpack into; it is emptied again before this returns. */
  stagingRoot: string
  /** Throws, in words for the player, when XIV or XIVLauncher is running. Asked again just before anything is written. */
  guard(): Promise<void>
  progress?(text: string): void
  log?(level: 'info' | 'warning', text: string): void
}

/** Throws the player-facing reason when XIV or XIVLauncher is running, since Dalamud rewrites its settings while they run. */
export function closedGuard(platform: Platform): () => Promise<void> {
  return async () => {
    if (await platform.isGameRunning()) throw new Error('Close XIV, then try again. Lucent changes Dalamud’s files only while the game is closed.')
    if (await platform.isProcessRunning(XIVLAUNCHER_EXE)) throw new Error('Close XIVLauncher, then try again. Lucent changes Dalamud’s files only while it’s closed.')
  }
}

interface Staged { plugin: StarterPlugin; repo: StarterRepo | null; version: string; manifestText: string; files: string[]; stage: string }

/** `repo.json` is a list of plugins; one that isn't can't be read. */
function readRepoEntries(text: string): Record<string, unknown>[] {
  const value = parseJson(text)
  if (!Array.isArray(value)) throw new Error('not a plugin list')
  return value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry))
}

async function removeTree(platform: Platform, root: string) {
  try {
    const files = (await platform.listFiles(root)).map((relative) => joinPath(root, relative))
    await platform.removeMany(files)
    const folders = new Set<string>([root])
    for (const file of files) for (let dir = file.slice(0, file.lastIndexOf('\\')); dir.length > root.length; dir = dir.slice(0, dir.lastIndexOf('\\'))) folders.add(dir)
    await platform.removeDirectoriesIfEmpty([...folders].sort((a, b) => b.length - a.length))
  } catch { /* a leftover staging folder is harmless; the next Add uses its own */ }
}

/**
 * Fetches each plugin from its repo and places it where Dalamud finds it on its next start. Everything is downloaded and checked
 * before Dalamud's files are touched; the repos are appended next, then the plugins are copied in. A plugin that can't be added is
 * skipped with its reason and the rest carry on. Throws only when nothing can be written (the game is running, or the config).
 */
export async function seedPlugins(platform: Platform, set: StarterSet, scan: StarterSetScan, wanted: StarterPlugin[], options: SeedOptions): Promise<SeedOutcome> {
  const { guard, progress, log } = options
  const outcome: SeedOutcome = { placed: [], skipped: [], reposAdded: [] }
  const skip = (plugin: StarterPlugin, reason: string) => { outcome.skipped.push({ name: plugin.name, reason }); log?.('warning', `Starter set: skipped ${plugin.name}: ${reason}`) }
  if (scan.dalamud.status !== 'ready') throw new Error(dalamudMessage(scan.dalamud) ?? 'Dalamud isn’t ready.')
  await guard()
  const paths = await dalamudPaths(platform)
  const runDir = joinPath(options.stagingRoot, new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 17) + '-' + Math.random().toString(36).slice(2, 8))

  try {
    // Only what the set says is fetchable, and only what is not there yet.
    const candidates = wanted.filter((plugin) => {
      const status = pluginStatus(set, scan, plugin)
      if (status === 'installed') return false
      if (status === 'manual') { skip(plugin, 'Install it from Dalamud’s plugin installer (/xlplugins).'); return false }
      if (status === 'repo-off') { skip(plugin, `Its repository is turned off in Dalamud. Turn it on in Dalamud’s settings, then add it again.`); return false }
      return true
    })

    // Each repo's plugin list is read once.
    const lists = new Map<string, Record<string, unknown>[] | string>()
    const listOf = async (repo: StarterRepo | null): Promise<Record<string, unknown>[] | string> => {
      const url = repo?.url ?? OFFICIAL_REPO_URL
      if (!lists.has(url)) {
        try { assertFetchable(url); lists.set(url, readRepoEntries(await platform.fetchText(url))) }
        catch (error) { lists.set(url, `Lucent couldn’t read ${repo?.label ?? 'Dalamud’s'} plugin list. ${message(error)}`) }
      }
      return lists.get(url)!
    }

    const staged: Staged[] = []
    for (const [index, plugin] of candidates.entries()) {
      progress?.(`Downloading ${plugin.name} (${index + 1} of ${candidates.length})…`)
      const repo = repoOf(set, plugin)
      try {
        const entries = await listOf(repo)
        if (typeof entries === 'string') { skip(plugin, entries); continue }
        const entry = entries.find((candidate) => candidate.InternalName === plugin.internalName)
        if (!entry) { skip(plugin, `${repo?.label ?? 'Dalamud’s repository'} doesn’t list it any more.`); continue }
        const level = Number(entry.DalamudApiLevel)
        if (scan.apiLevel !== null && level !== scan.apiLevel) { skip(plugin, `It is built for Dalamud API ${Number.isFinite(level) ? level : 'an unknown level'}, and your Dalamud uses API ${scan.apiLevel}. Update Dalamud or wait for the plugin.`); continue }
        const link = entry.DownloadLinkInstall
        if (typeof link !== 'string') { skip(plugin, 'Its repository gives no download address.'); continue }
        assertFetchable(link)
        const pluginDir = joinPath(runDir, plugin.internalName)
        const zip = joinPath(pluginDir, 'plugin.zip')
        const stage = joinPath(pluginDir, 'stage')
        await platform.downloadFile(link, zip, () => {})
        await platform.extractZip(zip, stage)
        const relatives = await platform.listFiles(stage)
        for (const relative of relatives) {
          try { assertGamePath(relative) } catch { throw new Error(`The download holds a file Lucent won’t unpack: ${relative}`) }
        }
        const lower = new Map(relatives.map((relative) => [relative.toLowerCase(), relative]))
        const manifestFile = lower.get(`${plugin.internalName}.json`.toLowerCase())
        if (!manifestFile || !lower.has(`${plugin.internalName}.dll`.toLowerCase())) throw new Error('The download is not laid out as a Dalamud plugin.')
        const manifest = parseJson(await platform.readText(joinPath(stage, manifestFile))) as Record<string, unknown> | null
        if (!manifest || manifest.InternalName !== plugin.internalName) throw new Error('The download is for a different plugin.')
        const version = manifest.AssemblyVersion
        if (typeof version !== 'string' || !VERSION.test(version)) throw new Error('The download has no usable version.')
        // Dalamud finds third-party plugins by the exact address of their repo; its own are marked OFFICIAL.
        const installedFrom = repo ? repo.url : DALAMUD_MAIN_REPO
        staged.push({ plugin, repo, version, manifestText: JSON.stringify({ ...manifest, InstalledFromUrl: installedFrom }, null, 2),
          files: relatives.filter((relative) => relative !== manifestFile), stage })
      } catch (error) { skip(plugin, message(error)) }
    }

    if (!staged.length) return outcome

    // Nothing in Dalamud's folder has changed yet. Downloads take time: ask again whether the game was started meanwhile.
    await guard()
    const newRepos = reposToAdd(set, scan, staged.map((s) => s.plugin))
    if (newRepos.length) {
      progress?.('Adding the plugin repositories to Dalamud…')
      let config: string
      try { config = await platform.readText(paths.config) }
      catch (error) { throw new DalamudConfigError(`it couldn’t be read. ${message(error)}`) }
      const edit = addThirdRepos(config, newRepos.map((repo) => repo.url))
      await platform.writeText(paths.config, edit.text)
      outcome.reposAdded = edit.added
      for (const url of edit.added) log?.('info', `Starter set: added ${url} to Dalamud’s custom repositories`)
    }

    for (const [index, item] of staged.entries()) {
      progress?.(`Adding ${item.plugin.name} (${index + 1} of ${staged.length})…`)
      await guard()
      const folder = joinPath(paths.plugins, item.plugin.internalName)
      const destination = joinPath(folder, item.version)
      const placed: string[] = []
      try {
        // It might have appeared since the scan; whatever is there is the player's.
        if ((await platform.listFolders(paths.plugins).catch(() => [] as string[])).some((name) => sameName(name, item.plugin.internalName))) { skip(item.plugin, 'It was installed while Lucent was working.'); continue }
        const copies: CopyItem[] = item.files.map((relative) => ({ from: joinPath(item.stage, relative), to: joinPath(destination, relative), replace: false }))
        // Listed before the copy: a copy that stops halfway has still written some of them, and removing a file that isn't there is fine.
        placed.push(...copies.map((copy) => copy.to))
        await platform.copyMany(copies)
        // The manifest goes last: Dalamud ignores a version folder without one, so a stop halfway leaves nothing it would load.
        const manifestPath = joinPath(destination, `${item.plugin.internalName}.json`)
        await platform.writeText(manifestPath, item.manifestText)
        placed.push(manifestPath)
        outcome.placed.push({ name: item.plugin.name, version: item.version })
        log?.('info', `Starter set: added ${item.plugin.name} ${item.version} from ${item.repo?.label ?? 'Dalamud’s repository'}`)
      } catch (error) {
        skip(item.plugin, message(error))
        await platform.removeMany(placed).catch(() => {})
        const folders = new Set<string>([destination, folder])
        for (const path of placed) for (let dir = path.slice(0, path.lastIndexOf('\\')); dir.length > destination.length; dir = dir.slice(0, dir.lastIndexOf('\\'))) folders.add(dir)
        await platform.removeDirectoriesIfEmpty([...folders].sort((a, b) => b.length - a.length)).catch(() => {})
      }
    }
    return outcome
  } finally {
    await removeTree(platform, runDir)
    await platform.removeDirectoriesIfEmpty([options.stagingRoot]).catch(() => {})
  }
}
