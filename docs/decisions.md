# Lucent — Design Decisions

Settled in a design grilling session on 2026-10-12. Each section is a decision; "Deferred" lists what is intentionally still open.

## Product

- **Lucent** is a public, open-source (MIT for our own code) Windows manager for FFXIV that deploys OptiScaler with DLSS 5 Neural Rendering, ReShade (add-on build), shaders and presets.
- It is a **manager, not a one-shot installer**: it stays useful after setup (repair after patches, profile switching, updates, rollback, clean uninstall).
- **Positioning** (settled 2026-10-13): Lucent is presented as a manager for XIV graphics mods. DLSS 5 (OptiScaler) and ReShade are its two features, not its identity, so the site, README and app copy can take on more features without a rebrand.
- **Form:** one portable GUI `.exe`. No `.bat` / `.ps1`.
- **Stack:** Tauri 2 + React + TypeScript. Rust side stays thin: file ops, hashing, archive extraction, registry, GPU detection. Chosen because the project is vibe-coded and TS/React gives the highest aesthetic ceiling; Electron rejected (portable build unpacks on every launch), WinUI/WPF rejected (single-file pain, lower ceiling).
- On first run it offers to install itself to `%LOCALAPPDATA%\Lucent` with a Start Menu shortcut and a per-user Settings → Apps entry (no admin). The offer is an **"Add Lucent to the Start menu"** checkbox on the Profile step, on by default.
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
   - Stable stays the default. When beta content is available for the graphics card, Scan offers an explicit Beta channel switch before the first deployment and refreshes the file list when it changes. A tier with no content on the selected channel says so and cannot continue.
   - Game detection order: XIVLauncher `%APPDATA%\XIVLauncher\launcherConfigV3.json` (`GamePath`), Steam libraries (app 39210), Square Enix launcher uninstall registry entry, default paths, manual picker validated by `game\ffxiv_dx11.exe`.
   - Existing mods detected: GPosingway, leftover GShade files, regular ReShade (`dxgi.dll` etc.), other OptiScaler installs, swapped DLSS DLLs.
   - Scan is **the only place that lists what the deployment does to files already there** (settled 2026-10-13): every file it backs up, then replaces or removes, where the readable copy goes, and the presets it keeps. One "Existing setup" row with a folder tree behind "Show files"; nothing repeats it on Review.
