import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// What the latest content candidate does to the player's OptiScaler.ini, read from its recipe: a wrong value or a missing
// update key would only show up after publication.
const CANDIDATES = 'content/candidates'
interface Recipe {
  id: string
  channel: string
  changelog: string[]
  iniOverrides: { section: string; key: string; value: string }[]
  fork?: { tag: string; zipSha256: string }
  optiscalerUpdateKeys?: { section: string; key: string; value: string; ifPath?: string }[]
}
const recipes = readdirSync(CANDIDATES).sort().flatMap((id) => {
  try { return [JSON.parse(readFileSync(`${CANDIDATES}/${id}/recipe.json`, 'utf8')) as Recipe] } catch { return [] }
})
const latest = recipes.at(-1)!
const override = (recipe: Recipe, key: string) => recipe.iniOverrides.find((o) => o.section === 'FFXIV' && o.key === key)?.value

describe('the latest content candidate', () => {
  it('ships Automatic ReShade scene depth on, from content 2026.10.29', () => {
    expect(latest.id >= '2026.10.29').toBe(true)
    expect(override(latest, 'AutomaticReShadeDepth')).toBe('true')
    // 2026.10.28 shipped it at `auto`, which the fork reads as off.
    expect(override(recipes.find((r) => r.id === '2026.10.28')!, 'AutomaticReShadeDepth')).toBeUndefined()
  })

  it('switches it on for a setup that took 2026.10.28 only while the key still reads auto, so a value the player set stays', () => {
    expect(latest.optiscalerUpdateKeys).toEqual([{ section: 'FFXIV', key: 'AutomaticReShadeDepth', value: 'true', ifPath: 'auto' }])
  })

  it('tells a player on 2026.10.27 about it, who sees this version’s changelog and nothing from 2026.10.28', () => {
    expect(latest.changelog.join(' ')).toMatch(/Automatic ReShade scene depth, which Lucent turns on by default/)
    expect(latest.changelog.join(' ')).toMatch(/Alive NEXT Stable 4K/)
    expect(latest.changelog.join(' ')).not.toMatch(/switched off; nothing changes unless you turn it on/)
  })

  it('is built on OptiScaler-FFXIV v0.3.0 from 2026.10.30, with the new patch-day keys left off', () => {
    expect(latest.id >= '2026.10.30').toBe(true)
    expect(latest.fork?.tag).toBe('ffxiv-2026.10.26-d9b62110')
    expect(latest.fork?.zipSha256).toBe('190ca55056136ddc46b36ea8ecf89c98601df7c9a3916cb3e442b290d99c2427')
    // The keys ship at the package's own `auto`, which is off: no override may switch one on.
    for (const key of ['FfxivUnknownBuildHooks', 'FfxivForceUnknownBuild', 'FfxivLegacyGameBuild']) expect(override(latest, key)).toBeUndefined()
    // Nor may the update check be switched on: the shipped ini keeps `auto`, which is off from v0.3.0.
    expect(latest.iniOverrides.some((o) => o.key === 'CheckForUpdate')).toBe(false)
  })

  it('tells a player on an earlier 2026.10 content about v0.3.0, the pattern search and the update check', () => {
    const text = latest.changelog.join(' ')
    expect(text).toMatch(/OptiScaler-FFXIV is updated to v0\.3\.0/)
    expect(text).toMatch(/pattern search/)
    expect(text).toMatch(/FfxivUnknownBuildHooks=true/)
    expect(text).toMatch(/update check/)
    // The feature arrived in 2026.10.28 (fork v0.2.0); 2026.10.27 never had it, and a player on it must not read "you already have this".
    expect(text).toMatch(/Since 2026\.10\.28 it has Automatic ReShade scene depth/)
    expect(text).not.toMatch(/2026\.10\.27/)
  })

  it('keeps the character preview Neural Rendering off, as 2026.10.28 does', () => {
    expect(override(latest, 'PreviewNR')).toBe('false')
  })
})
