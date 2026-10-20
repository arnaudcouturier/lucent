import { describe, expect, it, vi } from 'vitest'
import { createCore } from './core'
import { configBaselines } from './configs'
import { createFakePlatform } from '../platform/fake'
import { graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { FIXTURE_ASSETS, TEST_MANIFEST, fixtureUrl } from '../platform/contentFixture'
import { MANIFEST_URL } from './manifest'
import { expandUserFolders } from './userFolders'
import type { Plan } from './planner'

const ROOT = 'C:\\Games\\XIV'
const SAVE_PATH = { kind: 'ini_set', file: 'ReShade.ini', section: 'SCREENSHOT', key: 'SavePath', value: '{Pictures}\\FFXIV Screenshots', when: 'reshade' } as const
/** The test content with ReShade's screenshot folder pointed into the player's Pictures folder, as the published content does. */
const WITH_SCREENSHOTS = { ...TEST_MANIFEST, versions: TEST_MANIFEST.versions.map((v) => ({ ...v, tiers: Object.fromEntries(Object.entries(v.tiers).map(([id, tier]) =>
  [id, { ...tier, recipe: [...tier.recipe, SAVE_PATH] }])) })) }

function screenshotMachine(env?: { Pictures: string }) {
  return machine(vanillaGame(ROOT), xivLauncher(ROOT), graphicsCard(), {
    ...(env ? { env } : {}),
    remoteText: { [MANIFEST_URL]: JSON.stringify(WITH_SCREENSHOTS), ...Object.fromEntries(Object.entries(FIXTURE_ASSETS).map(([hash, text]) => [fixtureUrl(hash), text])) },
  })
}

describe('{Pictures} in an ini value', () => {
  it('is the Pictures folder Windows reports, and nothing else changes', async () => {
    const platform = createFakePlatform(screenshotMachine({ Pictures: 'D:\\OneDrive\\Pictures' }))
    expect(await expandUserFolders(platform, '{Pictures}\\FFXIV Screenshots')).toBe('D:\\OneDrive\\Pictures\\FFXIV Screenshots')
    expect(await expandUserFolders(platform, '.\\')).toBe('.\\')
  })

  it('asks Windows only when the value names the folder', async () => {
    const platform = createFakePlatform(screenshotMachine())
    const asked = vi.spyOn(platform, 'envFolder')
    await expandUserFolders(platform, 'false')
    expect(asked).not.toHaveBeenCalled()
  })

  it.each([
    ['the default profile', undefined, 'C:\\Users\\Player\\Pictures'],
    ['a profile that redirects Pictures', { Pictures: 'D:\\OneDrive\\Pictures' }, 'D:\\OneDrive\\Pictures'],
  ])('is written into ReShade.ini on install for %s, and Uninstall puts the file back', async (_, env, pictures) => {
    const platform = createFakePlatform(screenshotMachine(env))
    const core = createCore(platform)
    await core.scan()
    await core.review(true)
    await core.deploy()
    expect(core.getState()).toMatchObject({ error: null, activity: { kind: 'done' } })
    expect(await platform.readText(`${ROOT}\\game\\ReShade.ini`)).toContain(`SavePath=${pictures}\\FFXIV Screenshots`)
    expect(await platform.readText(`${ROOT}\\game\\ReShade.ini`)).not.toContain('{Pictures}')
    core.finish()
    await core.uninstall()
    expect(core.getState().error).toBeNull()
    expect(await platform.listFiles(`${ROOT}\\game`)).not.toContain('ReShade.ini')
  })

  it('is resolved in the baseline an update or a repair writes', async () => {
    const platform = createFakePlatform(machine(vanillaGame(ROOT), { files: { 'C:\\cache\\abc': '[SCREENSHOT]\nSavePath=.\\\n' } }))
    const plan = {
      steps: [{ kind: 'copy', file: 'abc', to: 'ReShade.ini' }, SAVE_PATH],
      recipe: { ownedConfigs: [{ path: 'ReShade.ini', when: 'reshade' }] },
    } as unknown as Plan
    const baselines = await configBaselines(platform, 'C:\\cache', plan)
    expect(baselines.get('reshade.ini')).toContain('SavePath=C:\\Users\\Player\\Pictures\\FFXIV Screenshots')
  })
})
