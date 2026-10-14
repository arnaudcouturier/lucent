# Publish a content version

The maintainer prepares and tests the files first, then publishes them with one command.
Node 22 or later and an authenticated [GitHub CLI](https://cli.github.com/) are required.
Archive inputs also require 7-Zip; the script searches its usual Windows location and PATH,
or accepts `--seven-zip "C:\path\to\7z.exe"`.

```sh
npm ci
gh auth login
npm run publish:content -- C:/LucentContent/publish.json --dry-run
npm run publish:content -- C:/LucentContent/publish.json
git diff -- manifest.json
```

The default manifest is `manifest.json` in the current directory; change it with `--manifest`.
The repository defaults to `arnaudcouturier/lucent`; change it with `--repo owner/name` when
testing against a separate repository. Commit the resulting manifest after reviewing it.
The script never commits or pushes it.

Dry run hashes and validates the same inputs and prints the candidate manifest and hash-named
upload list. It makes **no GitHub calls** and leaves the manifest unchanged. Its reuse decisions
come from the local manifest. Live publication also discovers files in published content
releases absent from that manifest, so it can upload fewer files than the offline preview.
Every content version receives its own dated release, even when a recipe or pruning change
reuses every file from earlier releases and needs no new uploads.
Temporary staging and archive extraction folders are removed in either mode.

## Input

All source paths are relative to `publish.json`, or absolute paths. Game-folder paths are
relative to the game's `game` subfolder and follow the [shared schema](manifest.md).
Here is an example for one tested tier; add entries for the other tested tiers as needed:

```json
{
  "id": "2026.10.12",
  "channel": "stable",
  "minAppVersion": "0.1.0",
  "changelog": ["Describe the tested changes here."],
  "components": [
    {
      "name": "OptiScaler",
      "upstream": "SirenBrink",
      "licence": "GPL-3.0",
      "source": "https://github.com/SirenBrink/OptiScaler_DLSSNR_Multipass_MFG_FFXIV/tree/v5.0"
    },
    {
      "name": "ReShade",
      "upstream": "crosire",
      "licence": "BSD-3-Clause",
      "source": "https://github.com/crosire/reshade"
    }
  ],
  "knownUserShaders": ["PaidShader.fx"],
  "tiers": {
    "rtx-30-40": {
      "sources": [
        { "folder": "tested/OptiScaler", "component": "OptiScaler" },
        { "folder": "tested/ReShade", "component": "ReShade", "when": "reshade" }
      ],
      "entryFiles": [{ "path": "winmm.dll" }],
      "ownedConfigs": [
        { "path": "OptiScaler.ini" },
        { "path": "ReShade.ini", "when": "reshade" }
      ],
      "shippedPresets": [{ "path": "reshade-presets/Example.ini", "when": "reshade" }],
      "generatedFiles": [{ "path": "OptiScaler.log" }, { "path": "ReShade.log", "when": "reshade" }],
      "overlay": "neural-rendering",
      "performanceProfilesV2": [
        { "id": "ultra", "label": "Ultra", "description": "Two Neural Rendering passes.", "summary": "Two Neural Rendering passes, Quality upscaling.", "gpuNamePatterns": ["RTX 4090|RTX 4080"], "settings": [{ "file": "OptiScaler.ini", "section": "DlssNr", "key": "Passes", "value": "2" }, { "file": "OptiScaler.ini", "section": "QualityOverrides", "key": "ForcePerfQuality", "value": { "1080p": "2", "1440p": "2", "4k+": "2" } }] },
        { "id": "fidelity", "label": "Fidelity", "description": "One Neural Rendering pass with Quality upscaling.", "summary": "One Neural Rendering pass, Quality upscaling.", "settings": [{ "file": "OptiScaler.ini", "section": "DlssNr", "key": "Passes", "value": "1" }, { "file": "OptiScaler.ini", "section": "QualityOverrides", "key": "ForcePerfQuality", "value": { "1080p": "2", "1440p": "2", "4k+": "2" } }] },
        { "id": "balanced", "label": "Balanced", "description": "One Neural Rendering pass with resolution-aware upscaling.", "summary": { "1080p": "One Neural Rendering pass, Quality upscaling.", "1440p": "One Neural Rendering pass, Balanced upscaling.", "4k+": "One Neural Rendering pass, Balanced upscaling." }, "settings": [{ "file": "OptiScaler.ini", "section": "DlssNr", "key": "Passes", "value": "1" }, { "file": "OptiScaler.ini", "section": "QualityOverrides", "key": "ForcePerfQuality", "value": { "1080p": "2", "1440p": "1", "4k+": "1" } }] },
        { "id": "performance", "label": "Performance", "description": "One pass with compression and residual frame generation.", "summary": { "1080p": "One pass, compression, residual frame generation, Balanced upscaling.", "1440p": "One pass, compression, residual frame generation, Balanced upscaling.", "4k+": "One pass, compression, residual frame generation, Performance upscaling." }, "settings": [{ "file": "OptiScaler.ini", "section": "DlssNr", "key": "Passes", "value": "1" }, { "file": "OptiScaler.ini", "section": "DlssNr", "key": "SpatialCompression", "value": "true" }, { "file": "OptiScaler.ini", "section": "DlssNr", "key": "ResidualFG", "value": "true" }, { "file": "OptiScaler.ini", "section": "QualityOverrides", "key": "ForcePerfQuality", "value": { "1080p": "1", "1440p": "1", "4k+": "0" } }] }
      ],
      "resetKeys": [{ "file": "OptiScaler.ini", "section": "Logging", "key": "LogToFile" }]
    }
  }
}
```

The example's settings and source tag are illustrative: use the exact files, tag and settings
you tested. Each source belongs to one named component. Sources can instead specify
`"archive": "upstream.7z"`; optionally use `subdirectory` to select a folder within the source
and `to` to prefix its game-folder paths. Archive entry paths are validated before extraction;
source symbolic links and archive links are rejected.

Without `recipe`, the script creates a copy step for every file in the combined source folders,
in source order. An identical shader at the same Windows path is allowed; different bytes at
the same shader path are rejected, including across tiers. Other overlapping paths use the
last source's bytes, allowing tested component replacements. Every source file is hashed.

**Only the shaders the presets use ship.** A shader pack holds far more effects than the presets
turn on, and ReShade never loads the rest. So by default the script keeps an effect only when a
shipped preset turns it on (`Techniques=Name@File.fx` in `reshade-presets`), then every `.fxh` it includes, from any shader folder, and the
textures named in those files or in a preset's preprocessor definitions. A licence or readme in a shader
folder stays while that folder still ships something. `TechniqueSorting` and `[File.fx]` value sections don't count: they list effects a
preset only remembers. For 2026.10.14 that is 67 files under `reshade-shaders` instead of 1,024: 20 effects, 28 includes,
17 textures and the pack's licence and readme.
Set `"shaders": "all"` on a tier to ship every shader and texture in its sources. With an explicit
`recipe` nothing is pruned. Only files a recipe copies are uploaded.

For explicit ordering or renames/deletions, provide `recipe` using the shared step kinds.
For a copy, `file` is the source's game-folder path rather than a SHA-256; the script replaces
it with its hash. Copy steps inherit a source's `when` unless explicitly set. For example:

```json
[
  { "kind": "copy", "file": "winmm.dll", "to": "winmm.dll" },
  { "kind": "copy", "file": "ReShade64.dll", "to": "ReShade.download", "when": "reshade" },
  { "kind": "rename", "from": "ReShade.download", "to": "ReShade64.dll", "when": "reshade" }
]
```

`knownBrokenGameVersions`, legacy `performanceProfiles`, `performanceProfilesV2` and `resetKeys` are stored and validated by the shared manifest schema.
The V2 field must contain all four profiles and can store a string or `1080p` / `1440p` / `4k+` values for each setting. The
app chooses a column from XIV's output height (<1300, <2000 or 2000+); GPU-name regexes optionally
recommend a profile, with Balanced as the fallback. The old field remains readable for older content,
and `performanceProfilesV2` is an optional addition that Lucent 0.1.x ignores. An optional `summary`
is the short Home description and accepts a string or the same resolution columns, so the UI can
describe upscaling without interpreting content keys. Tiers without profiles can omit the profile fields or use an empty list. `knownUserShaders` is optional: it lists shader filenames or relative shader
paths a preset may reference but the user must supply. Those files are excluded from sources,
even with `shaders: "all"`, and a recipe cannot copy or rename another file onto their paths.
Preset validation checks the effects each preset turns on (its `Techniques`,
after any profile edit) against the files actually deployed by each tier, with and without
optional ReShade.

OptiScaler source folders, OptiScaler-named files and `winmm.dll` need a GPL-3.0 component whose
`source` links to its exact GitHub source tag (`/tree/<tag>` or `/releases/tag/<tag>`).
Links to repository roots or ordinary development branches do not satisfy this check. The
source links are recorded in both the manifest and release notes.

## Publication and failures

Content date IDs are immutable. A date already in the manifest or an existing content release,
including a draft, is refused. Choose a new date after a published version needs changes.

After all local checks pass, the script paginates every content release and asset list.
Published hash-named assets are reused at their original release; drafts are not reusable.
New files are copied to temporary staging and hashed from those bytes, so changing an input
file later cannot change the bytes uploaded under that hash.

GitHub stores at most 1,000 assets per release and rejects zero-byte assets. The script
therefore refuses an empty source file up front, and a version with more than 1,000 new
files spans numbered overflow releases (`content-YYYY.MM.DD-2`, `-3`, …) alongside the
main one; the manifest records which release holds each file.

The script creates `content-YYYY.MM.DD` as a draft, uploads the new files, publishes the release,
and atomically replaces the local manifest. Both release requests explicitly use
[`make_latest: "false"`](https://docs.github.com/en/rest/releases/releases#create-a-release),
preserving the app's Latest release. Beta content releases are pre-releases.

An upload failure leaves a draft and the original manifest. Inspect or delete that draft before
retrying the same date. The script does not overwrite assets, delete remote releases or silently
resume partial publications. If publication succeeds but writing the local manifest fails, the
release remains published; recover its manifest entry from the tested input and release assets.
A manifest edited during publication is detected and never overwritten.

To promote Beta content, review an edit to that version's `channel` in the manifest and commit it.
The existing assets stay in their original release.

## Tests

`npm test -- scripts/publish-content.test.ts scripts/github.test.ts` checks the four refusal
fixture folders, the offline preview, reuse, failed uploads, GitHub pagination and Latest flags,
and a publish → core deployment → Healthy round trip. The archive test exercises real 7-Zip
when installed. Fixture DLLs and shaders are tiny inert text, never real third-party software.
