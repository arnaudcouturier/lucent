# Lucent — Design Decisions

Settled in a design grilling session on 2026-10-12. Each section is a decision; "Deferred" lists what is intentionally still open.

## Product

- **Lucent** is a public, open-source (MIT for our own code) Windows manager for FFXIV that deploys OptiScaler with DLSS 5 Neural Rendering, ReShade (add-on build), shaders and presets.
- It is a **manager, not a one-shot installer**: it stays useful after setup (repair after patches, profile switching, updates, rollback, clean uninstall).
- **Form:** one portable GUI `.exe`. No `.bat` / `.ps1`.
- **Stack:** Tauri 2 + React + TypeScript. Rust side stays thin: file ops, hashing, archive extraction, registry, GPU detection. Chosen because the project is vibe-coded and TS/React gives the highest aesthetic ceiling; Electron rejected (portable build unpacks on every launch), WinUI/WPF rejected (single-file pain, lower ceiling).
- On first run it offers to install itself to `%LOCALAPPDATA%\Lucent` with a Start Menu shortcut and a per-user Settings → Apps entry (no admin).
- Windows 10 22H2 and 11, x64 only. English only. No telemetry.
- Name: **Lucent**. Use "XIV" rather than "FFXIV"/"Final Fantasy" in branding. No Square Enix logos, art or fonts.

## GPU tiers

Tiers are data in the manifest, not code. Lucent always picks the discrete GPU (the dev machine has an RTX 4090 plus an AMD iGPU) and offers a tier switch when the GPU changes.

| Tier | Payload | Status at launch |
|---|---|---|
| RTX 50 | NVIDIA original `nvngx_dlssnr.dll` runtime + full stack | Community-verified (cannot be tested on dev machine) |
| RTX 30/40 | ShortFuse compatibility runtime + full stack | Stable (tested on 4090) |
| RTX 20 | Compatibility runtime + full stack | Experimental |
| Radeon | OptiScaler FSR upscaling + FSR frame gen + ReShade, no Neural Rendering | Experimental until a real Radeon owner confirms |
| Anything else | ReShade + presets only | Stable |

Untested tiers stay Experimental (labelled in the UI) until testers confirm them.

## First-run flow

1. **Scan**: game folder, GPU, launcher, existing mods.
   - Game detection order: XIVLauncher `%APPDATA%\XIVLauncher\launcherConfigV3.json` (`GamePath`), Steam libraries (app 39210), Square Enix launcher uninstall registry entry, default paths, manual picker validated by `game\ffxiv_dx11.exe`.
   - Existing mods detected: GPosingway, leftover GShade files, regular ReShade (`dxgi.dll` etc.), other OptiScaler installs, swapped DLSS DLLs.
2. **Performance profile**: Fidelity / Balanced / Performance. The only first-run choice.
3. **Review**: "Include ReShade" checkbox (on by default; always on for Radeon/other tiers), plus files backed up / added and download size.
4. **Install**, then a done screen that teaches the hotkeys (Insert = OptiScaler overlay, Home = ReShade).

- All presets are always installed; **no preset is active** by default.
- Install is blocked while `ffxiv_dx11.exe` is running.
- Admin rights are requested only when the game folder needs them (e.g. Square Enix launcher installs under Program Files).
- No preset previews/screenshots in the app.

## Main screen (lean — nothing else)

