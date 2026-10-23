# Beta content candidate 2026.10.23

2026.10.21 with OptiScaler-FFXIV moved to its 2026.10.23 release, the fork's first official one (tag `ffxiv-2026.10.23-d9b62110`, commit `171bdb06`, still built on upstream OptiScaler `d9b62110`). It requires Lucent app `0.3.0-beta.8`, like 2026.10.21: the recipe uses nothing newer, so every Beta player on beta.8 or later gets it. Everything else (Streamline 2.14.16, the 310.9.16 runtimes, the Ember looks, ReShade, the tiers, the component list apart from the fork's source link) is 2026.10.21 unchanged. Read `content/candidates/2026.10.19/README.md` for what lands in the game folder.

`recipe.json` is 2026.10.21's with a new id, changelog, fork pins and fork source link. The decisions are in `docs/decisions.md` (OptiScaler-FFXIV and the 310.9.16 runtimes).

| Input | Pinned by |
| --- | --- |
| OptiScaler-FFXIV release `ffxiv-2026.10.23-d9b62110` (commit `171bdb06`) | The zip's SHA-256 `9d08f75a…` (the digest GitHub shows for the asset), then every file against the package's own `SHA256SUMS.txt`, then `winmm.dll` and `OptiScaler.ini` against `recipe.json` |
| Streamline SDK `v2.14.16`, the 310.9.16 runtimes, the maintainer's saved `OptiScaler.ini` | As in 2026.10.19 |
| `content/ember/palette.json` and the `ReShade.ini` it is applied to | As in 2026.10.20 |

## What changes in the game folder

The package holds the same 23 files as 2026.10.20's; five differ, and the dry run uploads exactly those five (29.4 MB) under `content-2026.10.23`. Every other file is already published under an earlier release and is reused by hash.

| File | Upload | Note |
| --- | --- | --- |
| `winmm.dll` | `a85a0fd2…`, 29.1 MB | The fork |
| `OptiScaler.ini` | `05b99670…`, 105,576 bytes | The fork's, with the saved values and overrides applied; see below |
| `nvngx.dll_dlssnr.dll` | `28f28d88…`, 151,552 bytes | The Neural Rendering forwarder, rebuilt: same size as 2026.10.20's (`37a38a00…`), new hash |
| `licenses/OptiScaler-FFXIV_NOTICE.txt` | `4bbcf0fa…`, 2,136 bytes | The package's `NOTICE.txt` |
| `licenses/ATTRIBUTION.md` | `0f8b446e…`, 5,792 bytes | The package's `Licenses\ATTRIBUTION.md` |

`INSTALL.txt` and `SHA256SUMS.txt` are not deployed, as before.

## The ini

Compared key by key with the `OptiScaler.ini` 2026.10.21 deploys: **ten keys added, none removed, none changed.** The saved values, the install-time choices and the twelve overrides come out as they did, so a new install or Reset gets 2026.10.21's file plus these ten, all `auto` (the fork's built-in default). An update adds them to an existing ini (`addMissingKeys`) and leaves every other value alone.

| Key | Default it resolves to |
| --- | --- |
| `[DLSSG] RenderPreset` | Auto: the render preset picker |
| `[DlssNr] Runtime` | Auto: the Neural Rendering model version picker |
| `[Mipmap] AutomaticFFXIV` | An alias of `MipmapBiasAuto`, which wins when both are set |
| `[Mipmap] MipmapBiasObserve` | Off: a debug log of the game's original sampler bias |
| `[DlssNr] PauseOnFocusLoss` | An alias of `DisableOnFocusLoss` (off) |
| `[FFXIV] JitterSource` | Off: the experimental source-level jitter fix |
| `[FFXIV] JitterScaleOverride` | 0, off: a fixed jitter scale for testing, used only with `JitterCorrection` |
| `[FramePacing] Trace` | Off at the normal log level: a diagnostic |
| `[FramePacing] HiddenPresentDoNotWait` | Off: a debug switch |
| `[NgxRelease] SkipReleaseSleep` | **On in FFXIV.** A quality change skips its 500 ms pause once the release has proven nothing still uses the old upscaler; `false` gives exactly the old behaviour |

`SkipReleaseSleep` is the one behaviour change an update brings through the ini, and the changelog says so. The package's `INSTALL.txt` lists the defaults that are on in FFXIV: that key and the automatic mipmap bias, which 2026.10.21 already had.

The package supports one game build (the 2026-10-20 patch, `ffxiv_dx11.exe` TimeDateStamp `0x6ad10bfd`); on another build its FFXIV-specific features switch themselves off until the fork is updated. The tiers carry no `knownBrokenGameVersions`.

## Assemble and dry-run

The saved `OptiScaler.ini` and the two Neural Rendering runtimes the earlier candidates read from `C:\Users\arnaudc\Desktop\nvngx_dlssnr` and `builds\backup-game-20261019-1834-release-20261019` are no longer at those paths. They come from the staged copies in `C:\LucentContent\candidate-2026.10.21\sources` instead: the same bytes, checked against the same hashes in `recipe.json` before anything is staged. The runtimes sit in `C:\LucentContent\nr-folder-2026.10.23`, laid out as the script expects (`20-30-40 series patched\` and `50 series\`) and hard-linked to those copies.

From the repository root, in PowerShell (Git Bash drops the backslashes). The command writes `publish.json`, `manifest.json`, `files\`, `provenance.json` and the staged `sources\`, and publishes nothing:

```powershell
npx tsx scripts/prepare-fork-candidate.ts --base C:\LucentContent\candidate-2026.10.17\publish.json --recipe content\candidates\2026.10.23\recipe.json --fork-zip C:\LucentContent\downloads-fork-2026.10.23\OptiScaler-FFXIV-ffxiv-2026.10.23-d9b62110.zip --streamline-zip C:\LucentContent\downloads\streamline-sdk-v2.14.16.zip --nr-folder C:\LucentContent\nr-folder-2026.10.23 --tuned-ini C:\LucentContent\candidate-2026.10.21\sources\saved-ini\OptiScaler.ini --output C:\LucentContent\candidate-2026.10.23
npm run publish:content -- C:/LucentContent/candidate-2026.10.23/publish.json --dry-run
```

## Checked and not checked

- The release zip's SHA-256 matches the digest GitHub shows for it, and the dry run reported 81 saved values carried, 17 left to the install or the recipe, 12 overrides and none lost.
- The published manifest adds one entry; the eight older versions are byte-identical.
- The published `Lucent.exe` 0.3.0-beta.9 ran against the live manifest and the `content-2026.10.23` release, in a fake game folder (a dummy `ffxiv_dx11.exe`) with its data folder redirected to scratch, on 2026-10-23. A first install put 170 files in place and ended healthy; `winmm.dll`, the forwarder, the Neural Rendering runtime and both licence files matched the manifest, and the deployed `OptiScaler.ini` differed from the candidate's only in the 24 install-time choices. Rolling back to 2026.10.21 restored its files from published releases. Applying 2026.10.23 over an ini edited to look like a 2026.10.21 one (the ten keys removed, `FontSize` tuned) logged "added 10 missing keys" and kept the tuned value. A changed `winmm.dll` and a deleted `ATTRIBUTION.md` showed under Show files as Changed and Missing, and Repair restored both. Uninstall left the folder identical to its vanilla hash listing.
- Not installed in a game. The maintainer played the fork release itself (RTX 4090, SDR); this content's behaviour in game (Neural Rendering, frame generation, the OptiScaler menu, `SkipReleaseSleep`) is unchecked.
