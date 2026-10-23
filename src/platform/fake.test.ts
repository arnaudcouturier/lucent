import { describe, expect, it } from 'vitest'
import { createFakePlatform, FAKE_FREE_SPACE } from './fake'

const CONFIG = 'C:\\Users\\Player\\AppData\\Roaming\\XIVLauncher\\dalamudConfig.json'

describe('fake platform', () => {
  it('reports the read-only attribute in stat, and a replacement clears it like the real port', async () => {
    const platform = createFakePlatform({ files: { [CONFIG]: '{}', 'C:\\Games\\other.json': '{}' }, readOnlyFiles: [CONFIG] })
    await expect(platform.stat(CONFIG)).resolves.toMatchObject({ kind: 'file', readOnly: true })
    await expect(platform.stat(CONFIG.toUpperCase())).resolves.toMatchObject({ readOnly: true })
    await expect(platform.stat('C:\\Games\\other.json')).resolves.toMatchObject({ readOnly: false })
    await expect(platform.statMany([CONFIG, 'C:\\Games\\missing.json'])).resolves.toMatchObject([{ readOnly: true }, null])
    await expect(platform.stat('C:\\Games')).resolves.toEqual({ kind: 'dir', size: 0, modifiedMs: 0, readOnly: false })
    await platform.writeText(CONFIG, '{"ThirdRepoList":[]}')
    await expect(platform.stat(CONFIG)).resolves.toMatchObject({ readOnly: false })
  })

  it('tells another process running an exe by its full path from one with the same name, and never counts itself', async () => {
    const installed = 'C:\\Users\\Player\\AppData\\Local\\Lucent\\Lucent.exe'
    const platform = createFakePlatform({ exePath: installed, processes: ['XIVLauncher.exe', 'C:\\Users\\Player\\Downloads\\Lucent.exe'] })
    // Only this process runs the installed copy, and a copy elsewhere is another file.
    await expect(platform.isExeRunningElsewhere(installed)).resolves.toBe(false)
    await expect(platform.isProcessRunning('lucent.exe')).resolves.toBe(true)
    const withWindow = createFakePlatform({ exePath: installed, processes: [installed] })
    await expect(withWindow.isExeRunningElsewhere(installed.toUpperCase())).resolves.toBe(true)
    await expect(withWindow.isExeRunningElsewhere(installed.replace(/\\/g, '/'))).resolves.toBe(true)
    await expect(withWindow.isExeRunningElsewhere('C:\\Users\\Player\\AppData\\Local\\Lucent')).resolves.toBe(false)
    await expect(withWindow.isProcessRunning('Lucent.exe')).resolves.toBe(true)
  })

  it('reads free space by drive, for folders that don’t exist yet too, and plenty for a drive it doesn’t list', async () => {
    const platform = createFakePlatform({ freeSpace: { 'C:': 2_000_000, 'E:': null } })
    await expect(platform.freeSpace('C:\\Users\\Player\\AppData\\Local\\Lucent\\cache')).resolves.toBe(2_000_000)
    await expect(platform.freeSpace('c:/not/there/yet')).resolves.toBe(2_000_000)
    await expect(platform.freeSpace('D:\\SteamLibrary')).resolves.toBe(FAKE_FREE_SPACE)
    // Unreadable, as the real port reports a drive or share it can't ask.
    await expect(platform.freeSpace('E:\\Games')).resolves.toBeNull()
    await expect(platform.freeSpace('\\\\server\\share\\XIV')).resolves.toBeNull()
    await expect(platform.freeSpace('Games\\XIV')).resolves.toBeNull()
    expect(await createFakePlatform().freeSpace('C:\\Games')).toBe(FAKE_FREE_SPACE)
  })

  it('opens only a folder that exists, as the real port does, and records it as asked', async () => {
    const platform = createFakePlatform({ files: { [CONFIG]: '{}' }, directories: ['D:\\Empty folder'] })
    await platform.openFolder('C:\\Users\\Player\\AppData\\Roaming\\XIVLauncher')
    await platform.openFolder('D:\\Empty folder')
    expect(platform.openedFolders).toEqual(['C:\\Users\\Player\\AppData\\Roaming\\XIVLauncher', 'D:\\Empty folder'])
    await expect(platform.openFolder('C:\\Users\\Player\\AppData\\Roaming\\Gone')).rejects.toMatchObject({ kind: 'not-found' })
    // A file is refused, and so is every path that isn't `X:\…`, even one naming a folder that is there.
    await expect(platform.openFolder(CONFIG)).rejects.toMatchObject({ kind: 'unknown' })
    for (const path of ['\\\\server\\share', '\\\\?\\D:\\Empty folder', '\\\\.\\D:\\Empty folder', 'D:Empty folder', '\\Empty folder', 'D:\\Empty folder\\..\\Empty folder']) {
      await expect(platform.openFolder(path), path).rejects.toMatchObject({ kind: 'access-denied' })
    }
    expect(platform.openedFolders).toHaveLength(2)
  })
})
