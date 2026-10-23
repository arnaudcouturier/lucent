// App updates: the newest Lucent release on GitHub, announced on the status card above content
// updates, downloaded and hash-checked before the running exe is renamed aside and replaced.
import { PlatformError, type Platform } from './platform'
import { joinPath } from './paths'
import type { Channel } from './updates'
import { maybeStat } from './deployment'

export const APP_RELEASES_URL = 'https://api.github.com/repos/arnaudcouturier/lucent/releases?per_page=100'
/** An app release's Lucent.exe is only ever downloaded from here, whatever the API response says. */
const APP_DOWNLOADS_URL = 'https://github.com/arnaudcouturier/lucent/releases/download'
/** The real Lucent.exe is under 5 MB; anything near this is not one. */
const MAX_APP_SIZE = 200 * 1024 * 1024

/** A published Lucent release the player can move to, with everything Update needs to verify it. */
export interface AppUpdate {
  version: string
  /** The release notes as plain text, one entry per line of the release body worth showing. */
  notes: string[]
  downloadUrl: string
  /** The SHA-256 the release asset's digest declares; the download must match it. */
  sha256: string
  size: number
  prerelease: boolean
}

interface RawAsset { name?: unknown; browser_download_url?: unknown; digest?: unknown; size?: unknown }
interface RawRelease { tag_name?: unknown; draft?: unknown; prerelease?: unknown; body?: unknown; assets?: unknown }

/** Compares two app versions, such as 0.1.0, 0.2.0 and 0.2.0-beta.1; a release outranks its betas. */
export function compareAppVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, beta] = v.split('-beta.')
    return { parts: core.split('.').map(Number), beta: beta === undefined ? null : Number(beta) }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.parts.length, y.parts.length); i++) {
    const diff = (x.parts[i] ?? 0) - (y.parts[i] ?? 0)
    if (diff) return diff
  }
  if (x.beta === null && y.beta === null) return 0
  if (x.beta === null) return 1
  if (y.beta === null) return -1
  return x.beta - y.beta
}

/**
 * A release body as plain lines: markdown markers removed, GitHub's generated "What's Changed" heading and
 * "Full Changelog" link left out, and "<title> by @author in <pull request link>" shortened to the title.
 */
function releaseNotes(body: string): string[] {
  const notes: string[] = []
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    if (/^#{1,6}\s*what['’]s changed\s*$/i.test(line)) continue
    const text = line
      .replace(/^#{1,6}(?:\s+|$)/, '')
      .replace(/^[*+-](?:\s+|$)/, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)\s]*\)/g, '$1')
      .replace(/\s+(?:by @[\w-]+(?:\[bot\])? )?in https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/, '')
      .trim()
    if (/^[\s*_#`-]*$/.test(text) || /^full changelog\s*:/i.test(text)) continue
    notes.push(text)
  }
  return notes
}

/** Reads the GitHub releases list, keeping only `app-vX.Y.Z` releases that ship a verifiable Lucent.exe. */
export function parseAppReleases(text: string): AppUpdate[] {
  let value: unknown
  try { value = JSON.parse(text) } catch { return [] }
  if (!Array.isArray(value)) return []
  const releases: AppUpdate[] = []
  for (const raw of value as RawRelease[]) {
    if (!raw || typeof raw.tag_name !== 'string') continue
    const match = /^app-v(\d+\.\d+\.\d+(?:-beta\.\d+)?)$/.exec(raw.tag_name)
    if (!match || raw.draft === true || !Array.isArray(raw.assets)) continue
    const asset = (raw.assets as RawAsset[]).find((a) => typeof a?.name === 'string' && a.name.toLowerCase() === 'lucent.exe')
    if (!asset || typeof asset.digest !== 'string') continue
    // The digest comes from the same response as the link, so the link must be the one this release's own tag has.
    const downloadUrl = `${APP_DOWNLOADS_URL}/${raw.tag_name}/Lucent.exe`
    if (asset.browser_download_url !== downloadUrl) continue
    const sha256 = asset.digest.replace(/^sha256:/, '').toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(sha256) || typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_APP_SIZE) continue
    const notes = typeof raw.body === 'string' ? releaseNotes(raw.body) : []
    releases.push({ version: match[1], notes, downloadUrl, sha256, size: asset.size, prerelease: raw.prerelease === true })
  }
  return releases
}

