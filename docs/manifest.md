# Manifest schema and dev content

`manifest.json` is fetched from `main` in `arnaudcouturier/lucent` on GitHub. The app and the
publish tool share `src/shared/manifest.ts`: `parseManifest` validates JSON text and
`validateManifest` validates an object before publishing. The module has no UI or Platform dependency.

Schema version **2** contains `schemaVersion`, `tiers`, `versions` and `existingSetups`, and optionally a `starterSet`. The app still reads v1 tier-only
manifests. A newer schema version produces an app-update message before its
contents are interpreted. Invalid manifests and fetch failures leave the graphics card visible
without assigning a tier.

Each tier has `id`, `label`, `status` (`stable`, `experimental`, `community-verified`), `gpuMatch`,
`neuralRendering` and `requiresReShade`. The first matching tier wins. A GPU rule contains a numeric
PCI `vendorId` and `deviceNamePatterns`, a nonempty list of case-insensitive regular expressions.
Both the vendor and at least one pattern must match. NVIDIA is 4318 (`0x10de`), AMD is 4098
(`0x1002`), Intel is 32902 (`0x8086`). The last tier must use `"gpuMatch": "any"`; earlier tiers
must supply rules. Tier IDs are unique. Patterns are checked at validation time.

`existingSetups` lists the signatures of mod files Lucent didn't deploy: GShade leftovers, ReShade,
GPosingway, another OptiScaler and swapped DLSS files. Each has a unique `id`, a `label`, and four
lists of game-folder patterns: `markers` (any match means the setup is there; at least one),
`files` (backed up and removed), `presets` (carried over) and `kept` (left in place, such as its
shaders or a swapped DLSS DLL the game still needs). In a
pattern, `*` matches within one name and `**` matches any number of folders; a pattern can't end in
`**`. Signatures match in manifest order and each file belongs to the first setup that claims it.
A manifest without the list has no signatures. The GPosingway and swapped-DLSS signatures are
best guesses until checked against real installs.

Scan discards software adapters and chooses the adapter with the most dedicated video memory,
excluding shared system memory. Windows enumeration uses DXGI. XIVLauncher presence is determined
independently from the game folder, from its config file under `%APPDATA%\XIVLauncher`.

## Local content in a dev build

Set these environment variables **before** starting the Tauri dev process:

```powershell
$env:LUCENT_DEV_MANIFEST = 'C:\path\to\lucent\manifest.json'
$env:LUCENT_DEV_FILES = 'C:\path\to\content-files'
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
a machine without a hardware adapter. Open `?gallery=radeon` to inspect the caution badge.
The gallery also includes `screen-60-sdr`, `screen-144-hdr` and `screen-240-dual`; their toolbar shows the
resolved refresh, frame cap, resolution and HDR status from inert fake monitors and `FFXIV.cfg` files. The Profile step has
`profile-v2-rtx4090` and `profile-v2-rtx4070` previews for the card's recommended profile, and `choices-*` states for the
first-install choices: RTX 40 at 240 Hz with HDR, RTX 30 at 60 Hz, Experimental picks (4×, Scene HDR), and tiers
without profiles (Options). `review-choices` and `done-choices` show them on Review and Done.

## Content versions

The committed manifest lists published content versions and their tested assets. If its `versions`
list is empty, the real app explains that no content is published; fixture content is restricted to
the fake Platform.

Each version contains:

- `id`: a date in `YYYY.MM.DD` form; `channel`: `stable` or `beta`; `minAppVersion`: the minimum
  app version; `changelog`: lines to display when offering this content.
- `knownBrokenGameVersions` (optional): exact game-version strings on which this content is known
  broken, for example `["2026.10.20.0000.0000"]`. When the player has pinned this version, it adds a
  caution line to the status card; it never changes a deployment or forces an update. Omitted means no known broken game versions.
- `components`: objects with `name`, `upstream`, `licence`, and an HTTPS `source` link. GPL components
  should use a source link to their exact source tag.
- `files`: objects with `sha256`, `size` in bytes, and `release` (a `content-YYYY.MM.DD` tag).
  An asset's name is its SHA-256; its URL is
  `https://github.com/arnaudcouturier/lucent/releases/download/<release>/<sha256>`.
  Later versions may point to the original release; each version lists every file its recipes need.
