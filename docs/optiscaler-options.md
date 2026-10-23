# OptiScaler-FFXIV options in Lucent

What the fork exposes, what Lucent can and cannot do with it, the defaults Lucent ships and which options belong in the first-install choices. Written 2026-10-23 against OptiScaler-FFXIV `ffxiv-2026.10.23-d9b62110` (its `OptiScaler.ini`, `docs/FEATURES.md` and `docs/HUDLESS.md`, and the release notes), content 2026.10.23 and app 0.3.0-beta.9. The decisions that follow from it are in `docs/decisions.md` ("OptiScaler-FFXIV options as setup choices").

## What Lucent can and cannot do

- **Can:** write any `OptiScaler.ini` key once, from a choice on the Graphics step, when it installs, on Reset, and when it repairs a missing ini. Filter a choice by the graphics card's name, by the frame-generation mode picked, and by HDR. Say in plain words what a choice does and tag it Experimental.
- **Cannot change a running game.** The fork's own in-game menu (Insert) is the live tuner. Some keys apply live (the DLSS-G render preset, with a short frame-generation restart), most apply after a game restart (`[HudLess] Mode`, `[DLSSG] UIRecomposition`, the unlocks).
- **Cannot change an existing install's values without a Reset.** An update's `addMissingKeys` adds keys that are absent and never rewrites one the player has; `replace` rewrites the whole file. Choices therefore apply to new installs and Reset. A player who wants another value later uses the in-game menu, or Reset.
- **Cannot read the ini back.** A setting changed in the overlay is the player's business; Lucent keeps its own record of the choices only so Reset can offer them again.
- **Cannot test any of it in game.** Every status below is the fork's own, from the maintainer's RTX 4090 in SDR, and Lucent adds none.
- **Cannot reach an NVIDIA runtime the content does not ship.** The fork's NR model version picker (`[DlssNr] Runtime`) needs one folder per runtime; Lucent ships one runtime per tier.
- **Cannot see the player's NVIDIA profile.** The fork warns that a profile (or the NVIDIA app's "DLSS override") can make NGX load NVIDIA's own copy of `nvngx_dlssg.dll` instead of Lucent's patched one: no multi-frame unlock, and the preset is applied by NVIDIA's copy. The fork's menu shows a warning line; Lucent cannot.

## The two options that become choices

Both are DLSS-G only. They matter only while frame generation runs and its output is NVIDIA's DLSS-G, which is RTX 40 and RTX 50 here. On RTX 30 the output is FSR frame generation (XeFG with HDR) and on RTX 20 there is none; the fork says the preset is not available with an external frame-generation output or the RTX 20/30 companion runtime, and that recomposition only tags those outputs, untested.

### UI mode (`[HudLess] Mode`)

| Option | Key value | What it does | Status |
|---|---|---|---|
| Off | `off` | The UI goes through frame generation like the rest of the frame | Default of the fork |
| Recomposition | `recomposition` | DLSS-G recomposes the UI itself from a hud-less image and a UI image. It still interpolates the UI layer. Applies after a game restart | Tested in SDR at 2× to 4×. The fork's recommendation |
| UI-free | `ui_free` | Frame generation runs on the UI-free image and the UI is pasted back at the real frame rate | Experimental. One session sat in `Fallback(MaskCoverage)` for most presents, so the path did nothing and the UI was interpolated, with a faint micro-stutter. HDR output untested |

The fork saw no visible gain from either mode against Off in the maintainer's testing ("treat the benefit as unproven"), and the micro-stutter went away with Recomposition. `[DLSSG] UIRecomposition` (Auto, On, Off) is a restart-time override in the fork's Advanced fold. The fork documents it as mattering only in Recomposition, and the UI mode already carries the on and off the player means, so Lucent leaves the key on `auto`.

### DLSS-G render preset (`[DLSSG] RenderPreset`)

| Option | Key value | What NVIDIA's runtime does (nvngx_dlssg 310.9.16, verified by the fork in the binary) |
|---|---|---|
| Auto | `0` | Untouched: the driver and the runtime decide |
| Preset A | `1` | UI recomposition off, FG Lite off |
| Preset B | `2` | UI recomposition on, FG Lite off |
| Preset C | `3` | UI recomposition off, FG Lite on |

The fork tested a boot on Auto and on Preset C and live switches without a refusal on the 310.9.16 runtime, and its own table still lists the in-game result as pending. Nobody has measured what A, B and C look like or cost against Auto, so Lucent's descriptions say what the runtime does with each and nothing about picture or speed.

### Rules between them

