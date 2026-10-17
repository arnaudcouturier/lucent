// The Starter set: the Dalamud plugins and Penumbra mods the Mods section offers. It holds names, repo URLs and
// Heliosphere mod IDs, never binaries. Shared by the app and the publish tool; no framework or Platform dependencies.

/** The `repo` value of a plugin that comes from Dalamud's own repository. */
export const OFFICIAL_REPO = 'official'
/** Dalamud's main plugin repository, which every Dalamud install has. */
export const OFFICIAL_REPO_URL = 'https://kamori.goats.dev/Plugin/PluginMaster'

/** A third-party plugin repository, which Dalamud lists in `ThirdRepoList` and warns about. */
export interface StarterRepo {
  id: string
  /** What the consent panel calls the repository. */
  label: string
  /** Who runs it, named in the consent panel. */
  author: string
  /** The repository's `repo.json`. Dalamud matches plugins to it by this exact string. */
  url: string
}

/** `core` plugins share one Include switch; `extra` ones are each their own toggle, off by default. */
export const STARTER_GROUPS = ['core', 'extra'] as const
export type StarterGroup = typeof STARTER_GROUPS[number]

export interface StarterPlugin {
  /** Dalamud's name for the plugin: its folder under `installedPlugins` and its repo entry. */
  internalName: string
  name: string
  author: string
  summary: string
  /** Where the plugin's own page lives, for Credits. */
  source?: string
  /** `OFFICIAL_REPO`, or the `id` of one of the set's repos. */
  repo: string
  group: StarterGroup
  /** Listed but never fetched: the player installs it from Dalamud's plugin installer. */
  manual?: true
}

export interface StarterMod {
  /** The 26-character ID in the mod's heliosphere.app page address. */
  id: string
  name: string
  author: string
  summary?: string
  /** Shown with a neutral NSFW chip. */
  nsfw?: true
}

export interface StarterSet {
  repos: StarterRepo[]
  plugins: StarterPlugin[]
  mods: StarterMod[]
}

export class StarterSetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StarterSetError'
  }
}

/** Heliosphere's IDs are lowercase Crockford base32: no i, l, o or u. */
export const HELIOSPHERE_MOD_ID = /^[0-9a-hjkmnp-tv-z]{26}$/
/** Names that become folder names under `installedPlugins`. */
export const PLUGIN_INTERNAL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export const heliosphereModUrl = (id: string) => `https://heliosphere.app/mod/${id}`

const MAX_REPOS = 20
const MAX_PLUGINS = 60
const MAX_MODS = 200

function invalid(message: string): never {
  throw new StarterSetError(message)
}
function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${field} must be an object.`)
  return value as Record<string, unknown>
}
function list(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value)) invalid(`${field} must be an array.`)
  if (value.length > max) invalid(`${field} can hold at most ${max} items.`)
  return value
}
function text(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f]/.test(value) || value.length > max) invalid(`${field} must be a short single line of text.`)
  return value
}
/** An HTTPS address without credentials; the original string is kept, since Dalamud matches repos by exact string. */
function httpsUrl(value: unknown, field: string): string {
  const raw = text(value, field, 500)
  let url: URL
  try { url = new URL(raw) } catch { invalid(`${field} must be a web address.`) }
  if (url.protocol !== 'https:' || url.username || url.password || /\s/.test(raw)) invalid(`${field} must be an HTTPS address without credentials.`)
  return raw
}
function unique(values: string[], field: string) {
  if (new Set(values.map((v) => v.toLowerCase())).size !== values.length) invalid(`${field} must be unique.`)
}

/** Throws a StarterSetError naming the first thing wrong. The result is a new object holding only the known fields. */
export function validateStarterSet(value: unknown): StarterSet {
  const set = object(value, 'The Starter set')
  const repos = list(set.repos, 'Starter set repos', MAX_REPOS).map((r): StarterRepo => {
    const repo = object(r, 'A Starter set repo')
    const id = text(repo.id, 'Repo id', 40)
    if (!/^[a-z0-9-]+$/.test(id) || id === OFFICIAL_REPO) invalid(`Repo id "${id}" must be lowercase letters, digits and dashes, and not "${OFFICIAL_REPO}".`)
    return { id, label: text(repo.label, `Repo ${id} label`), author: text(repo.author, `Repo ${id} author`), url: httpsUrl(repo.url, `Repo ${id} url`) }
  })
  unique(repos.map((r) => r.id), 'Repo ids')
  unique(repos.map((r) => r.url), 'Repo urls')
  const repoIds = new Set(repos.map((r) => r.id))

  const plugins = list(set.plugins, 'Starter set plugins', MAX_PLUGINS).map((p): StarterPlugin => {
    const plugin = object(p, 'A Starter set plugin')
    const internalName = text(plugin.internalName, 'Plugin internalName', 64)
    if (!PLUGIN_INTERNAL_NAME.test(internalName)) invalid(`Plugin internalName "${internalName}" has characters that don't belong in a folder name.`)
    const repo = text(plugin.repo, `Plugin ${internalName} repo`, 40)
    if (repo !== OFFICIAL_REPO && !repoIds.has(repo)) invalid(`Plugin ${internalName} names an unknown repo: ${repo}.`)
    if (!(STARTER_GROUPS as readonly unknown[]).includes(plugin.group)) invalid(`Plugin ${internalName} group must be core or extra.`)
    if (plugin.manual !== undefined && typeof plugin.manual !== 'boolean') invalid(`Plugin ${internalName} manual must be true or false.`)
    return {
      internalName, name: text(plugin.name, `Plugin ${internalName} name`), author: text(plugin.author, `Plugin ${internalName} author`),
      summary: text(plugin.summary, `Plugin ${internalName} summary`, 300),
      ...(plugin.source === undefined ? {} : { source: httpsUrl(plugin.source, `Plugin ${internalName} source`) }),
      repo, group: plugin.group as StarterGroup, ...(plugin.manual ? { manual: true as const } : {}),
    }
  })
  unique(plugins.map((p) => p.internalName), 'Plugin internal names')

  const mods = list(set.mods, 'Starter set mods', MAX_MODS).map((m): StarterMod => {
    const mod = object(m, 'A Starter set mod')
    const id = text(mod.id, 'Mod id', 40)
    if (!HELIOSPHERE_MOD_ID.test(id)) invalid(`Mod id "${id}" must be the 26-character ID from the mod's Heliosphere page address.`)
    if (mod.nsfw !== undefined && typeof mod.nsfw !== 'boolean') invalid(`Mod ${id} nsfw must be true or false.`)
    return {
      id, name: text(mod.name, `Mod ${id} name`), author: text(mod.author, `Mod ${id} author`),
      ...(mod.summary === undefined ? {} : { summary: text(mod.summary, `Mod ${id} summary`, 300) }),
      ...(mod.nsfw ? { nsfw: true as const } : {}),
    }
  })
  unique(mods.map((m) => m.id), 'Mod ids')
  return { repos, plugins, mods }
}
