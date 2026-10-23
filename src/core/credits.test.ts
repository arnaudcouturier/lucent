import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { creditsVersion } from './credits'
import { MANIFEST_URL } from './manifest'
import { createFakePlatform } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { TEST_CONTENT, TEST_MANIFEST } from '../platform/contentFixture'

const ROOT = 'C:\\Games\\XIV'

/** A game folder deployed from the fixture content, then reopened with the manifest the host serves now (null: unreachable). */
async function reopened(manifestText: string | null) {
  const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))
  const platform = createFakePlatform(m)
  const first = createCore(platform)
  await first.scan()
  await first.review()
  await first.deploy()
  if (manifestText === null) delete m.remoteText![MANIFEST_URL]
  else m.remoteText![MANIFEST_URL] = manifestText
  const core = createCore(platform)
  await core.scan()
  const state = core.getState()
  return { state, version: creditsVersion(state.manifest, state.deployment, state.deployment?.tier ?? null, 'stable') }
}

describe('the components Credits lists for the deployed content', () => {
  it('come from the live manifest while it is published', async () => {
    const { version } = await reopened(JSON.stringify(TEST_MANIFEST))
    expect(version).toMatchObject({ id: TEST_CONTENT.id, components: TEST_CONTENT.components })
  })

  it('come from the copy kept with the deployment when the manifest cannot be fetched', async () => {
    const { state, version } = await reopened(null)
    expect(state.manifest.status).not.toBe('ready')
    expect(state.deployment?.cachedVersions?.[0].content.id).toBe(TEST_CONTENT.id)
    expect(version).toMatchObject({ id: TEST_CONTENT.id, components: TEST_CONTENT.components })
  })

  it('come from that copy too when the version is no longer in the manifest', async () => {
    const { state, version } = await reopened(JSON.stringify({ ...TEST_MANIFEST, versions: [] }))
    expect(state.manifest.status).toBe('ready')
    expect(version).toMatchObject({ id: TEST_CONTENT.id, components: TEST_CONTENT.components })
  })

  it('are absent for a deployment recorded before copies were kept, when the manifest cannot be fetched', async () => {
    const { state } = await reopened(null)
    const older = { ...state.deployment!, cachedVersions: undefined }
    expect(creditsVersion(state.manifest, older, older.tier, 'stable')).toBeNull()
  })

  it('are never taken from a copy of another version', async () => {
    const { state } = await reopened(null)
    const other = { ...state.deployment!, contentVersion: '2026.12.01' }
    expect(creditsVersion(state.manifest, other, other.tier, 'stable')).toBeNull()
  })

  it('before any deployment still need a manifest', async () => {
    const { state } = await reopened(null)
    expect(creditsVersion(state.manifest, null, null, 'stable')).toBeNull()
  })
})
