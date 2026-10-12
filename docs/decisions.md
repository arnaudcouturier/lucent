# Lucent — Design Decisions

Settled in a design grilling session on 2026-10-12. Each section is a decision; "Deferred" lists what is intentionally still open.

## Product

- **Lucent** is a public, open-source (MIT for our own code) Windows manager for FFXIV that deploys OptiScaler with DLSS 5 Neural Rendering, ReShade (add-on build), shaders and presets.
- It is a **manager, not a one-shot installer**: it stays useful after setup (repair after patches, profile switching, updates, rollback, clean uninstall).
- **Form:** one portable GUI `.exe`. No `.bat` / `.ps1`.
- **Stack:** Tauri 2 + React + TypeScript. Rust side stays thin: file ops, hashing, archive extraction, registry, GPU detection. Chosen because the project is vibe-coded and TS/React gives the highest aesthetic ceiling; Electron rejected (portable build unpacks on every launch), WinUI/WPF rejected (single-file pain, lower ceiling).
- On first run it offers to install itself to `%LOCALAPPDATA%\Lucent` with a Start Menu shortcut and a per-user Settings → Apps entry (no admin). The offer is an **"Add Lucent to the Start menu"** checkbox on Review, on by default.
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
3. **Review**: "Include ReShade" checkbox (on by default; always on for Radeon/other tiers), "Add Lucent to the Start menu" checkbox (on by default), plus files backed up / added and download size.
4. **Install**, then a done screen that teaches the hotkeys (Insert = OptiScaler overlay, Home = ReShade).

- All presets are always installed; **no preset is active** by default.
- Install is blocked while `ffxiv_dx11.exe` is running.
- Admin rights are requested only when the game folder needs them (e.g. Square Enix launcher installs under Program Files).
- No preset previews/screenshots in the app.

## Main screen (lean — nothing else)

- **Layout**: a left rail with the crystal and the deployment's facts (graphics card + tier + tier status badge, content version, game version; app version at the bottom), and a right pane with the status card, the performance profile, the Enabled row, and ⋯ in the title strip. The rail facts are the only place the tier badge appears.
- **Status card** with one contextual action: healthy → no button; drift → **Repair**; update available → **Update**. The changelog shows **inline in the status card** with **Skip** and **Update** buttons (no modal).
- **Performance profile** as three radio rows. **Custom** appears as a temporary fourth row, "Custom · based on X", that says what changed; it disappears once a profile is picked.
- **Master switch labelled "Enabled"**. Turning it off leaves the deployment **Disabled**: files present but inactive. The state persists through repair, update and profile changes, and a health check on a disabled deployment expects the disabled state. Not called "Vanilla mode", because "vanilla" means a game folder with no deployment (and is also an Alive preset name).
- **⋯ menu**: Versions (roll back, or apply a skipped version), Beta channel, XIVLauncher auto-repair, Copy diagnostics, Report a bug, Credits, Uninstall.
- No separate DLSS 5 toggle (OptiScaler's overlay has one), no "Launch game" button, no preset display.

## Deployment engine

- Install steps are **declarative data in the manifest** (`copy`, `rename`, `ini_set`, `delete`); the app is a generic executor. A new upstream round ships as a manifest edit, not an app release.
- Every step is **journaled**; every overwritten or removed file is **backed up** into Lucent's data folder. Uninstall and rollback replay the journal.
- Existing user setups: detect and explain, back up, then replace. User presets and shaders are carried over, never deleted.
- **Config files from an existing setup** (e.g. a previous `ReShade.ini`): back up, then write Lucent's whole file. No merging: Lucent doesn't know their history. Lucent is opinionated and built for people who don't want to tinker.
- **Lucent's own config files on update**: key-by-key three-way merge between what Lucent last wrote, what's on disk, and what the new content version ships:
  - Key unchanged on disk, changed in the new version → new value.
  - User change, key unchanged in the new version → user's value kept (e.g. the selected ReShade preset, keybinds).
  - User change, key also changed in the new version → Lucent's value wins (it's the tested combination).
  - Key listed as a **reset key** by the content version → Lucent's value wins (escape hatch for breaking values).
  - The pre-update file is always backed up. The merged file follows the new version's layout and comments; keys the new version dropped are removed (they remain in the backup).
- A whole-file replace on every update was rejected: ReShade stores the selected preset and keybinds in `ReShade.ini`, so every update would reset them.
- **Performance profiles** follow the same rule. A user change to a profile setting shows the profile as **Custom (based on X)** until the user picks a profile or a content version changes that setting.
- Shipped presets are compared by hash; a user-edited one is saved as `<name> (my edits).ini` before ours is written.
- User-owned and paid shaders (e.g. iMMERSE Pro: RTGI, RELIGHT, REGRADE) are never shipped and never touched.
- Uninstalling Lucent restores the game folder to vanilla (checkbox on by default). Nothing left behind.

