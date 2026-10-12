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
`minAppVersion`. Channel switching and performance profiles arrive in later tickets.

Steps currently support `copy` (`file` hash and `to` path), `rename` (`from`, `to`), and `delete`
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
configs and presets must exist after the recipe. Unknown step kinds are rejected; `ini_set`
belongs to the performance-profile work.

The device-name restrictions follow [Microsoft's Windows file-naming rules](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file), including the reserved superscript COM/LPT names.

## Planning, journal and recovery

`planDeployment` is a pure function of the content version, tier, ReShade choice and scanned
folder/cache facts. Review renders its counts and download size directly. Counts cover unique
original files to back up and final added files, excluding temporary files created and renamed by
the recipe. Downloads are deduplicated by hash; a cache entry counts only after its size and hash
have been checked. Required-ReShade tiers force that choice on.

An existing file without journal ownership blocks deployment. Existing-setup recognition and its
explicit backup exception belong to #12; a recipe alone cannot claim a player's files.

Data lives under `%LOCALAPPDATA%\Lucent`: `cache\<sha256>`, `backups\<sha256>`, and
`deployments\<hash of normalized game-folder path>\record.json`. A record stores the game folder,
GPU, tier, content version, ReShade choice, Enabled, the recipe's path lists, each journal entry,
last-written config text, and every deployed file's SHA-256, size and modification time.

All assets are verified before the game folder changes. The journal is saved atomically before
each step, including that step's before and intended after hashes. Binary copies and text writes
also use atomic replacement. Failures undo intents in reverse using verified backups; an
unfinished record is recovered on the next Scan of that folder. Recovery waits until XIV closes
and stops if a file differs from both recorded states, preserving a later user change. A successful
record reopens on the main screen; its deployed hashes determine Healthy or Drift.

Copies and renames to an absent game-folder destination atomically refuse a file that appears
between journaling and execution. Recovery saves an `undone` marker after each reversed intent,
before proceeding to an earlier one, so a second interruption resumes at the correct point.

The gallery includes `review`, `review-no-reshade`, `review-radeon`, `review-user-file`, each
`install-<phase>`, `done`, `done-no-reshade`, `done-radeon`, `done-other`, and `healthy`.