- `tiers`: an object keyed by tier id. Each entry defines its ordered `recipe`, `entryFiles`,
  `ownedConfigs`, `shippedPresets`, `generatedFiles`, and `overlay` hint (`neural-rendering`,
  `upscaling`, or `null` for a ReShade-only recipe).

`ownedConfigs` lists the **config files**: the files OptiScaler and ReShade read their settings from. Lucent writes them
once, when it deploys the baseline, and from then on they belong to the player. Each entry may carry an `update` field,
the **config update rule** that decides what an update does with a file the player already has:

| `update` | What an update does |
|---|---|
| `"keep"` (the default when the field is absent) | Nothing: the file is not touched. |
| `"addMissingKeys"` | Writes the keys absent on disk with the new baseline's value. Keys already on disk keep the player's value, and the layout and comments on disk stay. For a new OptiScaler build that brings new keys. |
| `"replace"` | Backs the file up through the journal, then writes the new baseline from the stored first-install choices (the frame cap and peak brightness are computed then). |

```json
"ownedConfigs": [
  { "path": "OptiScaler.ini", "update": "addMissingKeys" },
  { "path": "ReShade.ini", "update": "keep", "when": "reshade" }
]
```

The rule is per content version and per tier, and it applies on every update that arrives at that version, so use
`replace` sparingly: it discards the player's tuning, such as ReShade's selected preset and keybinds. A config file that
is missing, can't be read as text, or is new to the deployment is simply written from the baseline, whatever its rule.
The status card's changelog adds a line for the files an update adds keys to or replaces, and the activity log has a
line per config file. Older Lucent releases ignore `update` and merge as they always did, so content that uses it should
require an app version that supports it with `minAppVersion`. There is no record of what Lucent last wrote and no
list of keys to reset: the former `resetKeys` field is ignored.

A tier recipe may also declare `screenDerivedSettings`, settings Lucent computes from the monitor XIV uses at the moment it
writes a config file from the baseline: the first deployment, a `replace` update, a key an `addMissingKeys` update adds,
and Repair of a missing file. Nothing recalculates them otherwise, because once deployed the config files belong to the player.
Each entry names an owned config, section and key, plus the value computation. Older Lucent releases ignore this optional
field, so content that depends on it should require an app version that supports it. The first computation is
`"frameCap"`, written with six decimal places using `floor(R − R²/3600)` for refresh rate `R` in Hz, or
`"peakNits"`, written as a whole number clamped to 400–4000 with 1100 as the fallback when the monitor does not
report a peak. For example,
the frame cap declaration may target the OptiScaler limit, DLSS frame-generation target and XeFG target using
three entries:

```json
"screenDerivedSettings": [
  { "file": "OptiScaler.ini", "section": "Framerate", "key": "FramerateLimit", "value": "frameCap" },
  { "file": "OptiScaler.ini", "section": "DLSSG", "key": "FramerateTargetDMFG", "value": "frameCap" },
  { "file": "OptiScaler.ini", "section": "XeFG", "key": "DynamicTargetFPS", "value": "frameCap" }
]
```

The field accepts only the known computation values, must use unique keys, and each target must name an owned config.
The plan writes screen-derived settings after the profile and frame generation values, so they win over profile settings
with the same key; without a readable screen, the content's own values stay. Config health checks only look that a file
exists and is readable, so a player's edit is never reported as drift.

A tier recipe may also declare `frameGenerationOptions`, a list of modes the baseline can be deployed with. Each option has an `id` of
`off`, `2x` through `6x`, or `dynamic`, plus nonempty `settings` targeting an owned config. Optional
`gpuNamePatterns` are case-insensitive regular expressions; options without patterns apply to any GPU. If both a
generic and GPU-specific option share an ID, the matching GPU-specific variant is used. `experimental: true` adds
the yellow Experimental label. `hdrSettings` may override values for keys also declared in `settings` when Windows HDR is on; every override must have a normal-mode value so turning HDR off restores it. Lucent
records the selected mode and appends its settings after the performance profile, so frame-generation keys
remain separate from profiles. The mode is a first-install choice on the Profile step, among the options the player's
GPU matches: picking a multiplier tagged Experimental is the opt-in, with no dialog. The default is 2x at 120 Hz or
above, otherwise Off, falling back to the first offered mode. The deployment record keeps the mode so Reset can offer it
again, and a baseline written later (a `replace` update, Repair of a missing file) uses it where the card still offers it,
otherwise that default. Nothing reads the mode back from the config files.

