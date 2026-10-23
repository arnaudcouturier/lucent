// Existing setups: mod files Lucent did not deploy, matched against the manifest's signatures.
import type { ExistingSetupSignature } from '../shared/manifest'
import { fileKey, isSafeGamePath } from './planner'

export interface ExistingSetup {
  id: string
  label: string
  /** Backed up and removed by the deployment. */
  files: string[]
  /** Carried over into Lucent's preset folder as user files. */
  presets: string[]
  /** Left in place, such as its shaders, unless the deployment ships a file at the same path. */
  kept: string[]
}

const segment = (pattern: string) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)

/** `*` matches within one folder name; `**` matches any number of folders. Case-insensitive, either slash. */
export function matchesPattern(pattern: string, path: string): boolean {
  const p = fileKey(pattern).split('/')
  const s = fileKey(path).split('/')
  const match = (i: number, j: number): boolean => {
    if (i === p.length) return j === s.length
    if (p[i] === '**') return match(i + 1, j) || (j < s.length - 1 && match(i, j + 1))
    return j < s.length && segment(p[i]).test(s[j]) && match(i + 1, j + 1)
  }
  return match(0, 0)
}

/**
 * Matches the signatures against the game folder's files, in manifest order. Each file belongs to the first setup
 * found that claims it. Lucent's own deployed files are never part of an existing setup, nor is a file it can't name safely.
 */
export function detectExistingSetups(signatures: ExistingSetupSignature[], files: string[], owned: string[] = []): ExistingSetup[] {
  const ownedKeys = new Set(owned.map(fileKey))
  const claimed = new Set<string>()
  const candidates = files.filter((f) => !ownedKeys.has(fileKey(f)) && isSafeGamePath(f))
  const found: ExistingSetup[] = []
  for (const signature of signatures) {
    if (!candidates.some((f) => signature.markers.some((m) => matchesPattern(m, f)))) continue
    const unclaimed = candidates.filter((f) => !claimed.has(fileKey(f)))
    const matching = (patterns: string[]) => unclaimed.filter((f) => patterns.some((p) => matchesPattern(p, f)))
    const setup = { id: signature.id, label: signature.label, files: matching(signature.files), presets: matching(signature.presets), kept: matching(signature.kept) }
    for (const f of [...setup.files, ...setup.presets, ...setup.kept]) claimed.add(fileKey(f))
    found.push(setup)
  }
  return found
}
