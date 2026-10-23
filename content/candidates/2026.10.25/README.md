# Beta content candidate 2026.10.25

2026.10.24 with a third first-install choice, the DLSS model. Nothing else changes: OptiScaler-FFXIV stays at `ffxiv-2026.10.23-d9b62110`, and the UI mode and DLSS-G preset choices, Streamline, the runtimes, ReShade, the Ember looks and the tiers are 2026.10.24 unchanged. It keeps `minAppVersion` at `0.3.0-beta.8`: Lucent 0.3.0-beta.10 already shows any `settingChoices` a tier declares, so this needs no new app, and an older app ignores the field and installs the base ini. The analysis is in `docs/optiscaler-options.md` ("DLSS model"), the decision in `docs/decisions.md`.

`recipe.json` is 2026.10.24's with a new id, changelog and one more entry at the head of `settingChoices`. The dry run uploads nothing: the base `OptiScaler.ini` is byte for byte 2026.10.24's, so the release `content-2026.10.25` holds only the notes.

## The choice

`dlss-model`, offered to both NVIDIA tiers and every card in them, with frame generation on or off.

| Option | `[DLSS] RenderPresetOverride` | `RenderPresetForAll` | NVIDIA's note (Streamline 2.14.16, `sl_dlss.h` and the DLSS programming guide) |
| --- | --- | --- | --- |
| Default | `false` | `0` | The game and the DLL choose; NVIDIA's defaults are K for DLAA, Quality and Balanced, M for Performance, L for Ultra Performance |
| Preset J | `true` | `10` | Similar to K, slightly less ghosting at the cost of extra flickering; K is recommended over J |
| Preset K | `true` | `11` | Default for DLAA, Quality and Balanced; best image quality at a higher performance cost |
| Preset L | `true` | `12` | Default for Ultra Performance; sharper and more stable than J and K, with less ghosting, and more expensive |
| Preset M (default) | `true` | `13` | Default for Performance; similar gains to L, closer in speed to J and K |

The default is M because that is what the base ini already holds (`RenderPresetOverride = true`, `RenderPresetForAll = 13`, carried from the maintainer's saved ini) and what content has shipped for every mode. The two keys are not in `chosenAtInstall` of `scripts/prepare-fork-candidate.ts`, so an app without the choice installs M as before. No other step or option writes a `[DLSS] RenderPreset*` key (checked against the manifest).

Not offered: A to D (removed from this DLSS generation), E and F (deprecated; whether 310.9.16 still honours them is not known), G to I, N and O (they revert to the default). Only M has been seen working: the maintainer's `OptiScaler.log` shows `Using App hint Preset M` for all six quality modes. J, K and L are documented by NVIDIA and not yet seen here.

An update leaves an existing `OptiScaler.ini` as it is, so the choice reaches new installs and Reset only.

## Assemble and dry-run

The same inputs as 2026.10.23. From the repository root, in PowerShell:

```powershell
npx tsx scripts/prepare-fork-candidate.ts --base C:\LucentContent\candidate-2026.10.17\publish.json --recipe content\candidates\2026.10.25\recipe.json --fork-zip C:\LucentContent\downloads-fork-2026.10.23\OptiScaler-FFXIV-ffxiv-2026.10.23-d9b62110.zip --streamline-zip C:\LucentContent\downloads\streamline-sdk-v2.14.16.zip --nr-folder C:\LucentContent\nr-folder-2026.10.23 --tuned-ini C:\LucentContent\candidate-2026.10.21\sources\saved-ini\OptiScaler.ini --output C:\LucentContent\candidate-2026.10.25
npm run publish:content -- C:/LucentContent/candidate-2026.10.25/publish.json --dry-run
```
