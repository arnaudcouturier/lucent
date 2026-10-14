import { expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform } from '../platform/fake'
import { graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { MANIFEST_URL } from './manifest'
import { TEST_MANIFEST } from '../platform/contentFixture'
import type { ContentVersion } from '../shared/manifest'

const ROOT = 'C:\\Games\\XIV'
const FILES = 1000

async function sha256(text: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A content version the size of the real one: a thousand shader files in nested folders. */
async function largeMachine() {
  const texts = Array.from({ length: FILES }, (_, i) => `shader ${i}`)
  const hashes = await Promise.all(texts.map(sha256))
  const content: ContentVersion = {
    ...TEST_MANIFEST.versions[0],
    files: hashes.map((sha256, i) => ({ sha256, size: texts[i].length, release: 'content-2026.10.12' })),
    tiers: { 'rtx-30-40': {
      recipe: hashes.map((file, i) => ({ kind: 'copy' as const, file, to: i === 0 ? 'winmm.dll' : `reshade-shaders/Shaders/Pack${i % 12}/Effect${i}.fx` })),
      entryFiles: [{ path: 'winmm.dll' }], ownedConfigs: [], shippedPresets: [], generatedFiles: [], overlay: 'neural-rendering',
    } },
  }
  const remoteText: Record<string, string> = { [MANIFEST_URL]: JSON.stringify({ ...TEST_MANIFEST, versions: [content] }) }
  hashes.forEach((hash, i) => { remoteText[`https://github.com/arnaudcouturier/lucent/releases/download/content-2026.10.12/${hash}`] = texts[i] })
  return machine(vanillaGame(ROOT), xivLauncher(ROOT), graphicsCard(), { remoteText })
}

/** Counts the port calls the core makes. A batch counts once: the real port answers it in one round trip. */
function counting(platform: FakePlatform) {
  const calls = new Map<string, number>()
  const counted = new Proxy(platform, { get(target, key) {
    const value = Reflect.get(target, key)
    if (typeof value !== 'function' || typeof key !== 'string') return value
    return (...args: unknown[]) => { calls.set(key, (calls.get(key) ?? 0) + 1); return value.apply(target, args) }
  } })
  const total = (except: string[] = []) => [...calls].filter(([key]) => !except.includes(key)).reduce((sum, [, n]) => sum + n, 0)
  return { counted, calls, total, reset: () => calls.clear() }
}

// Each round trip costs about half a millisecond and each game check about 6 ms on the real port. Per file, a
// thousand-file install used to make over fifteen thousand round trips and two thousand game checks.
it('installs and uninstalls a thousand files in a few hundred round trips', async () => {
  const platform = createFakePlatform(await largeMachine())
  const { counted, calls, total, reset } = counting(platform)
  const core = createCore(counted)
  await core.scan()
  await core.review()
  reset()
  await core.deploy()
  expect(core.getState()).toMatchObject({ error: null, activity: { kind: 'done' } })
  // Downloads are one call per file by nature, and run eight at a time.
  expect(total(['downloadFile'])).toBeLessThan(400)
  expect(calls.get('isGameRunning') ?? 0).toBeLessThan(60)
  expect(calls.get('writeText') ?? 0).toBeLessThan(40)

  core.finish()
  reset()
  await core.uninstall()
  expect(core.getState().error).toBeNull()
  expect(await platform.listFiles(`${ROOT}\\game`)).toEqual(['ffxiv_dx11.exe', 'ffxivgame.ver'])
  // The uninstall itself, then the Scan that follows it.
  expect(total()).toBeLessThan(250)
  expect(calls.get('isGameRunning') ?? 0).toBeLessThan(60)
}, 30_000)

it('updates to a version that drops nine in ten files in a few hundred round trips', async () => {
  const m = await largeMachine()
  const platform = createFakePlatform(m)
  const setup = createCore(platform)
  await setup.scan()
  await setup.review()
  await setup.deploy()
  setup.finish()
  // The next version keeps a tenth of the files, as when unused shaders stop being shipped.
  const manifest = JSON.parse(m.remoteText![MANIFEST_URL])
  const current: ContentVersion = manifest.versions[0]
  const recipe = current.tiers['rtx-30-40'].recipe.filter((_, i) => i % 10 === 0)
  const kept = new Set(recipe.map((step) => step.kind === 'copy' ? step.file : ''))
  const next: ContentVersion = { ...current, id: '2026.11.02', files: current.files.filter((f) => kept.has(f.sha256)), tiers: { 'rtx-30-40': { ...current.tiers['rtx-30-40'], recipe } } }
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...manifest, versions: [current, next] })
  const { counted, calls, total } = counting(platform)
  const core = createCore(counted)
  await core.scan()
  expect(core.getState().activity).toMatchObject({ kind: 'deployment', update: { version: '2026.11.02' } })
  calls.clear()
  await core.update()
  expect(core.getState()).toMatchObject({ error: null, deployment: { contentVersion: '2026.11.02' } })
  expect((await platform.listFiles(`${ROOT}\\game`)).length).toBe(102)
  expect(total()).toBeLessThan(300)
  expect(calls.get('isGameRunning') ?? 0).toBeLessThan(60)
}, 30_000)
