# Stable content candidate 2026.10.29

2026.10.28 with one change: **Automatic ReShade scene depth is on by default.** It is the opt-in feature OptiScaler-FFXIV v0.2.0 added (`[FFXIV] AutomaticReShadeDepth`, in OptiScaler's menu the checkbox "ReShade depth compatibility" on the FFXIV tab). 2026.10.28 shipped it at `auto`, which the fork reads as off. Everything else (the fork build `ffxiv-2026.10.25-d9b62110`, the Alive 4K removal, the ReShade settings, the Graphics-step choices) is 2026.10.28 unchanged.

It is `stable` with `minAppVersion` **1.0.2**, like 2026.10.28 after its promotion. It is a new id because a published content id is immutable (`docs/publishing.md`). Its changelog repeats 2026.10.28's lines with the depth line rewritten, because a player on 2026.10.27 is shown this version's changelog only.

## What changes

- **The ini.** The recipe's `iniOverrides` add `[FFXIV] AutomaticReShadeDepth = true`, so the base `OptiScaler.ini` ships it on. A publish uploads one new file, `OptiScaler.ini` (108 KB); `winmm.dll` and everything else are reused from 2026.10.28's release. `AutomaticReShadeMotionScale` stays `auto`.
- **Who gets it on.**
  - A new install or Reset setup writes the baseline, so it is on.
  - A player on 2026.10.27 who updates straight to this version: the key is absent on disk, `OptiScaler.ini` has the `addMissingKeys` rule, so the update adds it with the baseline's value, `true`.
  - A player who already took 2026.10.28 has the key at `auto`. The recipe's new `optiscalerUpdateKeys` (emitted as `setKeys` on `OptiScaler.ini`, `"ifPath": "auto"`) sets it to `true` only while it still reads `auto`, so a value the player set in the overlay (`true` or `false`) is left alone. `ifPath` compares as a path, which for a plain value is a case-insensitive string match. Once per key, as for the ReShade keys, and it needs no new app (1.0.2 applies `setKeys` to any config).
- **Why on.** The maintainer's call (2026-10-26): when the game renders below the screen resolution, ReShade effects such as MXAO read depth that does not line up with the picture, and the fork's feature fixes it.
- **The risk, as the fork states it.** It was played in game on 2026-10-25 on one RTX 4090 in SDR with one preset (Alive NEXT Stable, at DLAA, Performance and Quality). Other presets, other GPUs and HDR were not tried. It needs ReShade 6.8.0 or newer with add-on support (the content ships 6.8.0), and it stands down by itself while a preset scales or offsets depth by hand (`RESHADE_DEPTH_INPUT_X_SCALE` and the like); this content's ReShade preprocessor definitions do neither, and already set `RESHADE_DEPTH_INPUT_IS_REVERSED=1`, which the fork's comment asks for. With "Include ReShade" off the key does nothing. A player turns it off in OptiScaler's menu. The changelog and the guide say all of this.
- **No Lucent choice.** It ships on, with no first-install control; the overlay is where a player switches it.

## What was checked

- The dry run exits 0, uploads one file (`OptiScaler.ini`) and the manifest entry carries `setKeys` on `OptiScaler.ini` for both tiers. `src/shared/candidateConfigs.test.ts` reads the recipe: the key ships `true`, the update key waits for `auto`, the changelog says it is on and still names the 4K removal, and `PreviewNR` stays off.
- `src/core/configRules.test.ts` runs the update on an `OptiScaler.ini` with `addMissingKeys` and this `setKeys` entry: a setup that never had the key gets it as `true`, one at `auto` (any case or spacing) is switched to `true`, and a value the player set (`true` or `false`) is left alone and the file is not rewritten.
- **Not run: this version on the real exe.** The game was running on the machine, and the real-exe check needs XIV closed. The mechanism itself (`setKeys` on update, with `addMissingKeys`) was exercised on the real exe for `ReShade.ini` on 2026-10-25 (`docs/releases/1.0.2.md`); `OptiScaler.ini` goes through the same code. When XIV is closed, repeat that check with a setup on 2026.10.27 and one on 2026.10.28.

## Assemble and dry-run

From the repository root, in PowerShell (the same inputs as 2026.10.28):

```powershell
npx tsx scripts/prepare-fork-candidate.ts --base C:\LucentContent\candidate-2026.10.17\publish.json --recipe content\candidates\2026.10.29\recipe.json --fork-zip C:\LucentContent\downloads-fork-v0.2.0-clean\OptiScaler-FFXIV-ffxiv-2026.10.25-d9b62110.zip --streamline-zip C:\LucentContent\downloads\streamline-sdk-v2.14.16.zip --nr-folder C:\LucentContent\nr-folder-2026.10.23 --tuned-ini C:\LucentContent\candidate-2026.10.21\sources\saved-ini\OptiScaler.ini --output C:\LucentContent\candidate-2026.10.29
npm run publish:content -- C:/LucentContent/candidate-2026.10.29/publish.json --dry-run
```

The dry run exits 0 and uploads one file, `OptiScaler.ini`.
