import { describe, expect, it } from 'vitest'
import manifest from '../../manifest.json'
import { parseManifest, validateManifest } from './manifest'
import { HELIOSPHERE_MOD_ID, StarterSetError, validateStarterSet, type StarterSet } from './starterSet'

const set = (): StarterSet => structuredClone(manifest.starterSet) as unknown as StarterSet
/** The published set with one thing changed. */
const changed = (edit: (draft: Record<string, any>) => void) => {
  const draft = structuredClone(manifest.starterSet) as Record<string, any>
  edit(draft)
  return draft
}

describe('the published Starter set', () => {
  // The set is edited by hand on main and never passes through the publish tool, so this is its only check.
  it('is valid in the repository manifest', () => {
    const parsed = parseManifest(JSON.stringify(manifest))
    expect(parsed.starterSetError).toBeUndefined()
    expect(parsed.starterSet).toEqual(set())
  })

  it('offers the agreed plugins and mods', () => {
    const { plugins, mods, repos } = set()
    expect(plugins.filter((p) => p.group === 'core').map((p) => p.internalName)).toEqual(['Penumbra', 'Glamourer', 'heliosphere-plugin', 'Weatherman', 'AcrylicXIV', 'ActionTimelineReplacement'])
    expect(plugins.filter((p) => p.group === 'extra').map((p) => p.internalName)).toEqual(['CharacterPanelRefined', 'MultiHit', 'Browsingway', 'IINACT'])
    expect(mods.map((m) => m.name)).toEqual(['Hair Defined 2', 'AETHERIS UI AIO', 'The Body SE'])
    expect(repos.map((r) => r.id)).toEqual(['seaofstars', 'action-timeline-replacement', 'iinact'])
  })

  it('tells the player what to set up for Browsingway and IINACT, which Lucent can’t write for them', () => {
    const setups = Object.fromEntries(set().plugins.filter((p) => p.setup).map((p) => [p.internalName, p.setup]))
    expect(Object.keys(setups)).toEqual(['Browsingway', 'IINACT'])
    expect(setups.IINACT).toMatch(/\/iinact/)
    expect(setups.Browsingway).toMatch(/\/bw config/)
  })

  it('never fetches the Heliosphere plugin', () => {
    // Heliosphere's terms bar other programs from its endpoints, so it is a listed instruction, not a download.
    expect(set().plugins.filter((p) => p.manual).map((p) => p.internalName)).toEqual(['heliosphere-plugin'])
  })

  it('marks only The Body SE as NSFW', () => {
    expect(set().mods.filter((m) => m.nsfw).map((m) => m.name)).toEqual(['The Body SE'])
  })

  it('keeps papa and papachin mods out', () => {
    // Paid or early-access work that is not the maintainer's to list (docs/decisions.md, Starter set).
    const text = JSON.stringify(set().mods).toLowerCase()
    expect(text).not.toContain('papa')
  })
})

describe('the manifest and its Starter set', () => {
  it('survives a parse and a re-validation, as the publish tool does', () => {
    const parsed = parseManifest(JSON.stringify(manifest))
    const again = validateManifest({ ...parsed, versions: [...parsed.versions] })
    expect(again.starterSet).toEqual(parsed.starterSet)
    expect(JSON.parse(JSON.stringify(again)).starterSet).toEqual(manifest.starterSet)
  })

  it('is optional', () => {
    const { starterSet: _dropped, ...older } = manifest
    const parsed = parseManifest(JSON.stringify(older))
    expect(parsed.starterSet).toBeUndefined()
    expect(parsed.starterSetError).toBeUndefined()
  })

  it('drops a broken set and keeps the rest of the manifest valid', () => {
    const parsed = parseManifest(JSON.stringify({ ...manifest, starterSet: { repos: 'oops' } }))
    expect(parsed.starterSet).toBeUndefined()
    expect(parsed.starterSetError).toMatch(/repos/)
    expect(parsed.tiers.length).toBe(manifest.tiers.length)
    expect(parsed.versions.length).toBe(manifest.versions.length)
  })
})