```json
"frameGenerationOptions": [
  { "id": "off", "settings": [{ "file": "OptiScaler.ini", "section": "FrameGeneration", "key": "Mode", "value": "off" }] },
  { "id": "2x", "gpuNamePatterns": ["\\bRTX\\s+40[0-9]{2}\\b"], "settings": [{ "file": "OptiScaler.ini", "section": "FrameGeneration", "key": "Mode", "value": "2x" }] }
]
```

The field is optional and is ignored by older app releases. Options are filtered by the detected GPU and displayed in
the fixed Off, 2x–6x, Dynamic order. A mode's one-line description uses the resolved frame cap and refresh rate; multiplier
modes describe `floor(frameCap / multiplier)` as the render rate.

A tier may declare optional `hdrOptions` content data. The Profile step offers them only when the monitor XIV runs on
supports HDR, with HDR selected by default; a monitor without HDR deploys `off`. A declaration contains one option each for `off`, `hdr` and
`scene-hdr`; each option owns the complete set of INI values that identifies and applies it. `scene-hdr` may set
`experimental: true`. Older content without this field has no HDR settings. The record keeps the chosen mode, and a
baseline written later uses it where the content still offers it, otherwise Off. The mode keys are separate from
performance-profile keys. Example:

```json
"hdrOptions": [
  { "id": "off", "settings": [{ "file": "OptiScaler.ini", "section": "HDR", "key": "FfxivHDR", "value": "false" }] },
  { "id": "hdr", "settings": [
    { "file": "OptiScaler.ini", "section": "HDR", "key": "FfxivHDR", "value": "true" },
    { "file": "OptiScaler.ini", "section": "HDR", "key": "Mode", "value": "0" }
  ] },
  { "id": "scene-hdr", "experimental": true, "settings": [
    { "file": "OptiScaler.ini", "section": "HDR", "key": "FfxivHDR", "value": "true" },
    { "file": "OptiScaler.ini", "section": "HDR", "key": "Mode", "value": "1" }
  ] }
]
```

The first deployment chooses the newest content on the player's channel for the scanned tier (Stable
by default, Stable and Beta on Beta) and checks `minAppVersion`. The Beta channel switch in Settings
is a player setting, stored with the skipped versions.

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
profile, frame generation and HDR choices, XIV's screen and scanned folder/cache facts. The deployment record stores the
choices (`profile`, `frameGenerationMode`, `hdrMode`, `includeReShade`) so Reset can offer them again, and so a baseline
written later (a `replace` update, Repair of a missing config) uses them. Updates keep the stored choices. The profile cards on
the Profile step show each profile's `summary` at the player's resolution, so a summary should name the passes, the
upscaling quality, and spatial compression and residual frame generation where the profile sets them. Review renders its counts and download size directly. Counts cover unique
original files to back up and final added files, excluding temporary files created and renamed by
the recipe. Downloads are deduplicated by hash; a cache entry counts only after its size and hash
have been checked. Required-ReShade tiers force that choice on.

Scan lists every file from before a first deployment that the plan backs up, then replaces or removes,
and the presets it keeps; Review only counts them. An existing setup is taken over before the recipe
runs:

