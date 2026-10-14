# Beta content candidate 2026.10.16

Neural Rendering controls replace the four performance profiles. The files are the same as 2026.10.15, so publishing uploads nothing new; only the recipe changes. It requires Lucent app `0.3.0-beta.1`.

`recipe.json` holds the reviewable data: the id, minimum app version, changelog, config update rules, `neuralRenderingControls` and `mfgUnlock`. The decisions behind them are in `docs/decisions.md`, the schema in `docs/manifest.md`.

From the repository root, derive the publisher input from the 2026.10.15 candidate's, then validate offline and publish:

```powershell
npx tsx scripts/derive-controls-candidate.ts --base C:\LucentContent\candidate-2026.10.15-final\publish.json --recipe content\candidates\2026.10.16\recipe.json --output C:\LucentContent\candidate-2026.10.16
npm run publish:content -- C:/LucentContent/candidate-2026.10.16/publish.json --dry-run
npm run publish:content -- C:/LucentContent/candidate-2026.10.16/publish.json
```

## What the controls write

| Control | Key | Values |
| --- | --- | --- |
| DLSS preset | `[QualityOverrides] ForcePerfQuality` | DLAA 5, Ultra Quality 4, Quality 2, Balanced 1, Performance 0, Ultra Performance 3 |
| Passes | `[DlssNr] Passes` | 1, 2, 3 |
| Neural Rendering resolution | `[DlssNr] WorkingScale` | 0.75, 1.0, 1.25 |
| Spatial compression | `[DlssNr] SpatialCompression` | true or false |
| Residual frame generation | `[DlssNr] ResidualFG` | true or false; RTX 40 and 50 with frame generation 2× or higher only |
| Unlock multi-frame generation (RTX 40) | `[DLSSG] AdaMfgUnlock` | true when on; gates 3×–6× and Dynamic |

Defaults: Quality with two passes on RTX 4090, 4080, 5090 and 5080; Quality with one pass on 4070 Ti, 5070 Ti, 3090 and 3080 Ti; Balanced with one pass elsewhere. Resolution 100%, both switches off.

## Config update rules

`OptiScaler.ini` adds only missing keys, so an existing config keeps every value. `ReShade.ini` and `ReshadeEffectShaderToggler.ini` stay as they are. **Settings → Reset setup…** shows the new choices and writes them.

## Notes

The preset names are OptiScaler's own: there is no "Super Quality"; the 1.3× preset is Ultra Quality. `ForceDMFG` stays `false` for every mode except Dynamic, which is Experimental and gated behind the unlock.