describe('validateStarterSet', () => {
  const rejects = (name: string, edit: (draft: Record<string, any>) => void, message: RegExp) =>
    it(`rejects ${name}`, () => {
      expect(() => validateStarterSet(changed(edit))).toThrow(StarterSetError)
      expect(() => validateStarterSet(changed(edit))).toThrow(message)
    })

  rejects('a repo that is not HTTPS', (d) => { d.repos[0].url = 'http://example.com/repo.json' }, /HTTPS/)
  rejects('a repo address with credentials', (d) => { d.repos[0].url = 'https://user:pw@example.com/repo.json' }, /credentials/)
  rejects('a repo address that is not an address', (d) => { d.repos[0].url = 'not a url' }, /web address/)
  rejects('the reserved repo id "official"', (d) => { d.repos[0].id = 'official' }, /official/)
  rejects('two repos with one address', (d) => { d.repos[1].url = d.repos[0].url }, /unique/)
  rejects('a plugin from an unknown repo', (d) => { d.plugins[0].repo = 'nowhere' }, /unknown repo/)
  rejects('an unknown group', (d) => { d.plugins[0].group = 'optional' }, /core or extra/)
  rejects('a plugin name that is a path', (d) => { d.plugins[0].internalName = '..\\evil' }, /folder name/)
  rejects('a plugin name with a separator', (d) => { d.plugins[0].internalName = 'a/b' }, /folder name/)
  rejects('two plugins differing only in case', (d) => { d.plugins[1].internalName = d.plugins[0].internalName.toUpperCase() }, /unique/)
  rejects('a mod ID of the wrong length', (d) => { d.mods[0].id = d.mods[0].id.slice(1) }, /26-character/)
  rejects('a mod ID with a letter Crockford leaves out', (d) => { d.mods[0].id = d.mods[0].id.slice(1) + 'u' }, /26-character/)
  rejects('an uppercase mod ID', (d) => { d.mods[0].id = d.mods[0].id.toUpperCase() }, /26-character/)
  rejects('two mods with one ID', (d) => { d.mods[1].id = d.mods[0].id }, /unique/)
  rejects('a name with a control character', (d) => { d.plugins[0].name = 'Pen\numbra' }, /single line/)
  rejects('a manual flag that is not a boolean', (d) => { d.plugins[2].manual = 'yes' }, /manual/)
  rejects('a setup line that is not one short line', (d) => { d.plugins[0].setup = 'First do this.\nThen that.' }, /setup must be a short single line/)
  rejects('an empty setup line', (d) => { d.plugins[0].setup = '  ' }, /setup/)
  rejects('a set that is not an object', (d) => { Object.keys(d).forEach((k) => delete d[k]); d.mods = {} }, /array/)

  it('accepts an empty set', () => {
    expect(validateStarterSet({ repos: [], plugins: [], mods: [] })).toEqual({ repos: [], plugins: [], mods: [] })
  })

  it('ignores fields it does not know, so a newer app can add some', () => {
    const draft = changed((d) => { d.plugins[0].futureField = 1; d.future = true })
    expect(validateStarterSet(draft)).toEqual(set())
  })

  it('keeps a repo address exactly as written, since Dalamud matches repos by exact string', () => {
    const url = 'https://example.com/Repo.json'
    expect(validateStarterSet({ repos: [{ id: 'x', label: 'X', author: 'Y', url }], plugins: [], mods: [] }).repos[0].url).toBe(url)
  })

  it('accepts real Heliosphere IDs', () => {
    for (const id of ['00e1decfyd2aqbhb7x20b9ccbm', 'xkt0qcds3h6j1f35yr5aqt6vsw']) expect(id).toMatch(HELIOSPHERE_MOD_ID)
  })
})