- **Status line** with one contextual button: healthy → no button; broken files → **Repair**; update available → **Update** (with changelog).
- **Performance profile** selector (3 options).
- **Master on/off switch** ("Vanilla mode").
- **⋯ menu**: Roll back, Beta channel, XIVLauncher auto-repair, Copy diagnostics, Report a bug, Credits, Uninstall.
- No separate DLSS 5 toggle (OptiScaler's overlay has one), no "Launch game" button, no preset display.

## Deployment engine

- Install steps are **declarative data in the manifest** (`copy`, `rename`, `ini_set`, `delete`); the app is a generic executor. A new upstream round ships as a manifest edit, not an app release.
- Every step is **journaled**; every overwritten or removed file is **backed up** into Lucent's data folder. Uninstall and rollback replay the journal.
- Existing user setups: detect and explain, back up, then replace. User presets and shaders are carried over, never deleted.
- **Managed ini keys**: updates only touch the keys the recipe sets (`ini_set`); the user's other changes survive.
- Shipped presets are compared by hash; a user-edited one is saved as `<name> (my edits).ini` before ours is written.
- User-owned and paid shaders (e.g. iMMERSE Pro: RTGI, RELIGHT, REGRADE) are never shipped and never touched.
- Uninstalling Lucent restores the game folder to vanilla (checkbox on by default). Nothing left behind.

## Updates

- **App updates**: published to GitHub Releases. **Notify only** — nothing downloads until the user clicks Update. Users can skip a version or stay on one.
- **Content updates**: Stable and Beta channels in the manifest. Notify only, pinnable, one-click rollback to either of the last two cached content versions.
- Manifest carries `minAppVersion`; content that needs a newer app is only offered after the app is updated.
- Manifest can mark a content version as broken on a given game version → warning for pinned users, never forced.
- **Game patch detection**: on app open, compare `game\ffxivgame.ver` and verify installed files by hash.
- **XIVLauncher integration (optional)**: register Lucent as a XIVLauncher generic add-on. Check on game launch (notify if broken), repair on game close via the `RunOnClose` option, when the DLLs are no longer locked. The add-on list lives in `launcherConfigV3.json`. XIVLauncher is not required for anything else.

## Repo and hosting

- **Single repo** for everything. We act as the mirror for every file, including Discord-only ones (no "go download this from Discord" friction).
- **In git (`main`)**: app source, `manifest.json`, inis, presets, shaders, GitHub Pages site.
- **Releases in the same repo**:
  - `app-vX.Y.Z` → `Lucent.exe`, marked as latest, so `releases/latest/download/Lucent.exe` is the stable download link.
  - `content-YYYY.MM.DD` → binaries, published with `make_latest=false`. **One asset per file, named by its SHA-256**: small delta updates, per-tier downloads, files shared across tiers and rounds stored once.
- Git cannot hold the binaries anyway: GitHub rejects files over 100 MB (`nvngx_dlssnr.dll` is 158 MB).
- **Publish script**: turns a tested folder into hash-named assets plus manifest entries; links the GPL source tag for each OptiScaler file; refuses to publish on shader path collisions with different content, or presets referencing shaders that are not shipped.

## Trust and signing

- Code signing via **SignPath Foundation** (free for open source, builds from GitHub Actions). The upstream OptiScaler fork already uses SignPath. Fallback: Azure Trusted Signing (paid; individual eligibility depends on country).
- The exe contains no mod DLLs; it downloads them.
- **Never** add Defender exclusions. Submit each release to Microsoft for false-positive analysis.
- A GitHub Pages site in the repo is the download page and explains the SmartScreen warning before users hit it.
- **Diagnostics**: "Copy diagnostics" (versions, tier, file hashes, Windows/driver version, last 300 lines of `OptiScaler.log`) and "Report a bug" opening a pre-filled GitHub issue. Questions go to GitHub Discussions.
- **Credits** screen in the app and on the site: SirenBrink, y4my4my4m, Dagherbou (OptiScaler forks), ShortFuse / RenoDX (compatibility runtime), Marty McFly (iMMERSE), qUINT, SweetFX, the Alive author, ipsusu (ipsuShade). Upstream license files are deployed with their files. Courtesy heads-up to upstream authors before launch.
- Context: this community remembers GShade's 2023 malware incident; open source and zero telemetry are selling points.

## Visual direction

- **Direction B**: premium modern tool (Raycast / Linear / Arc spirit) — dark glass, fluid motion, strong typography, aether-blue accent, crystal motif. All art original.
- The exact look is chosen by building 2–3 throwaway prototypes of the first-run screen.

## Deferred

- Shader merge recipe (the user will provide it).
- Which ini keys each Performance profile sets (and per-tier variants, e.g. Radeon). Starting point: Fidelity `Passes=2`; Balanced `Passes=1`; Performance `Passes=1` + `SpatialCompression` + `ResidualFG`.
- Azure Trusted Signing eligibility (country) — only if SignPath declines.

---

## Reference: facts gathered on 2026-10-12

### Current working setup (dev machine)

Game: `C:\Games\Steam\steamapps\common\FINAL FANTASY XIV Online\game`, launched via XIVLauncher.

- OptiScaler `v10.0.0-dev (2679fb17-community-spatial-sm86-20260926)` loaded as `winmm.dll`.
- ReShade is loaded **through OptiScaler** (`LoadReshade = true` → `ReShade64.dll`), not as `dxgi.dll`.
- `OptiScaler.ini`: `Dx11Upscaler = dlss_12` (the only DX11 option that can also run DLSS Neural Rendering); `[DlssNr] Enabled = true`, `RunBeforeSR = true`, `ResidualFG = true`, `Passes = 2`, `SkinProtection = true`, `SpatialCompression = true`.
- `LogToFile = true`, `LogLevel = 1` produced a 125 MB `OptiScaler.log` → **ship with logging off**.
- ReShade add-on: ReshadeEffectShaderToggler (`.addon32/.addon64/.ini`, shipped inside the Alive zip). Shaders: iMMERSE (free), qUINT, SweetFX, Alive and FFXIV-specific shaders. `ReShade.ini` uses relative paths `.\reshade-shaders\Shaders\**` and `.\reshade-shaders\Textures\**`.

### DLSS 5 deployment recipe (as done by hand today)

Source: `G:\My Drive\Gaming\FFXIV\DLSS 5`

1. Copy `1. ROUND_5_w_DLSS\*` into `game\` (= SirenBrink release asset `ROUND_5_w_DLSS.7z`).
2. Overwrite with `2. Replace those files\` (`nvngx_dlssnr.dll` = ShortFuse compatibility runtime for RTX 20/30/40; newer `winmm.dll`).
3. Edit `OptiScaler.ini` (`LoadReshade`, logging, NR settings).
4. Add ReShade: `ReShade64.dll`, `ReShade.ini`, `reshade-shaders\`, `reshade-presets\`, ShaderToggler add-on.

Notes:
- `OptiScaler\nvfp4\` (sm120 cubins, 37 MB `weights.bin`) is the NVFP4 hybrid mode — Blackwell (RTX 50) only.
- `nvngx.dll_dlssnr.dll` is a forwarder, not the model: the model refuses callers whose module path does not contain `nvngx.dll`.

### Upstream sources

- OptiScaler fork: https://github.com/SirenBrink/OptiScaler_DLSSNR_Multipass_MFG_FFXIV (GPL-3.0; fork of `y4my4my4m/OptiScaler_DLSSNR_Multipass_MFG`, itself based on `Dagherbou/OptiScaler_DLSSNR`). Releases are named "ROUND N" (v5.0 = `ROUND_5_w_DLSS.7z`, 264 MB, 2026-09-27). Its own installer is `setup_windows.bat` with a `dxgi.dll` proxy.
- RTX 20/30/40 compatibility runtime: ShortFuse's pinned thread in the RenoDX Discord (not on GitHub; Discord attachment links expire).
- ipsuShade: https://github.com/ipsusu/ipsuShade — latest release v2.0.0 (`ipsuShade_2406.zip`, 2024-06-08). Presets plus a few shaders and textures; requires the ReShade add-on build; depends on **iMMERSE, METEOR and ZN_FX** shaders. METEOR and ZN_FX are not in the current install or either preset zip yet.
- Alive: `Alive NEXT WIP 34 Stable 156 0.34` zip. Its presets reference paid iMMERSE Pro techniques (not shipped).
- Only overlap between the two preset zips: `Glamayre_Fast_Effects.fx` (identical size).

### XIVLauncher generic add-on

`GenericAddon` in [FFXIVQuickLauncher](https://github.com/goatcorp/FFXIVQuickLauncher/blob/master/src/XIVLauncher.Common/Addon/Implementations/GenericAddon.cs) runs an exe/.bat/.ps1 with arguments when the game launches, with options `RunAsAdmin`, `RunOnClose` and `KillAfterClose`.