## Updates

- **App updates**: published to GitHub Releases. **Notify only** — nothing downloads until the user clicks Update. Users can skip a version or stay on one.
- **Content updates**: notify only, pinnable, one-click rollback to either of the last two cached content versions.
- **One channel switch covers both**: Stable or Beta. Beta users get beta app versions *and* beta content versions, so beta content that needs new app features can be tested before that app version ships to stable.
- **Rollback pins** the version rolled back to and **skips** the version left behind, so Lucent stops announcing it. The next newer version is announced normally. Skipped versions can still be applied manually from a version list in the ⋯ menu.
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

Settled by the look prototype on 2026-10-12: variant **D · Ember**, on branch `prototype/lucent-look`. Its README holds the full design language, and the branch stays as the live reference. Ember combines Rail's layout ("more polished and practical, less noisy") with Prism's idea that the crystal's light is the state. It **replaces** the earlier "dark glass, aether-blue accent" direction. The references are Crunchyroll's colours and beautifului.dev's restraint. All art is original.

- **Theme**: dark only, with no OS light/dark switching. The window is opaque (no Mica or acrylic). The crystal's glow in the rail is the only painted backdrop.
- **Colour**:
  - `#F47521` orange is the **only accent**. It marks the primary action (with black `#0b0b0c` text, because white on orange fails contrast), selection, progress, the focus ring and the healthy state.
  - `#FAB818` yellow means **caution** (drift, Experimental) and nothing else.
  - `#ff6a5f` is for Uninstall.
  - Charcoal surfaces: canvas `#141519`, rail `#0d0e11`, card `#1a1b20`, field `#212329`, ink `#f4f4f5` / `#a0a0a6` / `#6e7078`.
  - Edges are 1px light rings (box-shadow), not borders.
- **Type**: Geist for the UI and Geist Mono for paths, versions, numbers and keycaps. Both are SIL OFL 1.1 and bundled (no CDN). Body text is 13px and screen titles 20/600.
- **Spacing**: 4px grid, 32px pane padding. Radius: chip 6, control 8, card 10.
- **Icons**: Lucide (ISC), 1.75 stroke at 14–16px.
- **Motion** has two speeds:
  - The UI is quick and quiet: 180ms `cubic-bezier(.16,1,.3,1)`, screens fade in with a 6px slide, and selection uses springs.
  - The crystal is the only thing in continuous motion. It speeds up during repair or update, stalls on drift and freezes when Disabled.
  - Motion honours `prefers-reduced-motion`. The crystal pauses when the window is hidden or unfocused, since the game may be running.
- **Crystal**: the brand mark and the status light, and it lives only in the rail.
  - It's an original 3D spire with a clustered base and two precessing gold rings carrying shards.
  - It evokes an aetheryte but **deliberately omits the cup-and-prong base and the zigzag ring ornament**. Keep it that way.
  - States: glass (scan, with a scan line; profile; review), filling (install), lit (done, healthy), pulse ring (update available), fast spin (repair or update running), dark facets with a stalled ring and a falling shard (drift), frozen steel (Disabled).
- **Window**:
  - A fixed **880×580** frameless window (`decorations: false`) with custom minimize and close buttons, and no maximize.
  - Drag regions cover the rail and the title strip.
  - It keeps the native Windows 11 shadow and rounded corners. Still to be verified: `shadow: true`, and how it looks on Windows 10.

## Deferred

- Shader merge recipe (the user will provide it).
- Which ini keys each Performance profile sets (and per-tier variants, e.g. Radeon). Starting point: Fidelity `Passes=2`; Balanced `Passes=1`; Performance `Passes=1` + `SpatialCompression` + `ResidualFG`.
- Azure Trusted Signing eligibility (country) — only if SignPath declines.

---

## Reference: facts gathered on 2026-10-12

### Current working setup (dev machine)

Game: `C:\Games\Steam\steamapps\common\FINAL FANTASY XIV Online\game`, launched via XIVLauncher.

- OptiScaler `v10.0.0-dev (2679fb17-community-spatial-sm86-20260926)` loaded as `winmm.dll`.
- ReShade is loaded **through OptiScaler** (`LoadReshade = true` → `ReShade64.dll`), not as `dxgi.dll`. ReShade's own `dxgi.dll` must be renamed to `ReShade64.dll` for this to work. So an existing ReShade install's `dxgi.dll` is part of an existing setup that Lucent backs up and removes.
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
