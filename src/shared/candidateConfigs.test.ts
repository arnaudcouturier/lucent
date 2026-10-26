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

  it('keeps the character preview Neural Rendering off, as 2026.10.28 does', () => {
    expect(override(latest, 'PreviewNR')).toBe('false')
  })
})
