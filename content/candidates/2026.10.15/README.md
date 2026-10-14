# Beta content candidate 2026.10.15

This is the reviewable recipe for the local dry-run candidate. `recipe.json` supplies the immutable content id, minimum app version, changelog, profile/HDR data, component pins and GPU choice matrix. The local builder derives a complete publisher input from the maintainer's existing 2026.10.14 input so the paid-shader exclusions and tested preset inventory stay intact.

From the repository root, run:

```powershell
npm run prepare:candidate -- --source-root C:\LucentContent --output C:\LucentContent\candidate-2026.10.15
```

Both paths must be absolute. The output directory must not already exist. The helper copies the base OptiScaler INI and AMD/Intel files into new overlay folders, rewrites only that copied INI, and calls the publisher's offline dry-run validator. It writes the full `publish.json`, candidate `manifest.json`, source hashes and hash-named files beneath the output directory. It does not change the original `tested` sources or repository manifest, contact GitHub, launch Lucent/XIV, or write game/registry state. Use the resulting manifest and `files` folder only with a debug development build after the root task is ready.

The content date is unused in the local manifest and public Beta content releases were checked before preparation. The candidate requires app `0.2.0-beta.1`, which is the version in `package.json` for the app release that carries the first-install choices, Reset and config update rules.

## Config update rules

The generated manifest gives every owned config an explicit rule for updates from the current content:

| Config | Rule | Rationale |
| --- | --- | --- |
| `OptiScaler.ini` | `addMissingKeys` | Add frame-generation, HDR, screen-derived and profile keys that are absent while preserving the player's existing values and choices. Fresh deployment and **Reset setup…** write the complete tested baseline, including the new Delete hotkey. |
| `ReShade.ini` | `keep` | No ReShade layout change; preserve the active preset, keybinds and overlay choices. |
| `ReshadeEffectShaderToggler.ini` | `keep` | No Shader Toggler layout change; preserve effect groups and keybinds. |

These rules are copied into `publish.json` by the candidate helper and validated by the offline publisher. The content changelog therefore does not claim that an update silently changes a player's existing OptiScaler values; use **Reset setup…** when the tested baseline and first-install choices should be applied again.

## Candidate choices

| GPU | SDR choice | Windows HDR choice | Status |
| --- | --- | --- | --- |
| RTX 30 | Off or 2× FSR frame generation | 2× XeFG | Experimental; XeFG MFG unlock stays false |
| RTX 40 | Off, 2×–6× DLSSG, Dynamic | DLSSG remains selected | 2× standard; 3×–6× and Dynamic Experimental by design; complete 4090 matrix manually tested and attested |

RTX 30 has no 3×, 4× or Dynamic choice in this candidate. Those XeFG unlock modes remain deferred pending Intel license clearance. The selected HDR mode controls the RTX 30 2× provider at install or Reset: the HDR choice uses `FGOutput=xefg`, `UnlockMFG=false`, `InterpolationCount=1`, `MaxInterpolatedFrames=1` and `DynamicMFG=false`; the SDR choice uses FSRFG 2×. Windows HDR activation remains a separate display warning and does not silently change the selected provider.

The candidate's Off/HDR/Scene HDR options write only their owned `[HDR] FfxivHDR` and `[HDR] Mode` keys; Off writes `FfxivHDR=false` and leaves Mode unspecified. HDR remains the default on a Windows HDR display. Scene HDR is Experimental. Peak nits, frame cap and both Dynamic frame-generation targets are monitor-derived rather than fixed values. The copied base INI leaves frame-generation and HDR option keys out so a fresh deployment or Reset supplies the selected choices; screen-derived values are computed when Lucent writes that baseline and are retained during ordinary updates.

The four profiles use the #34 `ForcePerfQuality` columns (1080p / 1440p / 4K+): Ultra `2/2/2` with two passes; Fidelity `2/2/2` with one pass; Balanced `2/1/1` with one pass; Performance `1/1/0` with one pass, spatial compression and residual frame generation. Each profile also sets both compression flags explicitly to avoid inheriting an old INI value.