2. **Profile**: every first-run choice, so Review only reviews (settled 2026-10-13). The performance profile (Ultra / Fidelity / Balanced / Performance, preselected for the graphics card), then "Include ReShade" (on by default; not offered when the tier requires it) and "Add Lucent to the Start menu" (on by default; not offered once Lucent is in the Start menu). A tier without profiles shows the step as **Options**; it's skipped when nothing is left to choose.
3. **Review**: read only. Files backed up / added, download size, and a summary of the choices.
4. **Install**, then a done screen that teaches the in-game keys, read from the configs it just deployed (settled 2026-10-13: hardcoded Insert/Home had drifted from the content's Shift+F2), and links to the guide on the site.
   - Install shows four stages: Downloading, Backing up (the readable backup, only when there is one), Applying, Checking. Progress reaches the UI at most ten times a second and the bar, figures and crystal ease between reports.

- All presets are always installed; **no preset is active** by default.
- Install is blocked while `ffxiv_dx11.exe` is running.
- Admin rights are requested only when the game folder needs them (e.g. Square Enix launcher installs under Program Files).
- No preset previews/screenshots in the app.

## Main screen

- **Layout** (settled 2026-10-13; the ⋯ menu hid features too important to tuck away): the rail keeps the crystal and navigates between six sections, **Home**, **Keys**, **Versions**, **Logs**, **Settings** and **Help**, with a dot on a section that needs the player (caution on Home for drift or a missing folder, accent on Versions for an update). The graphics card and the setup Lucent applies for it sit in a small card at the rail's foot; that is where the tier badge appears.
  - **Home**: the status card, **Launch XIV**, the performance profile, Frame generation, HDR (on an HDR monitor), Preset (with ReShade) and Enabled.
  - **Keys**: every in-game key, read from the game folder's configs each time the section opens.
  - **Versions**: content, game version and channel, then roll back or apply a version.
  - **Logs**: a terminal that tails Lucent's activity log and the logs the deployed tools write in the game folder.
  - **Settings**: how Launch starts XIV, Beta channel, XIVLauncher auto-repair, the game folder (with Scan), and Uninstall set apart as a danger zone.
  - **Help**: the guide, Report a bug, Copy diagnostics, then Credits.
- **Launch XIV** (settled 2026-10-13, replacing "no Launch game button"): starts XIV the way the player does, without closing Lucent. XIVLauncher when it's installed and its readable config points to this game folder; Steam for a Steam copy; otherwise the Square Enix launcher in `boot`. The label below Launch follows the selected launcher. When several apply, an arrow beside Launch opens the choice; Settings also offers it, and the choice is remembered. While XIV runs the button reads "In game".
- **Status card** with one contextual action: healthy or Disabled → a quiet **Scan** (a full hash check now, settled 2026-10-13, so a problem shows without reopening Lucent; also under Settings → Game folder); drift → **Repair**; update available → **Update**. The changelog shows **inline in the status card** with **Skip** and **Update** buttons (no modal).
- **Performance profile** as a segmented control with one line describing the choice (settled 2026-10-13, replacing three radio rows; see Frame generation, frame cap, HDR and profiles). **Custom** lights no segment, and the line says "Custom · based on X" and what changed; it goes once a profile is picked.
- **Master switch labelled "Enabled"**. Turning it off leaves the deployment **Disabled**: files present but inactive. The state persists through repair, update and profile changes, and a health check on a disabled deployment expects the disabled state. Not called "Vanilla mode", because "vanilla" means a game folder with no deployment (and is also an Alive preset name).
- No separate DLSS 5 toggle (OptiScaler's overlay has one). The ReShade preset picker is on Home (settled 2026-10-14, replacing "no preset display"; see Settings changes while XIV runs).
- **Logs** (settled 2026-10-13): Lucent keeps an **activity log**, `%LOCALAPPDATA%\Lucent\lucent.log`: a line for what Scan found, each command and its outcome, every error and notice the window shows, and every file it writes, renames or removes in the game folder. It is a file, not memory, so the window, a relaunch with administrator access and XIVLauncher's headless runs all add to one account, and a first install can be read afterwards. Past 512 KB it is cut back to its last 2,000 lines when Lucent opens. It never leaves the machine (no telemetry) and is not part of Copy diagnostics.
  - The section shows it as a terminal: Geist Mono on the darkest surface, a timestamp per second rather than per line, file lines dimmed, a finished command in the accent, warnings and errors in the caution colours (no new colour), and a caret at the end. It follows new lines until the player scrolls up, then offers **Latest**. **Copy** puts the shown lines on the clipboard.
  - The logs the deployed tools write (`OptiScaler.log`, `ReShade.log`: the content version's generated files that end in `.log`) sit beside it as tabs, read from the game folder every second while the section is open.

## Frame generation, frame cap, HDR and profiles

Settled in a design grilling session on 2026-10-13.

- **Frame generation** is its own group on Home, below the performance profile: a segmented control of **Off · 2× · 3× · 4× · 5× · 6× · Dynamic**, filtered to what the player's card can run. It is separate from the profile: switching profile doesn't change it, and it never makes a profile Custom. Like profiles, it can be changed while XIV runs (see Settings changes while XIV runs), and the first-run Profile step doesn't offer it.
  - The options are manifest data per tier, filtered by GPU model, since RTX 30 and RTX 40 share a tier but not an unlock. RTX 40: 2× native, 3×–6× through the fork's built-in `AdaMfgUnlock`, Dynamic only once it is verified on the RTX 4090. RTX 50: all of them, natively. RTX 20, RTX 30 and Radeon: 2× through FSR frame generation, then 3×, 4× and Dynamic through XeFG with the fork's unlock (XIV's practical XeFG ceiling is 4×). NVIDIA's frame generation doesn't run below RTX 40 in this fork, so RTX 30 had none before this.
  - Multipliers that need an unlock carry a yellow **Experimental** tag. No confirmation dialog.
  - One line under the control says what the choice means at the frame cap: "XIV renders up to 56 fps, shown at 224 on your 240 Hz screen", or "Aims for 224 fps on your 240 Hz screen" for Dynamic. Every supported multiplier stays offered, even one that renders XIV slowly; the line makes the trade-off visible.
  - Default, for a first deployment and for existing deployments on update: 2× on screens of 120 Hz and up, Off below.
  - A multiplier changed in OptiScaler's overlay is a user change: the control shows what is on disk, and a combination it can't show reads **Custom**.
  - Rejected: building frame generation into the profiles; sdli1995's `dlssg_sm86` runtime for RTX 20/30 (an external component nobody here can test, with Dynamic in only one variant).
- **Frame cap**: `[Framerate] FramerateLimit`, `[DLSSG] FramerateTargetDMFG` and `[XeFG] DynamicTargetFPS` are all `floor(R − R²/3600)` for refresh rate R: 138 at 144 Hz, 224 at 240 Hz. That is the cap Reflex applies itself with G-Sync or FreeSync and V-Sync. OptiScaler's limiter is Reflex-based (Anti-Lag 2 on Radeon), and frame generation's pacing needs the headroom; the older "3 fps below refresh" rule (237 at 240 Hz) is for limiters without Reflex. Lucent can't see the driver's V-Sync or VRR settings, so it uses one rule. The cap applies with frame generation Off too, and the Dynamic target equals it, so Dynamic aims at a number it can reach.
  - R is the refresh rate of the monitor XIV runs on (from `FFXIV.cfg`'s `MainAdapter` or window position, or its `Refreshrate` in exclusive fullscreen), falling back to the primary monitor.
  - It is a **screen-derived setting**: Lucent rewrites it at every write to `OptiScaler.ini`, when Lucent opens, on Launch XIV and at XIVLauncher's check when the game starts, only when the value changed, with a line in the activity log. A change made in the overlay is overwritten. It replaces the hardcoded 138 and 144 that only fit a 144 Hz screen.
- **HDR** is a group on Home below Frame generation, shown only when XIV's monitor supports HDR: **Off · HDR · Scene HDR**, Scene HDR tagged Experimental. The default, HDR, is the fork's original SDR expansion (`[HDR] FfxivHDR = true`, `Mode = 0`); Scene HDR is its RenoDX scene method (`Mode = 1`). With Windows HDR off, the line says how to turn it on (Win+Alt+B); OptiScaler falls back to SDR by itself.
  - Peak brightness (`PeakNits`) is screen-derived, from the monitor's reported peak luminance, and the line points to the Windows HDR Calibration app for a monitor that reports it wrongly. Paper white, contrast, saturation, vibrance and highlight expansion stay as the content tunes them; players adjust them live in OptiScaler's overlay, and Lucent keeps those as user changes. Lucent has no brightness slider: a change there could only be seen at the next launch.
  - OptiScaler's HDR needs NVIDIA frame generation, XeFG or none. While HDR is on, 2× on RTX 20, RTX 30 and Radeon uses XeFG instead of FSR frame generation, without the player seeing a difference.
  - While HDR is on, Lucent turns Windows Auto HDR off for `ffxiv_dx11.exe` only (the per-app graphics setting) and restores it when HDR goes Off or on uninstall. RTX HDR can't be changed reliably; on NVIDIA cards the line mentions it.
  - Scene HDR's inputs for Neural Rendering, DLSS and ReShade stay off in the content, and the HDR screenshot key stays unbound.
- **Performance profiles** become four, each step giving up one thing:

  | Profile | Neural Rendering | Upscaling, 1080p and below | 1440p | 4K and up |
  |---|---|---|---|---|
  | **Ultra** | 2 passes | Quality | Quality | Quality |
  | **Fidelity** | 1 pass | Quality | Quality | Quality |
  | **Balanced** | 1 pass | Quality | Balanced | Balanced |
  | **Performance** | 1 pass, spatial compression, residual frame generation | Balanced | Balanced | Performance |

  - Upscaling quality is `[QualityOverrides] ForcePerfQuality`, which the fork applies live through XIV's native resolution path. XIV's own 3D resolution slider stops having an effect, and the guide says so. No DLAA: Neural Rendering stalls at DLAA with split mode. The values are content data, tuned during the Beta test; the resolution column is picked from XIV's screen, like the frame cap.
  - The default profile comes from the graphics card: the content lists the cards each profile is recommended for, and an unlisted card gets Balanced. The first-run Profile step preselects it and tags it "Recommended for your RTX 4070". Existing deployments keep their profile, except that players on the old two-pass Fidelity move to Ultra, so nobody loses a pass without choosing to.
  - The content carries the four profiles in optional `performanceProfilesV2`. Lucent 0.1.x ignores the field; the legacy `performanceProfiles` field remains readable, and the schema version does not change.
- **Home layout**: the profile, Frame generation and HDR read as one family of segmented controls, each with one line describing the current choice. Custom lights no segment, and its line says "Custom · based on Balanced: Passes set to 2". The first-run Profile step keeps descriptive rows. That is the starting point; the final layout is whichever reads cleanest at real size in 1000×680.
- **Keys**: OptiScaler's keys are single virtual keys, without modifiers. Neural Rendering moves to **Delete**: it sits in the same place on every keyboard, laptops and 75% boards included, XIV doesn't use it, and it pairs with Insert for OptiScaler's menu. `\` was a different key on each layout (`*` on AZERTY, `^` on QWERTZ). The FPS overlay keys (`FpsShortcutKey`, `FpsCycleShortcutKey`, Page Up and Page Down by default) are unbound because they are XIV's zoom; End stays the frame generation toggle. Keys and the Done screen name keys as Windows does for the player's keyboard layout ("Suppr" on a French keyboard).
- **Check for updates**: the card's subtitle is the status line: "Checking…", "Up to date · checked 5 min ago" (the quiet check on open counts), an available update, or a yellow error. The callout at the top of Settings no longer carries the result; nobody saw it there.
- **Testing**: a Beta content version with a checklist for the RTX 4090: each multiplier, Dynamic, both HDR methods and the four profiles. Whatever fails there doesn't ship for RTX 40. RTX 20, RTX 50 and Radeon get these options with their first content.

## Settings changes while XIV runs

Settled in a design grilling session on 2026-10-14.

- **What the tools read, and when** (checked against upstream source, 2026-10-14): OptiScaler reads `OptiScaler.ini` once at startup, with no watcher or reload, and its overlay's *Save Settings* rewrites the whole file from memory. ReShade reads `ReShade.ini` once at startup and re-reads a preset only when it loads one (the reload key, a preset switch). It refuses to save over a file that is newer on disk. Loaded DLLs can be renamed but not replaced. So a file Lucent writes in-game can't change the running game; the overlays stay the way to change things instantly.
- **Profile, Frame generation, HDR and Preset stay changeable while XIV runs**, for every player. The write lands on disk at once; the control shows the new choice, and its line ends "· applies next time you start XIV" until the game closes. No toast, badge or rail dot. Lucent knows a change is waiting because it was written during the session.
- **Preset**: a group on Home below HDR, shown only when ReShade is deployed. A dropdown of every preset in `reshade-presets\`, grouped by source (Alive, ipsuShade, Yours), plus **None**. It writes the selected preset in `ReShade.ini`, which updates already keep as a user change. No previews; no preset is active by default.
- **Enabled stays locked while XIV runs**: it renames the entry DLLs, which the game keeps loaded.
- **The write guard opens narrowly**: in-game, only key writes to the deployment's own config files (`OptiScaler.ini`, `ReShade.ini`), journaled and backed up as any change. Every DLL copy or rename, Install, Repair, Update, Uninstall, Enabled and recovery stay blocked. HDR's per-app Auto HDR setting is written in-game too, since Windows applies it at launch.
- **Screen-derived settings** are rewritten in-game when Lucent opens, with the same line ending.
- **Overlay saves win if they come later**: Home shows what is on disk, so a pick that OptiScaler's *Save Settings* overwrites shows the overlay's value again. Lucent never re-applies it.
- **Recovery** after a crash mid-write waits for XIV to close; until then Home shows recovery required with the controls locked.
- **Later**: after the 6.0 release of [arnaudcouturier/OptiScaler_DLSSNR_Multipass_MFG_FFXIV](https://github.com/arnaudcouturier/OptiScaler_DLSSNR_Multipass_MFG_FFXIV), the fork is maintained here and can re-read `OptiScaler.ini` live, which would make profile and upscaling quality changes instant (frame generation and HDR need a restart in OptiScaler itself). A Lucent ReShade add-on driven over a named pipe could switch presets instantly, if that turns out to matter.
- Rejected: queueing changes until the game closes (hidden state that an overlay save makes stale); an Enabled that turns features off in the configs to look instant; a capture tool that copies overlay tuning back into the content repo.

## Deployment engine

- Install steps are **declarative data in the manifest** (`copy`, `rename`, `ini_set`, `delete`); the app is a generic executor. A new upstream round ships as a manifest edit, not an app release.
- Every step is **journaled**; every overwritten or removed file is **backed up** into Lucent's data folder. Uninstall and rollback replay the journal.
- **Batched file work** (settled 2026-10-13, after installs and uninstalls took tens of seconds): consecutive copies and deletions of different paths are journaled together in one durable write, then applied at once through batch primitives the Rust side runs in parallel (`copyMany`, `hashMany`, `statMany`…). The game check runs once per batch of up to 96 files instead of before every write. Undo works the same way, newest first, in batches whose paths don't repeat. Recovery is unchanged, because a journaled step that never ran still matches its `before` hash. A 1,000-file install makes about 200 round trips instead of 15,000; `src/core/performance.test.ts` holds that line.
- Existing user setups: detect and explain, back up, then replace. User presets and shaders are carried over, never deleted.
- **Any other file at a path the content writes** (an `nvngx_dlss.dll` no signature claims, a hand-made setup's license files) is backed up and replaced the same way on a first deployment, since Scan lists it. Nothing blocks Install (settled 2026-10-13: a "move these files aside, then scan again" dead end was rejected). An update still refuses to replace such a file, since no Scan has listed it.
- **Readable backup**: a first deployment also copies every original it backs up to `%LOCALAPPDATA%\Lucent\Backups\<game folder name>\game\`, under its own path, so the player can find it. The journal restores only from its own hash-named backups, so the player can't break an uninstall by touching the copy; the copy goes once uninstall has put the files back. It costs disk space (about 700 MB for the dev machine's setup), accepted for the reassurance.
- **Config files from an existing setup** (e.g. a previous `ReShade.ini`): back up, then write Lucent's whole file. No merging: Lucent doesn't know their history. Lucent is opinionated and built for people who don't want to tinker.
- **Lucent's own config files on update**: key-by-key three-way merge between what Lucent last wrote, what's on disk, and what the new content version ships:
  - Key unchanged on disk, changed in the new version → new value.
  - User change, key unchanged in the new version → user's value kept (e.g. the selected ReShade preset, keybinds).
  - User change, key also changed in the new version → Lucent's value wins (it's the tested combination).
  - Key listed as a **reset key** by the content version → Lucent's value wins (escape hatch for breaking values).
  - The pre-update file is always backed up. The merged file follows the new version's layout and comments; keys the new version dropped are removed (they remain in the backup).
- A whole-file replace on every update was rejected: ReShade stores the selected preset and keybinds in `ReShade.ini`, so every update would reset them.
- **Performance profiles** follow the same rule. A user change to a profile setting shows the profile as **Custom (based on X)** until the user picks a profile or a content version changes that setting.
- Shipped presets are compared by hash; a user-edited one is kept when Lucent's version is unchanged, or saved as `<name> (my edits).ini` before Lucent's changed version is written.
- User-owned and paid shaders (e.g. iMMERSE Pro: RTGI, RELIGHT, REGRADE) are never shipped and never touched.
- **Only the shaders the presets use are shipped** (settled 2026-10-13): the effects the shipped presets turn on, with their includes and textures, and the licences of the folders they come from. Another add-on naming an effect (the Shader Toggler) doesn't ship it. Players who want other effects add them themselves; Lucent leaves their shaders alone.
- Uninstalling Lucent restores the game folder to vanilla (checkbox on by default). Nothing left behind.

## Updates

- **App updates**: published to GitHub Releases. **Notify only** — nothing downloads until the user clicks Update. Users can skip a version or stay on one.
- **Content updates**: notify only, pinnable, one-click rollback to either of the last two cached content versions.
- **Checking** (settled 2026-10-13): Lucent checks on open, after an update, a skip or a channel change, and when the player clicks **Settings → Check now**. No background service. A manual check reports when it can't reach GitHub; the check on open stays quiet. The result shows in the Check for updates card's status line.
- **One channel switch covers both**: Stable or Beta. Beta users get beta app versions *and* beta content versions, so beta content that needs new app features can be tested before that app version ships to stable. **Leaving Beta changes nothing deployed**: the beta content stays, and Lucent then announces only a Stable version newer than the current one (never a downgrade); a running beta app is likewise offered only a newer stable release.
- **Rollback pins** the version rolled back to and **skips** the version left behind, so Lucent stops announcing it. The next newer version is announced normally. Skipped versions can still be applied manually from the Versions section.
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

## Trust

- The exe contains no mod DLLs; it downloads them.
- **Never** add Defender exclusions. Submit each release to Microsoft for false-positive analysis.
- A GitHub Pages site in the repo is the download page and explains the SmartScreen warning before users hit it.
- **Diagnostics**: "Copy diagnostics" (versions, tier, file hashes, Windows/driver version, last 300 lines of `OptiScaler.log`) and "Report a bug" opening a pre-filled GitHub issue. Questions go in GitHub issues too (Discussions is not enabled).
- **Credits** screen in the app and on the site: SirenBrink, y4my4my4m, Dagherbou (OptiScaler forks), AMD (FidelityFX), Intel (XeSS), ShortFuse / RenoDX (compatibility runtime), Marty McFly (iMMERSE), qUINT, SweetFX, the Alive author, ipsusu (ipsuShade). Upstream license files are deployed with their files. Courtesy heads-up to upstream authors before launch.
- Context: this community remembers GShade's 2023 malware incident; open source and zero telemetry are selling points.

## Visual direction

Settled by the look prototype on 2026-10-12: variant **D · Ember**, kept as the tag `lucent-look-prototype`. Its README holds the full design language, and the tag stays as the reference. Ember combines Rail's layout ("more polished and practical, less noisy") with Prism's idea that the crystal's light is the state. It **replaces** the earlier "dark glass, aether-blue accent" direction. The references are Crunchyroll's colours and beautifului.dev's restraint. All art is original.

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
- **Buttons** (refined 2026-10-13): consistent 34px controls (38px for Launch), 8px corners, quiet inset edges and a restrained orange gradient for primary actions. No orange drop glow or bright rim. Secondary controls use a faint neutral fill; ghost actions stay quiet and Uninstall keeps its red treatment. Hover and press feedback apply only to available actions, with a clear keyboard focus ring. The launch arrow shares its primary button's surface and opens a native popover with radio choices.
- **Motion** has two speeds:
  - The UI is quick and quiet: 180ms `cubic-bezier(.16,1,.3,1)`, screens fade in with a 6px slide, and selection uses springs.
  - The crystal is the only thing in continuous motion. It speeds up during repair or update, stalls on drift and freezes when Disabled.
  - Motion honours `prefers-reduced-motion`. The crystal pauses when the window is hidden or unfocused, since the game may be running.
- **Crystal**: the brand mark and the status light, and it lives only in the rail.
  - It's an original 3D spire with a clustered base and two shards on an unseen precessing orbit. The two gold rings were removed on 2026-10-13 (they read as bloated).
  - It evokes an aetheryte but **deliberately omits the cup-and-prong base and the zigzag ring ornament**. Keep it that way.
  - States: glass (scan, with a scan line; profile; review), filling (install, easing between progress reports), lit (done, healthy), a swelling glow (update available), fast spin (repair, update or Scan running), dark facets, a slowed spin and a falling shard (drift), a frozen steel crystal (Disabled).
- **Window**:
  - A frameless window (`decorations: false`), **1000×680 by default**, resizable down to **880×600** (the rail's six sections need that height) and maximizable (settled 2026-10-13), with custom minimize, maximize and close buttons. Content starts 24px below the title strip; Launch aligns with the Home content column.
  - It reflows rather than zooms: text stays the same size, the rail stays 248px, and the pane's column grows to 720px wide and 880px tall, centred, so lists such as Scan's files get more room. Settings → Apps' uninstall window stays a fixed 460×340.
  - Drag regions cover the rail and the title strip; a double-click on either maximizes or restores.
  - It keeps the native Windows 11 shadow and rounded corners. Still to be verified: `shadow: true`, and how it looks on Windows 10.

## Deferred

Nothing is deferred. The shader set is settled under Deployment engine, and each tier's performance profile settings come from its tested content in the manifest (RTX 30/40 publishes all of them).

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

Source: the maintainer's tested folder

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
