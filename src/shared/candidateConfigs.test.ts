import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// What the latest content candidate does to the player's OptiScaler.ini, read from its recipe: a wrong value or a missing
// update key would only show up after publication.
const CANDIDATES = 'content/candidates'
interface Recipe {
  id: string
  channel: string
  changelog: string[]
  generatedFolders: string[]
  iniOverrides: { section: string; key: string; value: string }[]
  fork?: { tag: string; commit: string; zipSha256: string }
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

  it('is built on OptiScaler-FFXIV v0.5.1 from 2026.10.31, with the new patch-day keys left off', () => {
    expect(latest.id >= '2026.10.30').toBe(true)
    expect(latest.fork?.tag).toBe('ffxiv-2026.10.31b-d9b62110')
    expect(latest.fork?.commit).toBe('396823cb')
    expect(latest.fork?.zipSha256).toBe('ac19e9f59efe8f0c3d0a404c9289fef11a204058e987739c7fe8f34d31b12974')
    // The keys ship at the package's own `auto`, which is off: no override may switch one on.
    for (const key of ['FfxivUnknownBuildHooks', 'FfxivForceUnknownBuild', 'FfxivLegacyGameBuild']) expect(override(latest, key)).toBeUndefined()
    // Nor may the update check be switched on: the shipped ini keeps `auto`, which is off from v0.3.0.
    expect(latest.iniOverrides.some((o) => o.key === 'CheckForUpdate')).toBe(false)
  })

  it('tells a player on an earlier 2026.10 content about the move to v0.5.1, the pattern search and the update check', () => {
    const text = latest.changelog.join(' ')
    expect(text).toMatch(/OptiScaler-FFXIV is updated from v0\.3\.0 to v0\.5\.1/)
    expect(text).toMatch(/pattern search/)
    expect(text).toMatch(/FfxivUnknownBuildHooks=true/)
    expect(text).toMatch(/update check/)
    // The feature arrived in 2026.10.28 (fork v0.2.0); 2026.10.27 never had it, and a player on it must not read "you already have this".
    expect(text).toMatch(/Since 2026\.10\.28, OptiScaler-FFXIV has Automatic ReShade scene depth/)
    expect(text).not.toMatch(/2026\.10\.27/)
  })

  it('is on the Stable channel: the maintainer played the fork build before it shipped', () => {
    expect(latest.channel).toBe('stable')
  })

  it('switches Scene HDR to the continuous composition, which only matters with HDR on', () => {
    expect(latest.iniOverrides).toContainEqual({ section: 'HDR', key: 'LegacyComposition', value: 'false' })
  })

  it('gives Uninstall the folders and files the fork’s new diagnostics write, keeping the HUD-less one', () => {
    expect(latest.generatedFolders).toEqual([
      'OptiScaler/hudless-diag',
      'fg-recordings',
      'dlssnr-capture',
      'OptiScaler/draw-diag',
      'OptiScaler/contact-dump',
      'OptiScaler/plate-probe',
      'OptiScaler/nr-vit-capture',
      'status.json',
      'status.lock',
    ])
  })

  it('tells a player on 2026.10.30 what v0.4.0 to v0.5.1 change: the HDR composition, the governor, the UI-free micro-stutter fix and the removed Companion keys', () => {
    const text = latest.changelog.join(' ')
    expect(text).toMatch(/LegacyComposition = true/)
    expect(text).toMatch(/Frame rate governor/)
    expect(text).toMatch(/micro-stutter/)
    expect(text).toMatch(/ProbeInterval = 1/)
    expect(text).toMatch(/Companion/)
  })

  it('keeps the character preview Neural Rendering off, as 2026.10.28 does', () => {
    expect(override(latest, 'PreviewNR')).toBe('false')
  })
})