- presets outside `reshade-presets\`, or at a path the content writes, are copied there first under
  a free name (`<name> (previous).ini` when taken), keeping the folders below their top-level
  one; presets already there stay put. A preset in the way that is byte for byte the file the
  content writes there is not copied: nothing of the player's would be lost (Scan hashes only
  those, and the backup still holds the original);
- then journaled delete steps back up and remove the setup's files, and its kept files and presets
  where the content writes, so its configs are replaced whole and a colliding shader survives only
  in the backup. A taken-over log counts as generated, so Uninstall removes the mods' new log
  before restoring the old one.

Any other file at a path the content writes (`unclaimedPaths`, such as a DLSS DLL no signature claims) is
backed up and replaced by the recipe itself. An update plans without signatures and refuses while
`unclaimedPaths` isn't empty, since no Scan has listed those files.

Review counts those files as backed up. Uninstall restores them; the carried-over copies are user
files from then on, which Repair and Uninstall never touch. A failed deployment
removes them along with everything else.

Data lives under `%LOCALAPPDATA%\Lucent`: `cache\<sha256>`, and per game folder
`deployments\<hash of normalized game-folder path>\record.json` with the journal's
`backups\<sha256>` beside it. A first deployment also copies every original it backs up to
`Backups\<game folder name>\game\<its path>` (numbered when another game folder's deployment has
the name), recorded as `backupFolder`. That readable copy is for the player only: the journal
never restores from it, and it is removed once the whole deployment is undone. A record stores the game folder,
GPU, tier, content version, the first-install choices, Enabled, the recipe's steps,
path lists and profiles, each journal entry, and every deployed file's SHA-256, size and modification time. It keeps
no copy of the config files: the player owns them, and the journal's backups are the only record of what a step replaced.

A 0.1.1 record also kept the config text Lucent last wrote, to merge on update. Opening such a deployment (the window or
an XIVLauncher run) migrates it once: Lucent drops that text, leaves every file on disk as it is, and infers the first-install
choices Reset offers again. The profile is the recorded one (the old two-pass Fidelity becomes Ultra), frame generation is Off
and HDR is Off, where the content has them. The activity log says so.

Recovery and operations that change shared data hold an exclusive process lease on
`operation.lock` in this data folder, including health checks that update a journal. Another Lucent
window or XIVLauncher headless run reports the active operation and asks to retry after it finishes;
an idle window holds no lease. Windows releases it after an exit or crash. An elevated relaunch uses the
original player's data folder so both processes coordinate on the same file.

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

The gallery includes `existing-setup`, `review`, `review-existing-setup`, `review-no-reshade`, `review-radeon`, `review-user-file`,
`review-failed`, `scan-recovered`, `scan-recovery-blocked`, `profile`, each `install-<phase>`, `done`,
`done-no-reshade`, `done-radeon`, `done-other`, `healthy`, `drift`, `repairing`, `update`, `updating` and `uninstalled`.

## Health check and Repair

A health check runs on open, after a deployment, and before and after Repair or any other change to the game folder.
Every stamped file must be present. A config file must also be readable as text, and a shipped
preset only present, so the player's changes to either are never Drift. Every other file must keep its
hash. A size and modified time matching the record's stamp stand in for the hash, except right
after a deployment or Repair, and when the game version differs from the one the record saved at
its last healthy check. A healthy check saves the game version and refreshes stamps whose hash
still matched. The drift card counts the drifted files and, after a game version change, names
the new version.

Repair runs a full health check, then puts back each drifted file: deployed files come from the cache,
downloading only the missing assets of the deployed content version. A config file is written only when it is
missing (or can't be read as text), from the deployed baseline and the stored first-install choices, with the frame cap
and peak brightness computed from XIV's screen as it is now. A config that is there is the player's, so Repair never
restores its contents; XIVLauncher's repair on close follows the same rule. It journals each
write with a verified backup from `changeStart`, so a failure or interruption undoes only the
repair. Disabled entry files come back under their disabled names. A full health check follows.

## Uninstall

Uninstall, from Settings after a confirmation, undoes a complete deployment from its journal and
removes the tier's `generatedFiles` that were absent before the deployment, leaving the folder
vanilla, then returns to the first-run Scan with the same game folder.
It marks the record unfinished and `uninstalling` before the first change, so an interrupted
uninstall is finished by recovery at the next start; until then, the main screen gives way to Scan. Unlike recovery, it removes a file Lucent added
even after a mod rewrote it, such as a `ReShade.ini` saved from the overlay. An original that changed
since the deployment, such as one a game patch replaced, stays as it is. User files, and the
directories that hold them, always stay. Lucent refuses to uninstall while XIV runs.

Uninstalling Lucent from Settings → Apps also removes Lucent's two XIVLauncher add-ons (only those),
whether or not the game folder is restored. If XIVLauncher is running, the uninstall still finishes and
says to remove them in XIVLauncher's settings. No XIVLauncher, or no Lucent add-ons, changes nothing.

## Neural Rendering controls

A tier may declare `neuralRenderingControls` in place of profiles (a tier with both is invalid). Lucent 0.3.0
and later offer them on the Graphics step and write the picks once, like the profile values they replace:

- `presetKey` and `presets`: all six DLSS presets (`dlaa`, `ultra-quality`, `quality`, `balanced`, `performance`, `ultra-performance`), each with a `label`, the upscaling `ratio` shown to the player and the `value` written to `presetKey`.
- `passesKey` takes 1, 2 or 3; `scaleKey` takes the fraction for 75%, 100% or 125% (the app writes `0.750000`, `1.000000` or `1.250000`).
- `spatialCompression` and `residualFg`: a `key`, a `label`, a plain `description` and an optional `experimental` flag. `residualFg` also lists the `gpuNamePatterns` it is offered to; it is only on with frame generation at 2× or higher.
- `defaults`: the first entry whose `gpuNamePatterns` match the card gives the preset and passes; the last entry has no patterns and matches every card. The resolution starts at 100% and both switches off.

Every key must target an owned config. An optional `mfgUnlock` (`gpuNamePatterns`, `label`, `description`, `gates`, `settings`) adds the
experimental unlock as its own switch: without it the `gates` modes (3×–6× and Dynamic) are not offered, and with it
the `settings` are written after the frame-generation values, so 2× can use the unlock too. A mode in `gates`
that is already stored turns the switch on. The record keeps the picks (`neuralRendering`, `mfgUnlocked`) for Reset.

## Performance profiles

Older content may supply `performanceProfiles`: the three legacy IDs `fidelity`, `balanced` and
`performance`, each with a one-line `label` and tier-specific `description`, and nonempty scalar
`settings`. Lucent keeps reading this field with its original Fidelity default.

New content may supply `performanceProfilesV2`, which takes precedence when both fields are
present. Omit it or use `[]` for a tier without profiles: Lucent offers no profile, and the
first-run step becomes Options when ReShade or Start menu choices remain, or is skipped when there
are no choices. Otherwise supply all four IDs in this order: `ultra`, `fidelity`, `balanced` and
`performance`. Each profile has a one-line `label` and `description`, nonempty `settings`, and may
include `summary`, a short description that accepts a string or the same resolution-column map
as a setting. If omitted, `description` is used. Content can therefore describe the resolved
upscaling choice without Lucent inferring meaning from a particular INI key. A profile may also
include `gpuNamePatterns`, a list of case-insensitive regular expressions matched against the
graphics card name. The first matching profile is recommended; Balanced is the fallback.

A setting is `{ "file": "OptiScaler.ini", "section": "QualityOverrides", "key": "ForcePerfQuality",
"value": "2" }`; its file must be declared in `ownedConfigs`. Values may be a single-line string,
including an empty string, or contain one value for each resolution column:
`{ "1080p": "2", "1440p": "1", "4k+": "1" }`. Lucent chooses the column from XIV's output
height: below 1300 uses `1080p`, below 2000 uses `1440p`, and 2000 or above uses `4k+`. The output
height is independent of aspect ratio, so 3440×1440 ultrawide uses `1440p`. All three columns are
required. Configs must be deployed before an `ini_set` step; a conditional config and its `ini_set`
step use the same `when` condition. Frame-generation option keys stay owned by frame generation,
even if a profile also lists them. The optional field does not change the manifest schema version
and is ignored by Lucent 0.1.x.

Scan → Profile → Review preselects the first matching recommendation. The selected profile is
applied after the recipe, and settings for an excluded ReShade config are omitted. The saved recipe
keeps only the content's own steps; the record names the profile and stores the profile data from
that content version. Its values are written with the baseline; the resolution column comes from XIV's screen at that
moment and does not follow a later monitor change. Once deployed, the profile is not a control: there is no command to change it, and
the config files belong to the player.

Config edits preserve BOM, line endings, whitespace, ordering and comment lines; a no-op round
trip is byte-identical for the UTF-8 configs supported by the Platform port. Neither ReShade nor
OptiScaler has inline comments, so everything after `=` is the value, `#` and `;` included.

