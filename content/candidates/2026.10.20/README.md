# Beta content candidate 2026.10.20

2026.10.19 with the Ember menu look. OptiScaler-FFXIV moves to its 2026.10.20 release, whose only change is the `[Menu] Style = ember` option, and ReShade's menu gets the same palette. It requires Lucent app `0.3.0-beta.7`, like 2026.10.19. Everything else (Streamline 2.14.16, the 310.9.16 Neural Rendering runtimes, the tiers, the component list) is 2026.10.19 unchanged: read `content/candidates/2026.10.19/README.md` for what lands in the game folder and for the ini defaults.

`recipe.json` holds the reviewable data. The decisions are in `docs/decisions.md` (OptiScaler-FFXIV and the 310.9.16 runtimes).

| Input | Pinned by |
| --- | --- |
| OptiScaler-FFXIV release `ffxiv-2026.10.20-d9b62110` (commit `e9114013`) | The zip's SHA-256 `3272a471…`, then every file against the package's own `SHA256SUMS.txt`, then `winmm.dll` and `OptiScaler.ini` against `recipe.json` |
| Streamline SDK `v2.14.16`, the 310.9.16 runtimes, the maintainer's saved `OptiScaler.ini` | As in 2026.10.19 |
| `content/ember/palette.json` and the `ReShade.ini` it is applied to | `reshadeStyle.baseIniSha256` in `recipe.json` for the ini; the palette is the fork's own dump (`content/ember/README.md`) |

## The Ember style

- **OptiScaler:** `[Menu] Style = ember` is added to `iniOverrides` with the theme and `LogToFile=false`. The accent, background opacity and font stay what 2026.10.19 set, and Ember reads the accent and `BGColorA` from them. The fork's default stays `classic`, so a player who writes nothing sees upstream's look.
- **ReShade:** `reshadeStyle` rewrites `[STYLE]` of the base `ReShade.ini` from the palette (58 keys change: the colours and the corner rounding). The result ships in place of that file as a source with `when: 'reshade'`. ReShade has no padding keys, so only colour and rounding carry over, and the font stays Segoe UI at 13 in both menus.
- **Who gets it:** `[Menu] Style` is a key the 2026.10.19 ini lacks, so `addMissingKeys` adds `Style = ember` to an existing install on update, next to the accent and opacity it already has (those are never rewritten). ReShade does not follow: `ReShade.ini` is `keep`, so only new installs and Reset get its palette, and an updated install shows Ember in OptiScaler and its old colours in ReShade until it resets.

## Assemble and dry-run

From the repository root. The command writes `publish.json`, `manifest.json`, `files\`, `provenance.json` and the staged `sources\`, and publishes nothing; the output folder is deleted and rebuilt on every run:

```powershell
npx tsx scripts/prepare-fork-candidate.ts --base C:\LucentContent\candidate-2026.10.17\publish.json --recipe content\candidates\2026.10.20\recipe.json --fork-zip C:\LucentContent\downloads\OptiScaler-FFXIV-2026.10.20-d9b62110.zip --streamline-zip C:\LucentContent\downloads\streamline-sdk-v2.14.16.zip --nr-folder C:\Users\arnaudc\Desktop\nvngx_dlssnr --tuned-ini C:\Users\arnaudc\workspace\OptiScaler-FFXIV\builds\backup-game-20261019-1834-release-20261019\OptiScaler.ini --output C:\LucentContent\candidate-2026.10.20
npm run publish:content -- C:/LucentContent/candidate-2026.10.20/publish.json --dry-run
```

The dry run uploads 5 files (27.8 MB) under `content-2026.10.20`: the fork's `winmm.dll`, its `OptiScaler.ini`, its `NOTICE.txt`, the rebuilt `nvngx.dll_dlssnr.dll` stub and the styled `ReShade.ini`. Every other file is already published under an earlier release and is reused by hash.
