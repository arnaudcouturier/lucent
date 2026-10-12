import { expect, it } from 'vitest'
import manifest from '../../manifest.json'
import { parseManifest, type Manifest } from './manifest'
import { PROFILE_MANIFEST } from '../platform/contentFixture'

it('retains content versions and validates recipe paths before deployment', () => {
  const version = {
    id: '2026.10.12', channel: 'stable', minAppVersion: '0.1.0', changelog: ['First content'],
    components: [{ name: 'Test component', upstream: 'Test author', licence: 'MIT', source: 'https://example.com/source' }],
    files: [{ sha256: 'a'.repeat(64), size: 12, release: 'content-2026.10.12' }],
    tiers: { other: { recipe: [{ kind: 'copy', file: 'a'.repeat(64), to: 'dxgi.dll' }], entryFiles: [{ path: 'dxgi.dll' }], ownedConfigs: [], shippedPresets: [], generatedFiles: [], overlay: null } },
  }
  const text = JSON.stringify({ ...manifest, schemaVersion: 2, versions: [version] })
  expect(parseManifest(text)).toMatchObject({ versions: [version] })
  version.tiers.other.recipe[0].to = '../ffxiv_dx11.exe'
  expect(() => parseManifest(JSON.stringify({ ...manifest, schemaVersion: 2, versions: [version] }))).toThrow(/path/i)
})

it.each(['../file', '..\\file', '/file', '\\file', 'C:\\file', 'file:stream', 'NUL.ini', 'COM1.dll', 'COM¹.dll', 'LPT².ini', 'folder./file', 'file ', 'folder//file'])('rejects a Windows path escape or alias: %s', (path) => {
  const content = {
    id: '2026.10.12', channel: 'stable', minAppVersion: '0.1.0', changelog: [], components: [],
    files: [{ sha256: 'a'.repeat(64), size: 1, release: 'content-2026.10.12' }],
    tiers: { other: { recipe: [{ kind: 'copy', file: 'a'.repeat(64), to: path }], entryFiles: [{ path: 'dxgi.dll' }], ownedConfigs: [], shippedPresets: [], generatedFiles: [], overlay: null } },
  }
  expect(() => parseManifest(JSON.stringify({ ...manifest, versions: [content] }))).toThrow(/path/i)
})

const profileContent = () => structuredClone(PROFILE_MANIFEST)
const nvidia = (m: Manifest) => m.versions[0].tiers['rtx-30-40']

it('requires an ini_set step on a conditional config to share its condition', () => {
  const m = profileContent()
  nvidia(m).recipe.push({ kind: 'ini_set', file: 'ReShade.ini', section: 'GENERAL', key: 'PresetPath', value: '' })
  expect(() => parseManifest(JSON.stringify(m))).toThrow(/condition/)
  nvidia(m).recipe.at(-1)!.when = 'reshade'
  expect(() => parseManifest(JSON.stringify(m))).not.toThrow()
})

it.each(['label', 'description'] as const)('rejects a profile %s that is not a single line', (field) => {
  const m = profileContent()
  nvidia(m).performanceProfiles![0][field] = 'Two passes\nfor more detail.'
  expect(() => parseManifest(JSON.stringify(m))).toThrow(/single line/)
})

it('orders profiles Fidelity, Balanced, Performance whatever the manifest order', () => {
  const m = profileContent()
  nvidia(m).performanceProfiles!.reverse()
  expect(nvidia(parseManifest(JSON.stringify(m))).performanceProfiles!.map((p) => p.id)).toEqual(['fidelity', 'balanced', 'performance'])
})