NVIDIA fixtures have illustrative profiles; Radeon and Other fixtures
demonstrate tiers without profiles. Real per-tier settings come from the tested published content.

## Content updates

On open, after the health check, Lucent announces the newest content version on the channel (Stable, or
Stable and Beta on the Beta channel) that is newer than the deployed one, isn't skipped, has a recipe for the
deployed tier and doesn't need a newer app. `announcedContent` in `src/core/updates.ts` is that pure
function. There is no background check. The status card shows the version's changelog lines and the
size of the files the update needs that aren't cached yet, with Skip and Update; nothing downloads
until the player clicks Update.

Skip saves the version in `%LOCALAPPDATA%\Lucent\settings.json` (`skippedContent`) and stops
announcing it. A newer version is still announced. A missing or damaged settings file reads as no skips.

Update is planned from the deployment as it stands: `planDeployment` gets the deployment's files as
`ownedFiles`, so the recipe may overwrite them, and appends a journaled `delete` for each owned file the
new version no longer deploys. When that file replaced one of the player's in place when the deployment first
wrote it, the step is a journaled `restore` of the original instead, and the file is no longer owned. A Disabled deployment keeps its entry files renamed aside to
`<entry>.disabled` through journaled renames, and the record's performance profile is reapplied. Only
the files the cache lacks are downloaded, and all of them are verified before the game folder changes.
Each config file the player has follows the update rule the new version gives it (see
`ownedConfigs` above): `keep` leaves it, `addMissingKeys` writes only the keys it lacks, and `replace` backs it up
and writes the new baseline from the stored choices. The planned steps for a config that is kept or only gains keys are
dropped, so the file is never rewritten with the player's values. An edited shipped preset is kept when Lucent's hash for it is
unchanged, or saved as `<name> (my edits)` beside it when Lucent's changed too. Like a repair, the update journals from `changeStart`, and the directories it creates from
`changeDirectoryStart`, so a failure or interruption undoes only the update. A full health check
follows. The previous version's files stay in the cache. An update never takes over an existing setup: one that
appeared since the deployment and is in the way blocks the update, which asks the player to move it aside.

