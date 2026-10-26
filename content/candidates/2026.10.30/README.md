# Stable content candidate 2026.10.30

2026.10.29 on **OptiScaler-FFXIV v0.3.0** (tag `ffxiv-2026.10.26-d9b62110`, commit `d14df8b0`). Everything else (Automatic ReShade scene depth on by default, the Alive 4K removal, the ReShade settings, the Graphics-step choices, Streamline, the runtimes, the tiers) is 2026.10.29 unchanged. It is `stable` with `minAppVersion` **1.0.2**: v0.3.0 brings no option the app must offer, so it does not wait for any app release. Its changelog repeats the earlier lines with the depth entry reworded, because a player on 2026.10.27, .28 or .29 sees this version's lines only.

## What the fork changed

- **Package.** `OptiScaler-FFXIV-ffxiv-2026.10.26-d9b62110.zip`, 132,723,251 bytes, SHA-256 `190ca55056136ddc46b36ea8ecf89c98601df7c9a3916cb3e442b290d99c2427`: it matches the digest GitHub shows and every line of the package's own `SHA256SUMS.txt` (`prepare-fork-candidate` checks both). It holds the same 23 entries as v0.2.0. `winmm.dll` (`3e2131aa…`), the `nvngx.dll_dlssnr.dll` forwarder, `OptiScaler.ini` (`75f166cd…`), `NOTICE.txt` and `INSTALL.txt` are rebuilt or changed; nothing was added or removed, so no step of the deployment changed.
- **The ini.** Three keys were added, all `auto`: `[FFXIV] FfxivUnknownBuildHooks`, `FfxivForceUnknownBuild` and `FfxivLegacyGameBuild`. Nothing was removed and no default changed, so the maintainer's saved values carry over (81 carried, 0 lost) and the choices' defaults (`Preset=1`, `Pass2Preset=0`, `Pass3Preset=0`, `PreviewNR=false`, `AutomaticReShadeDepth=true`) are as in 2026.10.29.
- **Game build detection by pattern search.** The fork used to hook and read the game at the addresses of one build, so a patch switched those features off until the table was rebuilt by hand. v0.3.0 searches the executable for the instruction patterns the supported build was verified with (about 0.2 s, once, when the first D3D11 device is hooked). On the supported build the result is checked against the table and the table wins. After a patch the features that identify the game by program name or shader fingerprint keep running; the ones that read or hook the game's code run only with `FfxivUnknownBuildHooks = true` and only if the search found every address they need. The fork says this is **not proven on a real game patch**, so the key ships off. `FfxivForceUnknownBuild` is a debug key and `FfxivLegacyGameBuild` a rollback to the old behaviour.
- **The upstream update check is off.** `[Hotfix] CheckForUpdate` stays off unless set to `true`. The shipped ini has `CheckForUpdate=auto`, so a new install, Reset and an update all get the new default with no ini change. (The package's ini comment still says "Default (auto) is true"; the fork's code and release notes say otherwise, and the guide does not repeat the comment.)
- **Tested by the fork's author:** once, in game on 2026-10-26, on an RTX 4090 in SDR, in a normal run, a run with Dalamud and a run with the table ignored; all 81 addresses found with none disagreeing with the table. Not tried: a real game patch, HDR, AMD or Intel cards, and the rollback key.

## What it means for Lucent

- **No new first-install choice.** The three keys have no menu control and matter after a patch, when a choice (written once at install or Reset) cannot help. `FfxivUnknownBuildHooks` gets a Settings switch instead, in app 1.0.3 (`docs/decisions.md`, "Content 2026.10.30 moves to OptiScaler-FFXIV v0.3.0"); this version only ships the key at `auto`. The guide documents all three keys and the update check.
- **Existing players.** `OptiScaler.ini` keeps `addMissingKeys`, so the update adds the three keys at `auto` and changes nothing else; the changelog says so ("Adds missing keys to OptiScaler.ini. Your values stay."). The `optiscalerUpdateKeys` entry from 2026.10.29 stays, so a player who took 2026.10.28 and goes straight to .30 still gets the depth switched on while the key reads `auto`. A publish uploads four files that differ from 2026.10.29: `winmm.dll` (29 MB), the forwarder (152 KB), `OptiScaler.ini` (111 KB) and `NOTICE.txt`.

## Assemble and dry-run

From the repository root, in PowerShell (the Streamline and Neural Rendering inputs are the ones 2026.10.23 used; the fork zip is the v0.3.0 download):

```powershell
npx tsx scripts/prepare-fork-candidate.ts --base C:\LucentContent\candidate-2026.10.17\publish.json --recipe content\candidates\2026.10.30\recipe.json --fork-zip C:\LucentContent\downloads-fork-v0.3.0\OptiScaler-FFXIV-ffxiv-2026.10.26-d9b62110.zip --streamline-zip C:\LucentContent\downloads\streamline-sdk-v2.14.16.zip --nr-folder C:\LucentContent\nr-folder-2026.10.23 --tuned-ini C:\LucentContent\candidate-2026.10.21\sources\saved-ini\OptiScaler.ini --output C:\LucentContent\candidate-2026.10.30
npm run publish:content -- C:/LucentContent/candidate-2026.10.30/publish.json --dry-run
```

The dry run exits 0 and uploads the four files above.
