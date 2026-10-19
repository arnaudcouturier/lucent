# Beta content candidate 2026.10.19

OptiScaler now comes from OptiScaler-FFXIV, and the NVIDIA runtimes move to 310.9.16. It requires Lucent app `0.3.0-beta.7`, whose planner puts back the game's own file when an update stops deploying one it had replaced (the root `nvngx_dlss.dll`). Publish the app first, then this content.

`recipe.json` holds the reviewable data: the id, minimum app version, changelog, the three new components, the SHA-256 of every input, the Neural Rendering runtime for each tier and the menu theme. The decisions are in `docs/decisions.md` (OptiScaler-FFXIV and the 310.9.16 runtimes).

| Input | Pinned by |
| --- | --- |
| OptiScaler-FFXIV release `ffxiv-2026.10.19-d9b62110` (commit `d8e27f79`, its first release) | The zip's SHA-256 `6e50d2fa…`, then every file against the package's own `SHA256SUMS.txt`, then `winmm.dll` and `OptiScaler.ini` against `recipe.json` |
| Streamline SDK `v2.14.16` (`streamline-sdk-v2.14.16.zip`, production `bin\x64`) | The zip's SHA-256 `32041e51…`, then each extracted file against `recipe.json` |
| `nvngx_dlssnr.dll` 310.9.16, patched for RTX 20/30/40 and original for RTX 50 | Each file's SHA-256 in `recipe.json` |
| The maintainer's saved `OptiScaler.ini` (`--tuned-ini`) | `tunedIni.sha256`: its non-default values are carried over the fork's ini |

From the repository root, assemble the local dry-run candidate. It writes `publish.json`, `manifest.json`, `files\` for the dev build, `provenance.json` and the staged `sources\` (the two Neural Rendering runtimes are copied there, so the Desktop folder is only read once), and publishes nothing. The two zips are the release assets; the output folder is deleted and rebuilt on every run:

```powershell
npx tsx scripts/prepare-fork-candidate.ts --base C:\LucentContent\candidate-2026.10.17\publish.json --recipe content\candidates\2026.10.19\recipe.json --fork-zip C:\LucentContent\downloads\OptiScaler-FFXIV-2026.10.19-d9b62110.zip --streamline-zip C:\LucentContent\downloads\streamline-sdk-v2.14.16.zip --nr-folder C:\Users\arnaudc\Desktop\nvngx_dlssnr --tuned-ini C:\Users\arnaudc\workspace\OptiScaler-FFXIV\builds\backup-game-20261019-1834-release-20261019\OptiScaler.ini --output C:\LucentContent\candidate-2026.10.19
npm run publish:content -- C:/LucentContent/candidate-2026.10.19/publish.json --dry-run
```

To play it in a dev build, point the app at the candidate before `npm run tauri dev` (see `docs/manifest.md`):

```powershell
$env:LUCENT_DEV_MANIFEST = 'C:\LucentContent\candidate-2026.10.19\manifest.json'
$env:LUCENT_DEV_FILES = 'C:\LucentContent\candidate-2026.10.19\files'
```

The tier `rtx-30-40` is now `rtx-20-30-40` in every published version, with no migration. A deployment recorded under the old id (`%LOCALAPPDATA%\Lucent\deployments\<id>`) is stranded: the app lists no update for it, and its files may be gone already. Uninstall it from the app that made it while the files still exist, or move that folder aside, which keeps its backups.

## What changes in the game folder

Same deployment for both tiers, except for `nvngx_dlssnr.dll`: the patched 310.9.16 build on RTX 20/30/40, NVIDIA's original on RTX 50.

- **From the fork package:** `winmm.dll`, `nvngx.dll_dlssnr.dll`, `OptiScaler.ini`, the eight `OptiScaler\` libraries and `licenses\` (its `Licenses\` plus `NOTICE.txt` as `licenses\OptiScaler-FFXIV_NOTICE.txt`). `INSTALL.txt` and `SHA256SUMS.txt` are not deployed.
- **From the Streamline SDK:** `OptiScaler\nvngx_dlss.dll`, `OptiScaler\nvngx_dlssg.dll`, `OptiScaler\streamline\sl.{common,dlss_g,interposer,pcl,reflex}.dll`, the DLSS and Reflex licence texts and `licenses\Streamline_LICENSE.txt`.
- **Unchanged:** `libxell.dll` (the package doesn't ship it; RTX 30's Windows HDR frame generation uses XeFG), the AMD and Intel libraries, and everything ReShade.
- **No longer deployed** (25 files): the root `nvngx_dlss.dll`, `OptiScaler\nvngx_dlssd.dll`, `OptiScaler\nvfp4\*`, and the Streamline plugins and licence the fork doesn't load (`sl.deepdvc`, `sl.directsr`, `sl.dlss_d`, `sl.dlss_nr`, `sl.dlss`, `sl.nis`, `sl.nvperf`, `nis.license.txt`). `provenance.json` lists them.

## The ini

`OptiScaler.ini` is the fork's, with the non-default values of the maintainer's own saved ini written over the fork's, and its `auto` values written back where the fork's template pins a value (81 changes in all; `provenance.json` has each), so the file reads like the one in the maintainer's game folder. The menu theme and `[Log] LogToFile=false` go on top. Left at the fork's default: everything the install writes from the player's choices (frame generation, HDR and its peak nits, the frame cap, the Neural Rendering preset, passes, scale and toggles, the multi-frame unlock and the Fps key), plus `LogToFile` (logging ships off; `LogLevel=2` is carried for when a player turns it on) and the dragged menu height (`iniNotCarried` in `recipe.json`). Compared with that ini, the only differences are those keys, the theme and `LogToFile`. Menu: accent `1.0 / 0.392 / 0.039`, background `0.078 / 0.082 / 0.098` at 0.92 alpha, `OverlaysUseTheme`, Segoe UI at 13. An existing ini keeps its own values (`addMissingKeys`), so the theme and the options below reach new installs and Reset.

The release adds 14 keys. Of those, the saved ini switches these on, so they ship on:

| Key | What it does | Release notes say |
| --- | --- | --- |
| `[HudLess] Mode=recomposition` | DLSS-G recomposes the HUD from a HUD-less and a UI image | Tested in SDR |
| `[Window] Mode=on` | Removes the stray window edge after leaving borderless, and holds a window-mode switch until frame generation is off (needs ReShade and `[XeFG] ForceBorderless`) | Tested |
| `[Mipmap] MipmapBiasAuto=true`, offset `-0.18` | Mipmap bias follows the upscaling ratio | Tested |
| `[Companion] HudInterpolation=true` | One intermediate nameplate position (needs the FFXIV Companion plugin) | Not mentioned |
| `[FFXIV] PreviewNRBeforeSR=true` | Character preview: Neural Rendering before DLSS | Experimental |
| `[FFXIV] JitterCorrection=true` | Replaces the jitter reported to the upscaler with the one the game applies | Experimental, no visible difference |
| `[FFXIV] JitterProbe=true`, `[HudLess] Diagnostics=true` | Log lines about the game's jitter, and the HUD-less diagnostics card (this one also writes `OptiScaler\hudless-diag\`) | Diagnostic, "leave off in normal use" |

Not on in the saved ini, so off: `[DLSSG] AutoMFG` (the automatic multiplier, `AutoMFGMax`, `AutoMFGTarget`, `AutoMFGSelfTest`), `[Companion] HudReplacement`, `[HudLess] ReShadeProbe` and `MipmapBiasAuto`'s siblings. The frame generation choice in Lucent still decides the multiplier.