## Versions, rollback and cache retention

The Versions section lists the current version, the two retained versions, skipped versions,
and every other version on the channel. Leaving Beta changes nothing that's deployed: a beta
version stays current and keeps its place in the list, and only a Stable version newer than it is
announced. A version requiring a newer app or lacking a recipe for
the deployment's tier is shown with an explanation and cannot be applied. A skipped version can
be applied explicitly; doing so clears its skip.

Applying an older version uses the same journaled update and the older version's config update rules. It preserves Disabled
and the stored choices, pins the target, and skips the version left behind. The pin is a fact
on the deployment's record, not a gate on announcements: newer unskipped versions still appear.
Applying a newer version clears the pin. No version is applied automatically.

The journal retains recipe, tier and asset snapshots for the current content and the two most
recently applied other versions. Those snapshots allow rollback without a live manifest or a
download when their assets are cached. Versions checks cached assets by size only, so opening
Lucent never re-hashes the cache; missing or wrong-size assets are shown as needing a download.
Applying a version hash-checks every asset before use and re-downloads a damaged one. Older journals acquire a snapshot of their current version when it is
still in the manifest. A completed version change durably records its pin and pending skip; if
settings cannot be saved, startup retries that last step.

After a successful deployment, version change or reopening, Lucent prunes cache assets outside
the retained versions. Shared assets and files needed by another game folder's deployment stay;
backups and user files are separate and untouched. An unfinished or unreadable journal stops
pruning. The gallery includes `versions` and `known-broken`.

## App updates

On open, Lucent also reads GitHub Releases and announces the newest unskipped Stable `app-vX.Y.Z`
release with a `Lucent.exe` asset and a SHA-256 digest. Release notes appear inline with Update and
Skip. Drift still ranks first; app updates rank above content updates. The app card is also available
during Scan, including when the manifest or its content needs a newer app. Content versions carry
`minAppVersion` and are never offered to an app that cannot apply them.

