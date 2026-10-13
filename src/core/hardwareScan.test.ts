import { describe, expect, it } from 'vitest'
import manifest from '../../manifest.json'
import { createCore } from './core'
import { createFakePlatform } from '../platform/fake'
import { machine, steam, steamGameFolder, vanillaGame, xivLauncher } from '../platform/fixtures'

const GIB = 1024 ** 3
const MANIFEST_URL = 'https://raw.githubusercontent.com/arnaudcouturier/lucent/main/manifest.json'

describe('Scan shows the graphics card and its tier', () => {
  it('chooses the RTX 4090 alongside an AMD iGPU and ignores software adapters', async () => {
    const core = createCore(createFakePlatform({
      gpus: [
        { name: 'AMD Radeon(TM) Graphics', vendorId: 0x1002, dedicatedMemory: 512 * 1024 ** 2, software: false },
        { name: 'Microsoft Basic Render Driver', vendorId: 0x1414, dedicatedMemory: 64 * GIB, software: true },
        { name: 'NVIDIA GeForce RTX 4090', vendorId: 0x10de, dedicatedMemory: 24 * GIB, software: false },
      ],
      remoteText: { [MANIFEST_URL]: JSON.stringify(manifest) },
    }))

    await core.scan()

    expect(core.getState().graphics).toMatchObject({
      status: 'found',
      adapter: { name: 'NVIDIA GeForce RTX 4090' },
      tier: { id: 'rtx-30-40', label: 'RTX 30/40', status: 'stable', neuralRendering: true, requiresReShade: false },
    })
  })

  it.each([
    ['NVIDIA GeForce RTX 5090', 0x10de, 'rtx-50', 'community-verified', true, false],
    ['NVIDIA GeForce RTX 3080 Ti', 0x10de, 'rtx-30-40', 'stable', true, false],
    ['nvidia geforce rtx 2080 SUPER', 0x10de, 'rtx-20', 'experimental', true, false],
    ['AMD Radeon RX 7900 XTX', 0x1002, 'radeon', 'experimental', false, true],
    ['Intel Arc A770 Graphics', 0x8086, 'other', 'stable', false, true],
    ['NVIDIA GeForce GTX 1080', 0x10de, 'other', 'stable', false, true],
    ['RTX 4090', 0x8086, 'other', 'stable', false, true],
  ])('matches %s using the PCI vendor and device name', async (name, vendorId, id, status, neuralRendering, requiresReShade) => {
    const core = createCore(createFakePlatform({
      gpus: [{ name, vendorId, dedicatedMemory: 8 * GIB, software: false }],
      remoteText: { [MANIFEST_URL]: JSON.stringify(manifest) },
    }))

    await core.scan()

    expect(core.getState().graphics).toMatchObject({ status: 'found', tier: { id, status, neuralRendering, requiresReShade } })
  })

  it('uses the first matching tier in the manifest, including its labels and capabilities', async () => {
    const changed = {
      ...manifest,
      tiers: [{ ...manifest.tiers[0], id: 'custom', label: 'Tested RTX', status: 'experimental', gpuMatch: [{ vendorId: 4318, deviceNamePatterns: ['RTX'] }], neuralRendering: false }, ...manifest.tiers],
    }
    const core = createCore(createFakePlatform({
      gpus: [{ name: 'NVIDIA GeForce RTX 4090', vendorId: 0x10de, dedicatedMemory: 24 * GIB, software: false }],
      remoteText: { [MANIFEST_URL]: JSON.stringify(changed) },
    }))

    await core.scan()

    expect(core.getState().graphics).toMatchObject({ tier: { id: 'custom', label: 'Tested RTX', status: 'experimental', neuralRendering: false } })
  })

  it('reports no graphics card when only software adapters are available', async () => {
    const core = createCore(createFakePlatform({ gpus: [{ name: 'Software Adapter', vendorId: 0, dedicatedMemory: 64 * GIB, software: true }] }))

    await core.scan()

    expect(core.getState().graphics).toEqual({ status: 'not-found' })
  })

  it.each([
    ['newer schema', '{"schemaVersion":3}', 'update-required'],
    ['invalid manifest', '{"schemaVersion":1,"tiers":[]}', 'invalid'],
  ])('keeps the graphics card but refuses its tier for a %s', async (_, text, status) => {
    const core = createCore(createFakePlatform({
      gpus: [{ name: 'NVIDIA GeForce RTX 4090', vendorId: 0x10de, dedicatedMemory: 24 * GIB, software: false }],
      remoteText: { [MANIFEST_URL]: text },
    }))

    await core.scan()

    expect(core.getState().manifest).toMatchObject({ status })
    expect(core.getState().graphics).toMatchObject({ status: 'found', tier: null })
  })

  it('reports a manifest fetch failure without guessing a tier', async () => {
    const core = createCore(createFakePlatform({ gpus: [{ name: 'Intel Arc A770', vendorId: 0x8086, dedicatedMemory: 8 * GIB, software: false }] }))

    await core.scan()

    expect(core.getState().manifest).toMatchObject({ status: 'unavailable' })
    expect(core.getState().graphics).toMatchObject({ status: 'found', tier: null })
  })

  it('reads a dev manifest locally and carries its local files directory without contacting GitHub', async () => {
    const core = createCore(createFakePlatform({
      devContent: { manifestPath: 'C:\\Dev\\manifest.json', filesDirectory: 'C:\\Dev\\files' },
      files: { 'C:\\Dev\\manifest.json': JSON.stringify({ ...manifest, versions: [], tiers: [{ ...manifest.tiers.at(-1), label: 'Local tier' }] }) },
      gpus: [{ name: 'NVIDIA GeForce RTX 4090', vendorId: 0x10de, dedicatedMemory: 24 * GIB, software: false }],
      // No fake release host: a network fetch would fail.
    }))

    await core.scan()

    expect(core.getState().graphics).toMatchObject({ status: 'found', tier: { label: 'Local tier' } })
    expect(core.getState().manifest).toMatchObject({
      status: 'ready', source: { kind: 'local', manifestPath: 'C:\\Dev\\manifest.json', filesDirectory: 'C:\\Dev\\files' },
    })
  })
})

describe('Scan reports XIVLauncher independently of the game folder', () => {
  it('finds XIVLauncher even when its configured game folder has moved', async () => {
    const core = createCore(createFakePlatform(machine(
      xivLauncher('C:\\Old\\XIV'), steam({ libraries: ['D:\\Steam'], game: 'D:\\Steam' }), vanillaGame(steamGameFolder('D:\\Steam')),
    )))

    await core.scan()

    expect(core.getState().xivLauncher).toMatchObject({ status: 'found', configPath: 'C:\\Users\\Player\\AppData\\Roaming\\XIVLauncher\\launcherConfigV3.json' })
    expect(core.getState().gameFolder).toMatchObject({ status: 'found', source: 'steam' })
  })

  it('reports XIVLauncher as absent when there is no config', async () => {
    const core = createCore(createFakePlatform())

    await core.scan()

    expect(core.getState().xivLauncher).toEqual({ status: 'not-found' })
  })

  it('still recognizes XIVLauncher when its config cannot be parsed', async () => {
    const core = createCore(createFakePlatform({ files: { 'C:\\Users\\Player\\AppData\\Roaming\\XIVLauncher\\launcherConfigV3.json': '{' } }))

    await core.scan()

    expect(core.getState().xivLauncher).toMatchObject({ status: 'found' })
  })
})
