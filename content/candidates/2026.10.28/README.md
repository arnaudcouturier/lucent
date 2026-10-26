# Beta content candidate 2026.10.28

2026.10.27 with the Alive NEXT Stable 4K files removed, three ReShade settings changed (for new installs and for players already installed) and three Neural Rendering pass preset hints added to the Graphics step. OptiScaler-FFXIV moves from `ffxiv-2026.10.23-d9b62110` to **v0.2.0** (tag `ffxiv-2026.10.25-d9b62110`; see "OptiScaler-FFXIV v0.2.0"). The candidate is **not published**. Everything else (Streamline, the runtimes, the choices on the Graphics step, the Ember looks, the tiers) is 2026.10.27 unchanged.

It is `beta` with `minAppVersion` **1.0.2**, so only Beta players on Lucent 1.0.2 or later are announced it. Lucent 1.0.2 is the app release that reads `setKeys` (the working tree holds the change; the version is not bumped or released yet), so **the app goes out before this content**. Promote the content by editing its `channel` in `manifest.json`; it needs no new id, since it requires a Stable app.

## What changes

**Removed** (the recipe's `dropReshadeFiles`; `scripts/prepare-fork-candidate.ts` leaves their copy steps and the `shippedPresets` entry out):

- `reshade-presets/Alive NEXT WIP/Alive NEXT Stable 4K.ini`
- `reshade-shaders/Shaders/ffxiv_crashpad_4K.fx`
- `reshade-shaders/Shaders/ffxiv_common_4K.fxh` (included only by the one above)

Only the 4K preset turns on `FFXIV_Crashpad_4K`, so nothing else loses a shader, and the one technique that differs between the 4K preset and `Alive NEXT Stable.ini` is `FFXIV_Crashpad_4K` against `FFXIV_Crashpad`. The two shaders name no texture, and the 4K preset's only texture (`AliveReColor.png`) is the original preset's too, so no file is left behind. A diff of the 2026.10.27 and 2026.10.28 recipes for both tiers removes exactly these three paths and adds or changes nothing. `Alive NEXT Stable.ini` and the other four Alive presets stay. The dry run goes from 160 files and 58 shipped presets to 157 and 57.

**ReShade.ini** (the recipe's `reshadeSettings`):

| Section | Key | Was | Now | Written |
| --- | --- | --- | --- | --- |
| `GENERAL` | `SkipLoadingDisabledEffects` | `1` | `0` | install, Reset, and the update to 2026.10.28 |
| `GENERAL` | `NoDebugInfo` | `1` | `0` | install, Reset, and the update to 2026.10.28 |
| `OVERLAY` | `ShowForceLoadEffectsButton` | `1` | `1` | install, Reset, and the update to 2026.10.28 |
| `GENERAL` | `PresetPath`, `StartupPresetPath` | the player's | `Alive NEXT Stable.ini` | the update only, and only when it was the 4K preset |

The update writes them as `setKeys` on `ReShade.ini`'s `ownedConfigs` entry (`"onUpdate": true` in the recipe; `"ifPath"` for the preset move). The install and Reset get the same values from `ini_set` steps.

**The force-load button stays hidden.** ReShade draws it only while `SkipLoadingDisabledEffects` is on (`runtime_gui.cpp`, `draw_gui_home()`: `if (_effect_load_skipping && _show_force_load_effects_button)`), so with skipping off `ShowForceLoadEffectsButton = 1` has no visible effect. It is set because it was asked for. To have the button, change `SkipLoadingDisabledEffects` to `1` in `reshadeSettings` and in `site/guide.html`, and rewrite the changelog line.

`NoDebugInfo = 0` makes ReShade compile shaders with debug information (`#line` directives, names in the shader code). It has no visible effect in the game.

**Pass preset hints** (the recipe's `settingChoices`, three more after the DLSS model, UI mode and DLSS-G preset): `nr-hint-pass-1`, `nr-hint-pass-2` and `nr-hint-pass-3`, on both tiers, writing `[DlssNr] Preset`, `Pass2Preset` and `Pass3Preset`. They are the fork's "Advanced preset hints (effect unverified)": Pass 1 is Default or Preset 1 to 3 (values 0 to 3), passes 2 and 3 add Auto (inherit pass 1, written `auto`). They use the app's new `placement` (inside the Neural Rendering card, under a collapsed "Advanced Neural Rendering model hints (effect unverified)" heading) and `minPasses` (Pass 2 needs 2 passes, Pass 3 needs 3). The defaults are the shipped values (Preset 1, Default, Default; the base ini's `Preset = 1`, `Pass2Preset = 0`, `Pass3Preset = 0`), so the ini is byte for byte the same unless a player picks. The choice keys stay out of `chosenAtInstall`, as with the other choices. They are first-install choices: a new install and Reset setup write them, an update never does. Style and the per-pass styles are not offered.

**Character preview Neural Rendering** (`preview-nr`, the choice before the hints): Off or On, writing `[FFXIV] PreviewNR` to `false` or `true`, **Off by default**. It is the fork's Neural Rendering model on the character, equipment and glamour previews, one extra model per open window. **It is Off by default because it takes a lot of video memory.** The fork's own notes (`phase3-ledger/STUDY-portrait-nr-before-sr-LOG.md`) record about +183 MB and 2.8 ms of GPU time per window at the render size (`PreviewNRBeforeSR = true`, which ships) and about +739 MB and 4.1 ms after the DLSS step; Lucent has not measured it. The Off and On descriptions, the changelog and the guide say so; `docs/decisions.md` has the full reasoning. It is a plain block inside the Neural Rendering card (the app's `placement` with no group), listed ahead of the hints so their collapsed group stays last. The recipe's `iniOverrides` also set `PreviewNR = false`, so the base ini ships it off and the file and the choice agree; that changes `OptiScaler.ini`'s hash. The previous content shipped it `true`.

## What happens to players already installed

- **ReShade.ini keeps its `keep` rule.** The update sets the three keys above and the 4K preset move, and writes nothing else: layout, comments, other keys, the selected preset (unless it was the 4K one) and keybinds stay byte for byte. The journal backs the file up first, the changelog lists the keys ("Sets SkipLoadingDisabledEffects, NoDebugInfo and ShowForceLoadEffectsButton in ReShade.ini to the tested values. Your other settings stay."), and a rollback restores that copy, unless the player has changed the file since the update (ReShade rewrites it whenever a setting or preset changes), in which case the rollback keeps their file.
- **Once per key.** An update sets a key only when the deployed version's recipe does not already carry the same `setKeys` entry, so 2026.10.29, if it copies this recipe forward, does not set them again and a player who turns skipping back on keeps it. Remove the entries from a later recipe only if the intent is to change them again.
- **A player who skips this version** (2026.10.27 straight to 2026.10.29, say) gets the keys only if 2026.10.29 still carries them. Keep the entries in the recipe for as long as players on 2026.10.27 or earlier may still update.
- **The 4K files are deleted.** An unedited preset is deleted. A preset the player edited is first saved as `Alive NEXT Stable 4K (my edits).ini` (numbered if the name is taken) and that copy stays, as the player's own work; its `FFXIV_Crashpad_4K` technique will not load. A shader is deleted with no check for edits, after a hash-named backup in Lucent's data folder. Beyond the changelog, the status card and the update itself say nothing about the saved copy or the deleted shaders.
- **A player whose selected preset was the 4K one** is moved to Alive NEXT Stable, so ReShade does not start with an empty preset.
- **`OptiScaler.ini`** keeps `addMissingKeys`: a new OptiScaler build's new keys arrive, changed defaults do not. The pass preset hints and the character preview choice reach existing players only through Reset setup, which shows them with the defaults or the stored picks; an update does not write them. **A player already installed keeps `PreviewNR = true`** (decided 2026-10-24: leave existing setups as they are), since the previous content shipped it on and an update leaves a kept ini alone. Turning it off for them would need a `setKeys` entry on `OptiScaler.ini`, which the recipe does not wire up (`setKeys` is only emitted for `ReShade.ini`), and would override anyone who turned it on on purpose.
- A player on 1.0.1 or older does not see the version at all (`minAppVersion`). Older apps would read `ReShade.ini` as `keep` and ignore `setKeys`; checked by parsing this manifest with the 1.0.1 validator, which drops the field without an error.
- A locked `ReShade.ini` fails the update with "file is in use" rather than being skipped, as `replace` does.

## OptiScaler-FFXIV v0.2.0

The recipe's `fork` block, the `newComponents` source link and the changelog now point at the fork's **v0.2.0** release (2026-10-26), <https://github.com/arnaudcouturier/OptiScaler-FFXIV/releases/tag/ffxiv-2026.10.25-d9b62110>:

- **Tag and commit.** Tag `ffxiv-2026.10.25-d9b62110`, commit `6d1265d2`, on upstream `d9b62110`; a normal release marked Latest. The tag is what the manifest's source link, the Credits and the deployed `licenses/OptiScaler-FFXIV_NOTICE.txt` name. The fork's author first published v0.2.0 as a release candidate (tag `ffxiv-2026.10.25-d9b62110-rc1`, commit `e363700d`) and then replaced it with this clean tag and archive name; the release notes say the code is the same, with only documentation and two packaging-script lines changed in between. This candidate was first built on the rc1 package and then switched; nothing in the recipe or the manifest entry names rc1. That older release and tag have since been deleted on GitHub (confirmed 2026-10-25), so nothing can resolve to them.
- **Package.** `OptiScaler-FFXIV-ffxiv-2026.10.25-d9b62110.zip`, 132,603,104 bytes, SHA-256 `d7583a0df0f686ea3fd695188462e6c903282aa1a7fd51bf47f0382cd9160b9e`: it matches the digest GitHub shows and every line of the package's own `SHA256SUMS.txt` (`prepare-fork-candidate` checks both). It holds the same 23 entries as `2026.10.23`. `winmm.dll` is rebuilt (`f98a9221…`) and so is the `nvngx.dll_dlssnr.dll` forwarder (same size, new hash), and `OptiScaler.ini`, `NOTICE.txt`, `INSTALL.txt` and the licence and attribution files changed. Compared with the rc1 package, only `winmm.dll`, the forwarder, `NOTICE.txt` and `INSTALL.txt` differ (they carry the tag name and were rebuilt from the clean tag); `OptiScaler.ini` and the third-party DLLs are byte for byte the same. No file was added or removed, so no step of the deployment changed.
- **The ini.** Two keys were added, both `auto`: `[FFXIV] AutomaticReShadeDepth` and `AutomaticReShadeMotionScale`. Nothing was removed and no default changed, so the maintainer's saved values still apply (81 carried, 0 lost) and `Preset`, `Pass2Preset` and `Pass3Preset` (the pass hint defaults) and `PreviewNR` are still there with the same meaning.
- **What is new in the fork.** Automatic ReShade scene depth, opt-in and off by default (`AutomaticReShadeDepth`, or the checkbox in OptiScaler's FFXIV tab, card "ReShade depth compatibility"). When the game renders below the screen resolution, it lines up the depth, normals, decals and motion vectors that ReShade effects read with the upscaled picture. It needs ReShade 6.8.0 or newer with add-on support (the content ships 6.8.0) and stands down by itself if a preset scales or offsets depth by hand; this content's ReShade preprocessor definitions already set `RESHADE_DEPTH_INPUT_IS_REVERSED=1` as the fork's comment asks. The fork's author played it on one RTX 4090 in SDR with one preset; other presets, GPUs and HDR are untested. Lucent ships it off and offers no choice for it.
- **For players already installed.** `OptiScaler.ini` keeps `addMissingKeys`, so the update adds the two new keys at `auto` (off) and changes nothing else; the changelog says so ("Adds missing keys to OptiScaler.ini. Your values stay."). A publish uploads six files that differ from 2026.10.27: `winmm.dll` (29 MB), the forwarder (152 KB), `OptiScaler.ini` (108 KB) and three licence and notice files; the dry run's `uploads` list shows them. `minAppVersion` stays `1.0.2`: the build brings no option the app must offer.

For the next fork build, swap `fork` (`tag`, `commit`, `zipName`, `zipSha256`, `winmmSha256`, `iniSha256`), `newComponents[0].source` and the changelog, and rerun the commands below with the new zip. Check three things before publishing: the packaged `OptiScaler.ini` still has `[DlssNr] Preset`, `Pass2Preset` and `Pass3Preset` and `[FFXIV] PreviewNR` with the same meaning (the choices' defaults are `Preset=1`, `Pass2Preset=0`, `Pass3Preset=0` and `PreviewNR=false`); `prepare-fork-candidate` prints "0 saved values lost with keys the fork lacks"; and the package's file list is unchanged, or the new and removed files are accounted for in the dry run.

Release order: app 1.0.2 first (the version bump and `docs/releases/1.0.2.md` are in the working tree, uncommitted; the rest of `docs/release-checklist.md` is still to do), then publish this content with `npm run publish:content -- C:/LucentContent/candidate-2026.10.28/publish.json` (no `--dry-run`; it needs `gh` signed in and uploads the six files named above), review and commit the resulting `manifest.json`, then commit `site/guide.html` with it.

**Checked on the real exe (2026-10-25), outside the release checklist:** the 1.0.2 debug build, run in isolated data against a dummy game folder with `LUCENT_DEV_MANIFEST` and `LUCENT_DEV_FILES` pointing at this candidate's manifest and the content assets (hard-linked), XIV closed. The full account is in `docs/releases/1.0.2.md`. In short, and all as intended:

1. A first install of Stable 2026.10.27, then the Alive NEXT Stable 4K preset selected in ReShade, was Healthy.
2. Beta announced 2026.10.28 with the whole changelog and both automatic lines, and Update applied it in 54 s: the three 4K files were gone (172 files to 169), `ReShade.ini` differed from its pre-update copy by exactly `SkipLoadingDisabledEffects`, `NoDebugInfo` and `PresetPath` (now Alive NEXT Stable), `OptiScaler.ini` only gained the two new `auto` keys, and `PreviewNR` stayed `true`.
3. Rolling back to 2026.10.27 left both configs byte for byte equal to the copies and brought the 4K files back.
4. With the 4K preset edited, applying 2026.10.28 again saved `Alive NEXT Stable 4K (my edits).ini` byte for byte equal to the edit.
5. Reset setup offered the new choices (preview Off, hints collapsed, Pass 1 and Pass 2 at two passes), Review listed the picks made, and Apply wrote them (`PreviewNR=true`, `Preset=2`, `Pass2Preset=auto`, `Pass3Preset=0`).
6. Uninstall left only the game's own files and the saved "(my edits)" preset, and a fresh install with every default wrote `PreviewNR=false` and the shipped hint values.

Not covered: the rest of the release checklist (drift, XIVLauncher, window chrome, Windows 10) and a run against the real game folder. Re-run this check if the candidate changes again before publishing.

## Assemble and dry-run

From the repository root, in PowerShell (the Streamline and Neural Rendering inputs are the ones 2026.10.23 used; the fork zip is the v0.2.0 download):

```powershell
npx tsx scripts/prepare-fork-candidate.ts --base C:\LucentContent\candidate-2026.10.17\publish.json --recipe content\candidates\2026.10.28\recipe.json --fork-zip C:\LucentContent\downloads-fork-v0.2.0-clean\OptiScaler-FFXIV-ffxiv-2026.10.25-d9b62110.zip --streamline-zip C:\LucentContent\downloads\streamline-sdk-v2.14.16.zip --nr-folder C:\LucentContent\nr-folder-2026.10.23 --tuned-ini C:\LucentContent\candidate-2026.10.21\sources\saved-ini\OptiScaler.ini --output C:\LucentContent\candidate-2026.10.28
npm run publish:content -- C:/LucentContent/candidate-2026.10.28/publish.json --dry-run
```

Both ran on 2026-10-25 against the v0.2.0 package and exited 0. The dry run's `uploads` lists the six files named above and prints the same two shader-name warnings as before (`ffxiv_common.fxh`, `reshade.fxh`), which are expected.