Skip persists in `settings.json` as `skippedApp`, independently of `skippedContent`. Nothing downloads
until Update is clicked. The download is hash-checked and prepared beside the running exe before
that exe is renamed to `<exe>.old` and the new one takes its place. Lucent relaunches from that same
path. A replacement or relaunch failure restores the previous exe; a failed restoration reports its
backup path. At the next start, a hash-checked `<exe>.lucent-update.json` record identifies the previous
exe and any prepared file to remove. Unrecognized or changed adjacent files are preserved.

The gallery includes `app-update`, `app-updating`, `app-update-failed`, and `schema-update`.

## Starter set

`starterSet` is an optional top-level field beside `existingSetups`. It lists what the Mods section offers: Dalamud plugins that
Lucent fetches from their own repositories, and Penumbra mods it links to (`docs/decisions.md`, Starter set (Mods)). It holds
names, addresses and IDs, never files, so it has no content version, no cache and no rollback, and it doesn't change the schema
version: apps from before the Mods section ignore it. It is edited by hand in `manifest.json` on `main`, like the tiers; the publish
tool carries it through unchanged.

```json
"starterSet": {
  "repos": [{ "id": "seaofstars", "label": "SeaOfStars", "author": "Ottermandias", "url": "https://…/repo.json" }],
  "plugins": [{ "internalName": "Penumbra", "name": "Penumbra", "author": "…", "summary": "…", "source": "https://…", "repo": "seaofstars", "group": "core" }],
  "mods": [{ "id": "00e1decfyd2aqbhb7x20b9ccbm", "name": "The Body SE", "author": "Tsar", "summary": "…", "nsfw": true }]
}
```

- **`repos`** are the third-party plugin repositories. `id` is lowercase letters, digits and dashes (`official` is reserved for
  Dalamud's own repository, which needs no entry); `label` and `author` are named in the consent panel; `url` is the HTTPS address
  of the repository's `repo.json`. Dalamud matches a repository by the exact string, so Lucent writes `url` as given, and a plugin it
  places is marked with it.
- **`plugins`** each have `internalName` (Dalamud's name for it, which becomes a folder name: letters, digits, `.`, `_` and `-`;
  unique ignoring case), `name`, `author`, `summary`, an optional `source` page, a `repo` (`official` or a repo `id`) and a `group`:
  `core` plugins share one switch and `extra` ones are each ticked on their own. An optional `setup` is one line on what the player
  still does in the game once it is added; Lucent never writes a plugin's settings, so the report after an Add prints it. `manual: true` lists a plugin Lucent never fetches
  (Heliosphere, whose terms bar other programs from its endpoints): its row says to install it from Dalamud's plugin installer.
- **`mods`** each have the `id` from the mod's Heliosphere page address (`https://heliosphere.app/mod/<id>`: 26 lowercase
  letters and digits, no `i`, `l`, `o` or `u`), `name`, `author`, an optional `summary` and `nsfw: true` for the neutral NSFW chip.
  Lucent finds the mod on the PC by that ID in the `Website` of a `meta.json` in Penumbra's mod folder, and opens the page to get it.

The set is validated apart from the rest (`validateStarterSet` in `src/shared/starterSet.ts`), because a typo in a hand-edited
field mustn't take every DLSS deployment down. A set with a mistake is left out of the parsed manifest and the reason is put in
`starterSetError`: the Mods section then says it is unavailable and the activity log names the mistake. The publish tool refuses to
rewrite a manifest that has one, since writing back what it parsed would delete the set. The repository's own set is checked by
`src/shared/starterSet.test.ts`, so `npm test` catches a mistake before it is pushed.

To add a plugin, copy its `InternalName` exactly from the repository's `repo.json` (Lucent matches it by exact string) and pick its
`repo`. To add a mod, copy the ID from its Heliosphere page address. The browser dev machines `?machine=mods` and `?machine=modsFresh`
show the section with Dalamud set up (some plugins and a mod folder in, or neither) and let Add run against fake repositories.