/** The newest release on the channel that is newer than the running app and isn't skipped. Beta sees pre-releases too. */
export function announcedAppUpdate(releases: readonly AppUpdate[], facts: { appVersion: string; skipped: readonly string[]; channel: Channel }): AppUpdate | null {
  return releases
    .filter((r) => (facts.channel === 'beta' || !r.prerelease && !r.version.includes('-')) && compareAppVersions(r.version, facts.appVersion) > 0 && !facts.skipped.includes(r.version))
    .sort((a, b) => compareAppVersions(b.version, a.version))[0] ?? null
}

/** Where the previous exe waits, beside the running one, until the next start cleans it up. */
export const oldExePath = (exePath: string) => `${exePath}.old`
const nextExePath = (exePath: string) => `${exePath}.lucent-new`
const updateRecordPath = (exePath: string) => `${exePath}.lucent-update.json`
interface UpdateRecord { oldHash: string; newHash: string }

/** Removes only files whose hashes match Lucent's update record; unrelated adjacent files stay. */
export async function cleanupOldExe(platform: Platform): Promise<void> {
  try {
    const exe = await platform.exePath()
    const record = JSON.parse(await platform.readText(updateRecordPath(exe))) as UpdateRecord | null
    if (!record || !/^[a-f0-9]{64}$/.test(record.oldHash) || !/^[a-f0-9]{64}$/.test(record.newHash)) return
    for (const [path, hash] of [[oldExePath(exe), record.oldHash], [nextExePath(exe), record.newHash]]) {
      const stat = await maybeStat(platform, path)
      if (!stat) continue
      if (stat.kind !== 'file' || await platform.hashFile(path) !== hash) return
      // The new process can start before the old image is released. Give that exit a brief grace period.
      for (let attempt = 0; ; attempt++) {
        try { await platform.removeFile(path); break }
        catch (error) {
          if (attempt >= 9 || !(error instanceof PlatformError) || !['locked', 'access-denied'].includes(error.kind)) throw error
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }
    }
    await platform.removeFile(updateRecordPath(exe))
  } catch { /* A locked or changed leftover stays; the next start retries. */ }
}

/**
 * Downloads the new exe into Lucent's data folder and checks its SHA-256 against the release
 * asset's digest before anything is replaced: a mismatch aborts with the running exe untouched.
 * Only then is the running exe renamed aside, the new one written in its place, and Lucent relaunched.
 */
export async function performAppUpdate(platform: Platform, update: AppUpdate, progress: (fraction: number) => void = () => {}): Promise<void> {
  const exe = await platform.exePath()
  const staging = joinPath(await platform.envFolder('LocalAppData'), 'Lucent', 'update', 'Lucent.exe.download')
  await platform.downloadFile(update.downloadUrl, staging, (received) => progress(Math.min(0.9, received / Math.max(1, update.size) * 0.9)))
  const hash = await platform.hashFile(staging)
  if (hash !== update.sha256) {
    await platform.removeFile(staging).catch(() => {})
    throw new PlatformError('hash-mismatch', 'The downloaded Lucent update failed its hash check. Nothing was replaced.', staging)
  }
  const old = oldExePath(exe)
  const next = nextExePath(exe)
  const recordPath = updateRecordPath(exe)
  await cleanupOldExe(platform)
  for (const path of [old, next, recordPath]) {
    if (await maybeStat(platform, path)) throw new Error(`An update file already exists at ${path}. Move it aside before trying again.`)
  }
  const record: UpdateRecord = { oldHash: await platform.hashFile(exe), newHash: update.sha256 }
  const recordStaging = `${staging}.json`
  await platform.writeText(recordStaging, JSON.stringify(record))
  await platform.copyFile(recordStaging, recordPath, false)
  await platform.removeFile(recordStaging).catch(() => {})
  let prepared = false
  let moved = false
  let replaced = false
  try {
    // Prepare on the exe's volume before touching the running image; the final swap is two renames.
    await platform.copyFile(staging, next, false)
    prepared = true
    if (await platform.hashFile(next) !== update.sha256) throw new PlatformError('hash-mismatch', 'The prepared Lucent update failed its hash check. Nothing was replaced.', next)
    progress(0.95)
    await platform.renameFile(exe, old, false)
    moved = true
    await platform.renameFile(next, exe, false)
    replaced = true
    await platform.removeFile(staging).catch(() => {})
    progress(1)
    await platform.launchExe(exe)
  } catch (error) {
    try {
      if (moved) {
        if (replaced) await platform.removeFile(exe)
        await platform.renameFile(old, exe, false)
      }
    } catch (restoreError) {
      throw new Error(`${error instanceof Error ? error.message : String(error)} Could not restore Lucent: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}. The previous executable is at ${old}.`)
    }
    if (prepared && !replaced) await platform.removeFile(next).catch(() => {})
    await platform.removeFile(recordPath).catch(() => {})
    throw error
  }
}
