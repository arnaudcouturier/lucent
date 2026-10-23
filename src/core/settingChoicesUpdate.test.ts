import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform, type Machine } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, nextContentHost, vanillaGame, xivLauncher } from '../platform/fixtures'
import { NEXT_CONTENT, NEXT_MANIFEST, SETTING_CHOICES, nextFixtureUrl } from '../platform/contentFixture'
import type { ContentVersion } from '../shared/manifest'
import { MANIFEST_URL } from './manifest'
import { readDeployment } from './deployment'
import { collectDiagnostics } from './diagnostics'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`
const CONFIG = `${GAME}\\OptiScaler.ini`

async function deployed(gpu = 'NVIDIA GeForce RTX 4090') {
  const m = machine(fixtureContentHost(), graphicsCard(gpu), vanillaGame(ROOT), xivLauncher(ROOT))
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  expect(core.getState().error).toBeNull()
  core.finish()
  return { platform, m }
}

async function reopen(platform: FakePlatform) {
  const core = createCore(platform)
  await core.scan()
  return core
}

/** Publishes the next version with the UI mode and DLSS-G preset choices added to the tier. */
function publishWithChoices(m: Machine): ContentVersion {
  const variant = structuredClone(NEXT_CONTENT)
  variant.tiers['rtx-20-30-40'].settingChoices = structuredClone(SETTING_CHOICES)
  Object.assign(m.remoteText!, nextContentHost().remoteText)
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...NEXT_MANIFEST, versions: [NEXT_MANIFEST.versions[0], variant] })
  for (const [hash] of Object.entries({})) m.remoteText![nextFixtureUrl(hash)] = ''
  return variant
}

const tune = async (platform: FakePlatform, mode: string, preset = '3') => {
  await platform.writeText(CONFIG, `${await platform.readText(CONFIG)}\n[HudLess]\nMode=${mode}\n[DLSSG]\nRenderPreset=${preset}\n`)
}

describe('an update to content that gains setting choices', () => {
  it.each([
    ['an RTX 4090', 'NVIDIA GeForce RTX 4090'],
    ['an RTX 3080', 'NVIDIA GeForce RTX 3080'],
  ])('keeps the ini of %s as the player has it, and records no picks that were never written', async (_, gpu) => {
    const { platform, m } = await deployed(gpu)
    await tune(platform, 'off')
    publishWithChoices(m)
    const core = await reopen(platform)
    await core.update()
    expect(core.getState().error).toBeNull()
    expect(core.getState().deployment?.contentVersion).toBe('2026.11.02')
    const text = await platform.readText(CONFIG)
    expect(text).toMatch(/\[HudLess\]\r?\nMode=off/)
    expect(text).toMatch(/\[DLSSG\]\r?\nRenderPreset=3/)
    const record = await readDeployment(platform, ROOT)
    expect(record?.settingChoices).toEqual({})
    expect(record?.recipe.settingChoices?.map((c) => c.id)).toEqual(['ui-mode', 'dlssg-preset'])
  })

  it('names no choices on Done or in the diagnostics for a deployment whose picks were never written', async () => {
    const { platform, m } = await deployed()
    publishWithChoices(m)
    const core = await reopen(platform)
    await core.update()
    expect(core.getState().settingChoices).toEqual({})
    const diagnostics = await collectDiagnostics(platform, core.getState(), '0.3.0-beta.10', 'beta')
    expect(diagnostics).toMatch(/profile/i)
    expect(diagnostics).not.toContain('UI mode')
    expect(diagnostics).not.toContain('DLSS-G preset')
  })

  it('rolls back to the earlier version and applies the new one again from the cache', async () => {
    const { platform, m } = await deployed()
    const first = (await readDeployment(platform, ROOT))!.contentVersion
    publishWithChoices(m)
    const core = await reopen(platform)
    await core.update()
    expect(core.getState().error).toBeNull()
    await core.applyVersion(first)
    expect(core.getState().error).toBeNull()
    expect(core.getState().deployment?.contentVersion).toBe(first)
    await core.applyVersion('2026.11.02')
    expect(core.getState().error).toBeNull()
    expect(core.getState().deployment).toMatchObject({ contentVersion: '2026.11.02', recipe: { settingChoices: [{ id: 'ui-mode' }, { id: 'dlssg-preset' }] } })
  })
})
