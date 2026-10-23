# Beta content candidate 2026.10.24

2026.10.23 with two more first-install choices, the UI mode and the DLSS-G preset, and the HUD-less diagnostics switched off. OptiScaler-FFXIV stays at its 2026.10.23 release (`ffxiv-2026.10.23-d9b62110`); Streamline, the runtimes, ReShade, the Ember looks and the tiers are 2026.10.23 unchanged. It keeps `minAppVersion` at `0.3.0-beta.8`: Lucent 0.3.0-beta.10 shows the choices, and an older app ignores the new tier field and installs the base ini. The analysis behind it is `docs/optiscaler-options.md`; the decisions are in `docs/decisions.md` ("OptiScaler-FFXIV options as setup choices").

`recipe.json` is 2026.10.23's with a new id, changelog, `settingChoices` and one more entry in `iniOverrides`; the pinned inputs are the same, so the same command assembles it.

## What changes

| Change | Where | Effect |
| --- | --- | --- |
| `settingChoices` on both tiers | `recipe.json`, copied into each tier of the manifest | App 0.3.0-beta.10 and later offer UI mode and DLSS-G preset on the Graphics step |
| `[HudLess] Diagnostics = false` | `iniOverrides` | The one byte that differs in `OptiScaler.ini` (105,577 bytes; 2026.10.23's was `true`) |

The dry run uploads exactly one file under `content-2026.10.24`, that `OptiScaler.ini`; every other file is reused by hash. Compared key by key with 2026.10.23's ini, `[HudLess] Diagnostics` is the only key that differs, so the base ini still carries `[HudLess] Mode = recomposition` and leaves `[DLSSG] RenderPreset` at `auto`. Those two keys are deliberately not in `chosenAtInstall` of `scripts/prepare-fork-candidate.ts`: an app without the choices installs what 2026.10.23 installed.

## The choices

Both are offered to RTX 40 and RTX 50 cards (`RTX\s?40[0-9]{2}`, `RTX\s?50[0-9]{2}`) and shown only while frame generation is not Off.

| Choice | Options (default first) | Keys written | Blocks |
| --- | --- | --- | --- |
| UI mode | Recomposition, Off, UI-free (Experimental) | `[HudLess] Mode` = `recomposition`, `off`, `ui_free` | UI-free while HDR is not Off |
| DLSS-G preset | Auto, Preset A, Preset B, Preset C | `[DLSSG] RenderPreset` = `0`, `1`, `2`, `3` | Preset A and C while the UI mode is Recomposition |

A card the choices are not offered to (RTX 20 and RTX 30) gets `[HudLess] Mode = off` from a new install or Reset made by the new app, because its frame generation is FSR or XeFG and the fork has not tested the UI modes with those outputs; it gets no `RenderPreset`. The fork's own notes carry every status: Recomposition was tested in SDR at 2× to 4× on an RTX 4090 with no visible difference from Off; UI-free is experimental and was seen in fallback for a whole session; the presets were booted and switched without a refusal but their picture and cost are unmeasured.

An update leaves an existing `OptiScaler.ini` as it is, so the choices reach new installs and Reset only. Both keys already exist in the ini, so `addMissingKeys` adds nothing here.

## Assemble and dry-run

The same inputs as 2026.10.23 (see its README for where they came from). From the repository root, in PowerShell:

```powershell
npx tsx scripts/prepare-fork-candidate.ts --base C:\LucentContent\candidate-2026.10.17\publish.json --recipe content\candidates\2026.10.24\recipe.json --fork-zip C:\LucentContent\downloads-fork-2026.10.23\OptiScaler-FFXIV-ffxiv-2026.10.23-d9b62110.zip --streamline-zip C:\LucentContent\downloads\streamline-sdk-v2.14.16.zip --nr-folder C:\LucentContent\nr-folder-2026.10.23 --tuned-ini C:\LucentContent\candidate-2026.10.21\sources\saved-ini\OptiScaler.ini --output C:\LucentContent\candidate-2026.10.24
npm run publish:content -- C:/LucentContent/candidate-2026.10.24/publish.json --dry-run
```
