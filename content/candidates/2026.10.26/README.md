# Beta content candidate 2026.10.26

2026.10.25 with two more options in the DLSS model choice: Preset E and Preset F, tagged Experimental and listed after M. Nothing else changes: OptiScaler-FFXIV stays at `ffxiv-2026.10.23-d9b62110`, and the other choices, Streamline, the runtimes, ReShade, the Ember looks and the tiers are 2026.10.25 unchanged. It keeps `minAppVersion` at `0.3.0-beta.8`: Lucent 0.3.0-beta.10 shows any `settingChoices` a tier declares, so it needs no new app. The analysis is in `docs/optiscaler-options.md` ("DLSS model").

`recipe.json` is 2026.10.25's with a new id, changelog and two more options on `dlss-model`. The dry run uploads nothing: the base `OptiScaler.ini` is byte for byte 2026.10.24's and 2026.10.25's.

## The two options

| Option | `[DLSS] RenderPresetOverride` | `RenderPresetForAll` | NVIDIA's note (Streamline 2.14.16) |
| --- | --- | --- | --- |
| Preset E | `true` | `5` | Deprecated: a legacy preset whose support NVIDIA has deprecated |
| Preset F | `true` | `6` | Deprecated: the same |

The default is still Preset M, and the ini still carries `RenderPresetOverride = true`, `RenderPresetForAll = 13` for an app without the choice. E and F are opt-in (the Experimental tag) because NVIDIA's header and guide say the support is deprecated and nothing says whether the 310.9.16 DLL still honours them. Nobody has run them here. `OptiScaler.log` has the answer: with `RenderPresetForAll = 5` or `6`, a line `Using App hint Preset E` (or `F`) means the DLL took the letter, and a line that still names the default means it did not. Presets A to D (removed), G to I, N and O (revert to the default) are not offered.

An update leaves an existing `OptiScaler.ini` as it is, so the choice reaches new installs and Reset only.

## Assemble and dry-run

The same inputs as 2026.10.23. From the repository root, in PowerShell:

```powershell
npx tsx scripts/prepare-fork-candidate.ts --base C:\LucentContent\candidate-2026.10.17\publish.json --recipe content\candidates\2026.10.26\recipe.json --fork-zip C:\LucentContent\downloads-fork-2026.10.23\OptiScaler-FFXIV-ffxiv-2026.10.23-d9b62110.zip --streamline-zip C:\LucentContent\downloads\streamline-sdk-v2.14.16.zip --nr-folder C:\LucentContent\nr-folder-2026.10.23 --tuned-ini C:\LucentContent\candidate-2026.10.21\sources\saved-ini\OptiScaler.ini --output C:\LucentContent\candidate-2026.10.26
npm run publish:content -- C:/LucentContent/candidate-2026.10.26/publish.json --dry-run
```