## Binary provenance and notices

- **AMD FidelityFX Frame Generation** is pinned to [FidelityFX SDK v2.3.0](https://github.com/GPUOpen-LibrariesAndSDKs/FidelityFX-SDK/tree/v2.3.0). The local frame-generation DLL reports `4.0.1.2740`; its loader reports `2.3.0.2740`. The exact `FidelityFX_v2_LICENSE.md` notice is overlaid at `licenses/FidelityFX_v2_LICENSE.md` and remains attached to the AMD component in the generated manifest.
- **Intel XeSS Frame Generation** is pinned to [XeSS SDK v3.0.2](https://github.com/intel/xess/tree/v3.0.2). The `libxess_fg.dll` (`1.3.1.78`), `libxell.dll` (`1.3.2.10`) and `XeSS_LICENSE.txt` were each SHA-256 compared with the official SDK archive and match byte-for-byte. The generated local provenance file records each hash. The notice remains attached to the Intel component.

The Intel license allows redistribution of the unmodified binary with its notice and forbids modification or alteration of the software or its operation, including during execution. The verified hashes establish the binaries' source and that Lucent copied the upstream bytes unchanged. The candidate includes no XeSS DLL patch or MFG unlock; its approved RTX 30 scope is Off/2× FSR in SDR and the 2× XeFG HDR fallback with MFG unlock disabled. Only RTX 30 XeFG 3×, 4× and Dynamic MFG unlocks remain deferred pending license clearance. The hashes do not establish whether an MFG unlock complies with the runtime-operation clause.

## 4090 QA record

The maintainer confirmed on 2026-10-14 that the frame-generation modes, HDR methods and four profiles had already been tested manually and passed. That confirms the content choices; it does not establish manual testing of the newly implemented Reset flow. The checklist below describes verification through a fresh deployment or **Settings → Reset setup…** with the game closed. A Reset is required when changing the profile, frame-generation mode or HDR mode; do not switch these through Home or by editing the deployment record.

- RTX 40 frame generation: **Off**, **2×**, **3×**, **4×**, **5×**, **6×** and **Dynamic**. For each choice, verify the overlay mode and complete ten minutes of play without a crash.
- HDR: **Off**, **HDR** and **Scene HDR** with Windows HDR on where supported; repeat the frame-generation choices that are offered with each selected HDR mode, verify the screen-derived peak nits, and confirm the Windows HDR activation warning. The selected HDR mode determines the RTX 30 provider even when Windows HDR is currently off.
- Profiles: **Ultra**, **Fidelity**, **Balanced** and **Performance** at the active resolution. Confirm the profile's Neural Rendering pass count, quality column and compression/residual settings.
- Screen-derived values: verify the frame cap and Dynamic targets for the active display, then use Reset after a display refresh-rate change to confirm the new baseline is computed from that display. Existing configs retain their values during ordinary update/launch.
- Hotkeys: confirm Delete toggles Neural Rendering, Page Up/Page Down remain XIV zoom, and End toggles frame generation.
- Re-open Lucent and verify the selected choices persist. Use deployment history to roll back to 2026.10.14 and verify that candidate content is removed and the prior content is restored. Uninstall remains a separate operation that restores the pre-first-deployment baseline.

Gameplay results for the content choices are maintainer-attested, not agent-observed. Reset, rollback and uninstall behavior are covered by automated tests; manual verification of the new app flow has not been recorded here.

## Offline and live publication commands

From the repository root, prepare the candidate and run the offline validation (the helper also invokes the same dry-run publisher):

```powershell
npm run prepare:candidate -- --source-root C:\LucentContent --output C:\LucentContent\candidate-2026.10.15
npm run publish:content -- C:\LucentContent\candidate-2026.10.15\publish.json --dry-run --manifest manifest.json
```

After app `0.2.0-beta.1` is released and the attested QA is accepted, publish the immutable content version with the same input. The live command requires `gh auth login`; it is intentionally not run by this preparation:

```powershell
npm run publish:content -- C:\LucentContent\candidate-2026.10.15\publish.json --manifest manifest.json
```
