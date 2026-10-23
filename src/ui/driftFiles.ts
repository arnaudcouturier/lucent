// What the drift card's Show files lists: the files gone from the game folder, then the ones there with other bytes.

/** Past this, a group says how many more there are: a game patch can replace a whole deployment at once. */
export const DRIFT_FILES_SHOWN = 12

/** The cause a player can't see for a missing file, and the way back. Lucent never asks for a Windows Security
    exclusion, so this line never suggests one, nor turning any protection off. */
export const MISSING_NOTE = 'A missing file can mean Windows Security moved it away. Repair puts it back.'

export interface DriftFileGroup {
  label: 'Missing' | 'Changed'
  /** Game-folder paths as the health check stored them, at most `DRIFT_FILES_SHOWN`. */
  files: string[]
  /** "and 3 more" when the group was cut short. */
  more: string | null
}

/** The groups in the order the card shows them, an empty one left out, and the Windows Security line when a file is missing. */
export function driftFileList(missing: readonly string[], changed: readonly string[]): { groups: DriftFileGroup[]; note: string | null } {
  const group = (label: DriftFileGroup['label'], files: readonly string[]): DriftFileGroup => ({
    label,
    files: files.slice(0, DRIFT_FILES_SHOWN),
    more: files.length > DRIFT_FILES_SHOWN ? `and ${(files.length - DRIFT_FILES_SHOWN).toLocaleString('en')} more` : null,
  })
  return {
    groups: [group('Missing', missing), group('Changed', changed)].filter((g) => g.files.length),
    note: missing.length ? MISSING_NOTE : null,
  }
}
