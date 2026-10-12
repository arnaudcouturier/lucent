# Manifest schema and dev content

`manifest.json` is fetched from `main` in `arnaudcouturier/lucent` on GitHub. The app and the
future publish tool share `src/shared/manifest.ts`: `parseManifest` validates JSON text and
`validateManifest` validates an object before publishing. The module has no UI or Platform dependency.

Schema version **2** contains `schemaVersion`, `tiers` and `versions`. The app still reads v1 tier-only
manifests. A newer schema version produces an app-update message before its
contents are interpreted. Invalid manifests and fetch failures leave the graphics card visible
without assigning a tier.

Each tier has `id`, `label`, `status` (`stable`, `experimental`, `community-verified`), `gpuMatch`,
`neuralRendering` and `requiresReShade`. The first matching tier wins. A GPU rule contains a numeric
PCI `vendorId` and `deviceNamePatterns`, a nonempty list of case-insensitive regular expressions.
Both the vendor and at least one pattern must match. NVIDIA is 4318 (`0x10de`), AMD is 4098
(`0x1002`), Intel is 32902 (`0x8086`). The last tier must use `"gpuMatch": "any"`; earlier tiers
must supply rules. Tier IDs are unique. Patterns are checked at validation time.

Scan discards software adapters and chooses the adapter with the most dedicated video memory,
excluding shared system memory. Windows enumeration uses DXGI. XIVLauncher presence is determined
independently from the game folder, from its config file under `%APPDATA%\XIVLauncher`.

## Local content in a dev build

The repo remains private before launch, so an unauthenticated GitHub fetch may fail. Set these
environment variables **before** starting the Tauri dev process:

```powershell
$env:LUCENT_DEV_MANIFEST = 'C:\Users\arnaudc\workspace\ffxiv-dlss5\manifest.json'
$env:LUCENT_DEV_FILES = 'C:\LucentContent\files'
npm run tauri dev
```

`LUCENT_DEV_MANIFEST` selects a local manifest instead of GitHub. `LUCENT_DEV_FILES` selects its
local release-files directory; it defaults to `files` alongside the manifest. Each asset is a single
file named by its lowercase SHA-256. Deployment copies it into the cache and verifies its size and
hash, just as it would for a release download. Local content is never silently replaced with remote
content if the local manifest is missing or invalid. Portable release builds ignore both variables.

Browser dev mode uses fake machines and a fake release host, with the committed manifest's tiers
and tiny inert content from `src/platform/contentFixture.ts`. It never fetches or deploys real DLLs.
The dev-only gallery includes every tier, an app-update request, invalid/unavailable manifests and
a machine without a hardware adapter. Open `?gallery=rtx-20` to inspect the caution badge.

## Content versions

The committed manifest keeps `versions: []` until the maintainer publishes tested assets. The real
app explains that no content is published; fixture content is restricted to the fake Platform.

Each version contains:

- `id`: a date in `YYYY.MM.DD` form; `channel`: `stable` or `beta`; `minAppVersion`: the minimum
  app version; `changelog`: lines to display when offering this content.
- `components`: objects with `name`, `upstream`, `licence`, and an HTTPS `source` link. GPL components
  should use a source link to their exact source tag.
- `files`: objects with `sha256`, `size` in bytes, and `release` (a `content-YYYY.MM.DD` tag).
  An asset's name is its SHA-256; its URL is
  `https://github.com/arnaudcouturier/lucent/releases/download/<release>/<sha256>`.
  Later versions may point to the original release; each version lists every file its recipes need.
- `tiers`: an object keyed by tier id. Each entry defines its ordered `recipe`, `entryFiles`,
  `ownedConfigs`, `shippedPresets`, `generatedFiles`, and `overlay` hint (`neural-rendering`,
  `upscaling`, or `null` for a ReShade-only recipe).

The first deployment chooses the newest Stable content for the scanned tier and checks
`minAppVersion`. Channel switching arrives in a later ticket.

Steps support `copy` (`file` hash and `to` path), `rename` (`from`, `to`), `ini_set`
(`file` path, `section`, `key`, string `value`), and `delete`
(`path`). A step may have `when: "reshade"`; it is omitted when the player excludes ReShade.
Each path list contains `{ "path": "...", "when": "reshade" }` objects, with `when` optional.
For example, part of an OptiScaler recipe is:

```json
{
  "recipe": [
    { "kind": "copy", "file": "<sha256 of proxy>", "to": "winmm.dll" },
    { "kind": "copy", "file": "<sha256 of ReShade>", "to": "ReShade64.dll", "when": "reshade" }
  ],
  "entryFiles": [{ "path": "winmm.dll" }],
  "ownedConfigs": [],
  "shippedPresets": [],
  "generatedFiles": [{ "path": "OptiScaler.log" }],
  "overlay": "neural-rendering"
}
```

Paths are relative to the game's `game` subfolder. Validation rejects traversal, rooted paths,
alternate data streams and Windows device names/aliases. Execution repeats these checks, and the
Windows primitive rejects junctions and symbolic links in the target path. Declared entry files,
configs and presets must exist after the recipe. Unknown step kinds are rejected.

