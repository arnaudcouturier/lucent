import { describe, expect, it } from 'vitest'
import { scanGraphics } from './graphics'
import { createFakePlatform } from '../platform/fake'
import type { GpuAdapter } from './platform'

const GIB = 1024 ** 3
const adapter = (name: string, vendorId: number, dedicatedMemory: number, extra: Partial<GpuAdapter> = {}): GpuAdapter =>
  ({ name, vendorId, dedicatedMemory, software: false, ...extra })

describe('choosing the graphics card', () => {
  it('takes the card Windows ranks first for high performance over an integrated GPU with a bigger carve-out', async () => {
    const gpus = [
      adapter('AMD Radeon(TM) 780M Graphics', 0x1002, 16 * GIB, { highPerformanceRank: 1 }),
      adapter('NVIDIA GeForce RTX 4060 Laptop GPU', 0x10de, 8 * GIB, { highPerformanceRank: 0 }),
      adapter('Microsoft Basic Render Driver', 0x1414, 0, { software: true, highPerformanceRank: 2 }),
    ]
    await expect(scanGraphics(createFakePlatform({ gpus }))).resolves.toMatchObject({
      status: 'found', adapter: { name: 'NVIDIA GeForce RTX 4060 Laptop GPU' },
    })
  })

  it('never takes a software adapter, however Windows ranks it', async () => {
    const gpus = [
      adapter('Microsoft Basic Render Driver', 0x1414, 0, { software: true, highPerformanceRank: 0 }),
      adapter('Intel(R) UHD Graphics', 0x8086, 128 * 1024 ** 2, { highPerformanceRank: 1 }),
    ]
    await expect(scanGraphics(createFakePlatform({ gpus }))).resolves.toMatchObject({ adapter: { name: 'Intel(R) UHD Graphics' } })
    await expect(scanGraphics(createFakePlatform({ gpus: gpus.slice(0, 1) }))).resolves.toEqual({ status: 'not-found' })
  })

  it('falls back to the most dedicated memory when Windows gives no ranking', async () => {
    const gpus = [
      adapter('AMD Radeon(TM) Graphics', 0x1002, 512 * 1024 ** 2),
      adapter('NVIDIA GeForce RTX 4090', 0x10de, 24 * GIB),
      adapter('NVIDIA GeForce RTX 3060', 0x10de, 12 * GIB),
    ]
    await expect(scanGraphics(createFakePlatform({ gpus }))).resolves.toMatchObject({ adapter: { name: 'NVIDIA GeForce RTX 4090' } })
  })
})