- **Recomposition with Preset A or C conflicts.** The runtime turns recomposition off with them, so the fork does not request it and the engine reports `PausedByPreset`. Before the fork's rule, booting that pair made DLSS-G recreate itself and only about 59 of about 132 presents a second were distinct pictures. Lucent greys A and C out while UI mode is Recomposition, with the reason, and a player who picks Recomposition after A or C goes back to Auto.
- **Preset C without Recomposition is valid** (the UI is interpolated). So are A and C with UI-free.
- **UI-free is greyed out while HDR is not Off.** The fork's design note says the paste producer cannot start under HDR output as the code stands, and it is untested.
- **Frame generation Off hides both.** The values still get written, so turning frame generation on later in the overlay finds the recommended settings.
- **Only DLSS-G.** Where the choice is not offered Lucent writes `Mode = off` and `RenderPreset = 0`, which for RTX 30 changes what 2026.10.23 wrote (`recomposition`, untested with FSR and XeFG outputs).

## Defaults

| Choice | Default | Why |
|---|---|---|
| UI mode | Recomposition | What content has shipped since 2026.10.19, what the fork recommends and what the maintainer plays |
| DLSS-G render preset | Auto | The fork's default, and the only value that leaves NVIDIA's own pairing alone |
| `[HudLess] Diagnostics` | `false` (was `true`) | A developer gate: it keeps the UI-boundary observation and the ReShade probe running even with Mode off, so Off would not be fully off, and it writes a new folder of files under `OptiScaler\hudless-diag` on every run. Uninstall removes that folder, but nothing in a player's setup needs it |

`Diagnostics` is the one change to what content ships. It applies to new installs and Reset like the rest, and an existing ini keeps `true` until the player changes it.

## Every other fork option

| Option | Key | Decision | Reason |
|---|---|---|---|
| Frame generation multiplier, unlock, Dynamic | `[FrameGen]`, `[DLSSG]` | Already a choice | |
| Automatic multiplier | `[DLSSG] AutoMFG`, `AutoMFGMax` | Deferred | Experimental, tested on one setup, needs the unlock above 2×. A new multiplier id would break the manifest of every older app (an unknown id invalidates it), so it needs its own optional field first |
| Neural Rendering preset, passes, resolution, compression, residual frame generation | `[DlssNr]` | Already choices | |
| NR model version | `[DlssNr] Runtime` | Deferred | One runtime per tier is shipped; `NR.310.8.0.0` cannot create its feature on the RTX 4090 |
| DLSS model letter | `[DLSS] RenderPresetForAll` | Deferred, maintainer's call | Content forces M (`13`); the fork notes L and M cost more fps than K. A real performance choice, not asked for yet |
| HDR | `[HDR]` | Already a choice | |
| Window mode | `[Window] Mode` | Ships `on`, no choice | Only for the borderless "fullscreen" that `[XeFG] ForceBorderless = true` gives, which content already sets; without ReShade a window-mode call goes through as before |
| Game jitter correction and source fix | `[FFXIV] JitterCorrection`, `JitterSource` | Ships as the maintainer plays (correction on, source fix off), no choice | Experimental; tuning belongs in the overlay |
| Character preview treatment | `[FFXIV] Preview*` | Ships on, no choice | Not a decision a player makes at install |
| Automatic mipmap bias, quality change without the 500 ms pause | `[Mipmap]`, `[NgxRelease]` | Fork defaults, no choice | Safety and quality defaults the fork already picked |
| HUD-less tuning | `[HudLess] MaskThreshold`, `CoverageGuard`, … | Left at `auto` | Only matter in UI-free; the fork marks them Advanced |
| Menu look, frame cap, peak brightness | `[Menu]`, `[Framerate]`, `[HDR] PeakNits` | Shipped or derived | |

## Older apps

Beta 0.3.0-beta.8 and 0.3.0-beta.9 read a manifest field by field and ignore a tier field they do not know, so new content can add optional fields without invalidating anything. They would install the base ini, which keeps `Mode = recomposition` and `RenderPreset = auto`, so a player on an older app gets today's behaviour and no choices. The content therefore keeps `minAppVersion` at `0.3.0-beta.8`.

## Where the choices appear

On the Graphics step, under Frame generation, only while frame generation is not Off and the card's output is DLSS-G. Reset setup offers them again with the stored picks, and a tier switch keeps them or falls back to the defaults. There is no control on Home, and no way to change them without Reset: that follows the rule from 2026-10-14 that frame generation, HDR and the profile are first-install choices written once. A lighter "change without a Reset" path would need an in-place ini editor and is not part of this work.
