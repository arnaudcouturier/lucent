# Beta content candidate 2026.10.15

This is the reviewable recipe for the local dry-run candidate. `recipe.json` supplies the immutable content id, minimum app version, changelog, profile/HDR data, component pins and GPU choice matrix. The local builder derives a complete publisher input from the maintainer's existing 2026.10.14 input so the paid-shader exclusions and tested preset inventory stay intact.

From the repository root, run:

```powershell
npm run prepare:candidate -- --source-root C:\LucentContent --output C:\LucentContent\candidate-2026.10.15
```

Both paths must be absolute. The output directory must not already exist. The helper copies the base OptiScaler INI and AMD/Intel files into new overlay folders, rewrites only that copied INI, and calls the publisher's offline dry-run validator. It writes the full `publish.json`, candidate `manifest.json`, source hashes and hash-named files beneath the output directory. It does not change the original `tested` sources or repository manifest, contact GitHub, launch Lucent/XIV, or write game/registry state. Use the resulting manifest and `files` folder only with a debug development build after the root task is ready.

The content date is unused in the local manifest and public Beta content releases were checked before preparation. The candidate requires app `0.2.0-beta.1`. The app and content still need the maintainer's publication review and live QA before any release or tag.

## Candidate choices

| GPU | SDR choice | Windows HDR choice | Status |
| --- | --- | --- | --- |
| RTX 30 | Off or 2× FSR frame generation | 2× XeFG | Experimental; XeFG MFG unlock stays false |
| RTX 40 | Off, 2×–6× DLSSG, Dynamic | DLSSG remains selected | 2× standard; 3×–6× and Dynamic Experimental pending 4090 QA |

RTX 30 has no 3×, 4× or Dynamic choice in this candidate. Those XeFG unlock modes remain deferred pending Intel license clearance. The RTX 30 2× HDR override is explicitly `FGOutput=xefg`, `UnlockMFG=false`, `InterpolationCount=1`, `MaxInterpolatedFrames=1` and `DynamicMFG=false`; switching Windows HDR off restores FSRFG 2× and the same disabled XeFG settings.

The candidate's Off/HDR/Scene HDR options write only their owned `[HDR] FfxivHDR` and `[HDR] Mode` keys; Off writes `FfxivHDR=false` and leaves Mode unspecified. HDR remains the default on a Windows HDR display. Scene HDR is Experimental. Peak nits, frame cap and both Dynamic frame-generation targets are monitor-derived rather than fixed values. The copied base INI leaves frame-generation and HDR option keys out so defaults and live changes use the same manifest transaction.

The four profiles use the #34 `ForcePerfQuality` columns (1080p / 1440p / 4K+): Ultra `2/2/2` with two passes; Fidelity `2/2/2` with one pass; Balanced `2/1/1` with one pass; Performance `1/1/0` with one pass, spatial compression and residual frame generation. Each profile also sets both compression flags explicitly to avoid inheriting an old INI value.

## Binary provenance and notices

- **AMD FidelityFX Frame Generation** is pinned to [FidelityFX SDK v2.3.0](https://github.com/GPUOpen-LibrariesAndSDKs/FidelityFX-SDK/tree/v2.3.0). The local frame-generation DLL reports `4.0.1.2740`; its loader reports `2.3.0.2740`. The exact `FidelityFX_v2_LICENSE.md` notice is overlaid at `licenses/FidelityFX_v2_LICENSE.md` and remains attached to the AMD component in the generated manifest.
- **Intel XeSS Frame Generation** is pinned to [XeSS SDK v3.0.2](https://github.com/intel/xess/tree/v3.0.2). The `libxess_fg.dll` (`1.3.1.78`), `libxell.dll` (`1.3.2.10`) and `XeSS_LICENSE.txt` were each SHA-256 compared with the official SDK archive and match byte-for-byte. The generated local provenance file records each hash. The notice remains attached to the Intel component.

The Intel license allows redistribution of the unmodified binary with its notice and forbids modification or alteration of the software or its operation, including during execution. The verified hashes establish the binaries' source and that Lucent copied the upstream bytes unchanged; they do not resolve the license interpretation for runtime use. The candidate includes no XeSS DLL patch or MFG unlock. Obtain publisher clearance before publicly shipping Intel-backed content; the RTX 30 2× option is only the pending-clearance user-requested candidate choice.

## 4090 QA before release

- Start from the existing 2026.10.14 Balanced RTX 4090 deployment. Change its profile to the old two-pass Fidelity profile in Lucent, update through Lucent using the candidate, then choose Ultra. Verify the new one-pass Fidelity and two-pass Ultra settings and confirm the original install baseline remains recoverable through the update journal. Do not edit the deployment record directly.
- On the 240 Hz display in XIV's exclusive-fullscreen mode, launch from Lucent and verify `[Framerate] FramerateLimit=224.000000`. Change XIV's selected exclusive refresh rate to 144 Hz in XIV's display settings (changing only desktop Hz may leave exclusive XIV at 240 Hz), close the game, and relaunch it from Lucent; verify `138.000000`. Restore 240 Hz in XIV and relaunch to verify `224.000000` again. Do not edit `FFXIV.cfg` directly.
- For each RTX 40 2×–6× option, verify the OptiScaler overlay multiplier and complete ten minutes of play without a crash. Verify Dynamic separately; omit it from public content if it fails.
- Test HDR and Scene HDR with Windows HDR on, the SDR fallback with Windows HDR off, Auto HDR disable/restore around launches, the HDR frame-generation choice, and screen-derived peak nits.
- Test each profile at the active resolution; confirm OptiScaler's last sizing response matches the profile table and Neural Rendering runs.
- Confirm Delete toggles Neural Rendering, Page Up/Page Down continue XIV zoom, and End toggles frame generation.
- Re-open Lucent and verify settings persist, then uninstall/recover through Lucent and verify the pre-candidate deployment baseline is restored.