The device-name restrictions follow [Microsoft's Windows file-naming rules](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file), including the reserved superscript COM/LPT names.

## Planning, journal and recovery

`planDeployment` is a pure function of the content version, tier, ReShade choice, performance
profile and scanned folder/cache facts. Review renders its counts and download size directly. Counts cover unique
original files to back up and final added files, excluding temporary files created and renamed by
the recipe. Downloads are deduplicated by hash; a cache entry counts only after its size and hash
have been checked. Required-ReShade tiers force that choice on.

An existing file without journal ownership blocks deployment. Existing-setup recognition and its
explicit backup exception belong to #12; a recipe alone cannot claim a player's files.

Data lives under `%LOCALAPPDATA%\Lucent`: `cache\<sha256>`, `backups\<sha256>`, and
`deployments\<hash of normalized game-folder path>\record.json`. A record stores the game folder,
GPU, tier, content version, ReShade choice, Enabled, performance profile, the recipe's steps,
path lists and profiles, each journal entry,
last-written config text, and every deployed file's SHA-256, size and modification time.

All assets are verified before the game folder changes, so an offline, missing, truncated or
wrong-hash download leaves it untouched. The journal is saved atomically before each step,
including that step's before and intended after hashes. Game-folder writes also use atomic
replacement, staged in the game folder's parent on the same volume, so a killed process leaves no
temporary file in the game folder. When Windows refuses that parent (such as a system drive root),
staging falls back to the destination's folder, where a kill mid-write can leave one. Directories
absent before the deployment are recorded before a step can create them.

Failures undo intents in reverse using verified backups, then remove the recorded directories that
are empty; one that gained a file Lucent doesn't own stays, with that file. Before Scan, and before
anything else runs, Lucent recovers every unfinished record in its
data folder, whatever folder the launcher points at now, and tells the player. If recovery cannot
finish, Scan, Review and Install stay blocked until it does. Recovery waits until XIV closes and
stops if a file differs from both recorded states, preserving a later user change. The status card
explains a failure in plain words (connection, missing file, hash check, disk space, file in use,
access denied) and offers to try again. A successful record reopens on the main screen with a
health check.

Copies and renames to an absent game-folder destination atomically refuse a file that appears
between journaling and execution. Recovery marks each reversed intent as undone before proceeding
to an earlier one, so a second interruption resumes at the correct point. Before the first game
write, a deployment preallocates `undo-<id>.txt` next to its record: one checkpoint byte per step
plus a completion byte. Undoing that deployment flips bytes in place instead of rewriting the
record, so a data disk that fills up cannot stop recovery. A completed deployment, or the next
attempt, drops and deletes those checkpoints; later journal entries are undone through the record.

The gallery includes `review`, `review-no-reshade`, `review-radeon`, `review-user-file`,
`review-failed`, `scan-recovered`, `scan-recovery-blocked`, `profile`, each `install-<phase>`, `done`,
`done-no-reshade`, `done-radeon`, `done-other`, `healthy`, `drift`, `repairing` and `uninstalled`.

## Health check and Repair

A health check runs on open, after a deployment, and before and after a profile change or Repair.
Every stamped file must be present. An owned config must also be readable as text, and a shipped
preset only present, so a user change to either is never Drift. Every other file must keep its
hash. A size and modified time matching the record's stamp stand in for the hash, except right
after a deployment or Repair, and when the game version differs from the one the record saved at
its last healthy check. A healthy check saves the game version and refreshes stamps whose hash
still matched. The drift card counts the drifted files and, after a game version change, names
the new version.

Repair runs a full health check, then restores each drifted file to what Lucent last wrote:
deployed files from the cache, downloading only the missing assets of the deployed content
version, and owned configs as their last-written copy. Like a profile change, it journals each
write with a verified backup from `changeStart`, so a failure or interruption undoes only the
repair. Disabled entry files come back under their disabled names. A full health check follows.

## Uninstall

Uninstall, from the ⋯ menu after a confirmation, undoes a complete deployment from its journal and
removes the tier's `generatedFiles` that were absent before the deployment, leaving the folder
vanilla, then returns to the first-run Scan with the same game folder.
It marks the record unfinished and `uninstalling` before the first change, so an interrupted
uninstall is finished by recovery at the next start; until then, the main screen gives way to Scan. Unlike recovery, it removes a file Lucent added
even after a mod rewrote it, such as a `ReShade.ini` saved from the overlay. An original that changed
since the deployment, such as one a game patch replaced, stays as it is. User files, and the
directories that hold them, always stay. Lucent refuses to uninstall while XIV runs.

## Performance profiles

Each content tier may supply `performanceProfiles`. Omit it or use `[]` for a tier without
profiles: Lucent hides the Profile step and the main-screen selector. Otherwise supply all three
IDs, `fidelity`, `balanced` and `performance`, each with a one-line `label` and tier-specific
`description`, and nonempty `settings`. Each setting is `{ "file": "OptiScaler.ini", "section": "DlssNr",
"key": "Passes", "value": "2" }`; its file must be declared in `ownedConfigs`. Values are
single-line strings, including empty strings. Configs must be deployed before an `ini_set` step.
An `ini_set` targeting a conditional config uses the same `when` condition.

Scan → Profile → Review uses Fidelity initially, and the rows always appear in ID order. The
selected profile is applied after the recipe, and settings for an excluded ReShade config are
omitted. The saved recipe keeps only the content's own steps; the record names the profile. The
main screen uses the profiles saved with the deployed content version, so a new manifest cannot
change an existing deployment's choices. Picking a profile writes only its keys, saves those
values into the last-written copy, and keeps unrelated user changes distinct from values Lucent
wrote. Enabled remains unchanged.

Config edits preserve BOM, line endings, whitespace, ordering and comment lines; a no-op round
trip is byte-identical for the UTF-8 configs supported by the Platform port. Neither ReShade nor
OptiScaler has inline comments, so everything after `=` is the value, `#` and `;` included.

Profile writes have verified backups and durable journal entries. An interrupted profile change
recovers only that change, retaining the earlier deployment and profile. Lucent refuses a profile
change while XIV runs. NVIDIA fixtures have illustrative profiles; Radeon and Other fixtures
demonstrate tiers without profiles. Real per-tier settings remain deferred until tested content is
published.
