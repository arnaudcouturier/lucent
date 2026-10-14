import { expect, it } from 'vitest'
import { createFakePlatform } from './fake'

const dataFolder = 'C:\\Users\\Player\\AppData\\Local\\Lucent'

it('excludes a second process using the same data folder until the first operation finishes', async () => {
  const operationLocks = new Set<string>()
  const first = createFakePlatform({ operationLocks })
  const second = createFakePlatform({ operationLocks })
  const token = await first.acquireOperationLock(dataFolder)
  await expect(second.acquireOperationLock(dataFolder.toUpperCase().replace(/\\/g, '/'))).rejects.toMatchObject({ kind: 'locked' })
  await expect(second.releaseOperationLock(token)).rejects.toMatchObject({ kind: 'unknown' })
  await expect(second.acquireOperationLock(dataFolder)).rejects.toMatchObject({ kind: 'locked' })
  await first.releaseOperationLock(token)
  const next = await second.acquireOperationLock(dataFolder)
  await second.releaseOperationLock(next)
  expect(await first.listFiles('C:\\Users\\Player\\AppData\\Local')).toEqual(['lucent\\operation.lock'])
})

it('releases a stopped process without letting its returning fake finally block release another process', async () => {
  const operationLocks = new Set<string>()
  const first = createFakePlatform({ operationLocks })
  const second = createFakePlatform({ operationLocks })
  const third = createFakePlatform({ operationLocks })
  const ended = await first.acquireOperationLock(dataFolder)
  await first.exit()
  const active = await second.acquireOperationLock(dataFolder)
  await first.releaseOperationLock(ended)
  await expect(third.acquireOperationLock(dataFolder)).rejects.toMatchObject({ kind: 'locked' })
  await second.releaseOperationLock(active)
})

it('reset drops only this process leases, so a reloaded webview can acquire again', async () => {
  const operationLocks = new Set<string>()
  const first = createFakePlatform({ operationLocks })
  const second = createFakePlatform({ operationLocks })
  const orphaned = await first.acquireOperationLock(dataFolder)
  // A fresh webview in another process must not free the first process's live lease.
  await second.resetOperationLocks()
  await expect(second.acquireOperationLock(dataFolder)).rejects.toMatchObject({ kind: 'locked' })
  // The reloaded webview's own process drops its orphaned lease, then works normally;
  // the orphaned token's late release must not free the new lease.
  await first.resetOperationLocks()
  const next = await first.acquireOperationLock(dataFolder)
  await first.releaseOperationLock(orphaned)
  await expect(second.acquireOperationLock(dataFolder)).rejects.toMatchObject({ kind: 'locked' })
  await first.releaseOperationLock(next)
})

it('keeps separate players independent and rejects relative data folders', async () => {
  const platform = createFakePlatform()
  const first = await platform.acquireOperationLock(dataFolder)
  const second = await platform.acquireOperationLock('C:\\Users\\Other\\AppData\\Local\\Lucent')
  await expect(platform.acquireOperationLock('Lucent')).rejects.toMatchObject({ kind: 'unknown' })
  await platform.releaseOperationLock(first)
  await platform.releaseOperationLock(second)
})
