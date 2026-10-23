import { expect, it } from 'vitest'
import { createFakePlatform } from '../platform/fake'
import { gameWriteAccess, takeElevationResume } from './gameAccess'

const gameFolder = 'C:\\Games\\XIV'
const playerSid = 'S-1-5-21-100-200-300-1001'

it('captures the player SID before UAC and reuses it after another account elevates', async () => {
  const original = createFakePlatform({ readOnlyDirectories: [`${gameFolder}\\game`], userSid: playerSid })
  const access = gameWriteAccess(original, () => {})
  await expect(access({ kind: 'repair', gameFolder }, [])).resolves.toBe(false)
  const path = original.elevationRequests[0]
  const text = await original.readText(path)
  expect(JSON.parse(text)).toMatchObject({ schemaVersion: 2, userSid: playerSid })

  const elevated = createFakePlatform({
    elevated: true,
    userSid: 'S-1-5-21-999-999-999-500',
    elevationResumePath: path,
    files: { [path]: text },
  })
  await expect(takeElevationResume(elevated)).resolves.toMatchObject({ userSid: playerSid, request: { kind: 'repair', gameFolder } })
})

it('does not guess the player SID for a legacy resume without one', async () => {
  const path = 'C:\\Users\\Player\\AppData\\Local\\Lucent\\resume-123e4567-e89b-12d3-a456-426614174000.json'
  const platform = createFakePlatform({
    elevated: true,
    userSid: 'S-1-5-21-999-999-999-500',
    elevationResumePath: path,
    files: { [path]: JSON.stringify({ schemaVersion: 1, request: { kind: 'repair', gameFolder } }) },
  })
  await expect(takeElevationResume(platform)).resolves.toMatchObject({ userSid: null, request: { kind: 'repair', gameFolder } })
})
it.each(['profile', 'frame-generation', 'hdr'])('rejects a leftover %s request: Lucent no longer changes settings after deployment', async (kind) => {
  const path = 'C:\\Users\\Player\\AppData\\Local\\Lucent\\resume-123e4567-e89b-12d3-a456-426614174000.json'
  const platform = createFakePlatform({
    elevated: true,
    userSid: playerSid,
    elevationResumePath: path,
    files: { [path]: JSON.stringify({ schemaVersion: 2, userSid: playerSid, request: { kind, gameFolder, profile: 'balanced', mode: 'off' } }) },
  })
  await expect(takeElevationResume(platform)).rejects.toThrow(/administrator resume request is invalid/)
})

it('carries the player’s own profile folders, redirected ones included, through UAC', async () => {
  const env = { Documents: 'D:\\OneDrive\\Documents', Pictures: 'D:\\OneDrive\\Pictures', AppData: 'C:\\Users\\Player\\AppData\\Roaming' }
  const original = createFakePlatform({ readOnlyDirectories: [`${gameFolder}\\game`], userSid: playerSid, env })
  await gameWriteAccess(original, () => {})({ kind: 'repair', gameFolder }, [])
  const path = original.elevationRequests[0]
  const text = await original.readText(path)
  expect(JSON.parse(text).folders).toEqual(env)
  const elevated = createFakePlatform({ elevated: true, elevationResumePath: path, files: { [path]: text } })
  await expect(takeElevationResume(elevated)).resolves.toMatchObject({ folders: env })
})

it.each([
  ['a relative folder', { Documents: 'Documents' }],
  ['a folder that climbs out', { AppData: 'C:\\Users\\Player\\..\\Administrator\\AppData\\Roaming' }],
  ['a folder Lucent doesn’t carry', { ProgramFiles: 'C:\\Program Files' }],
])('rejects a resume request with %s', async (_, folders) => {
  const path = 'C:\\Users\\Player\\AppData\\Local\\Lucent\\resume-123e4567-e89b-12d3-a456-426614174000.json'
  const platform = createFakePlatform({
    elevated: true,
    elevationResumePath: path,
    files: { [path]: JSON.stringify({ schemaVersion: 2, userSid: playerSid, folders, request: { kind: 'repair', gameFolder } }) },
  })
  await expect(takeElevationResume(platform)).rejects.toThrow(/administrator resume request is invalid/)
})
