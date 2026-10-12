# PROTOTYPE: Lucent look (throwaway)

**Question:** what does Lucent look like? Round 1 built three clearly different takes on direction B (premium modern tool, dark glass, aether-blue accent, crystal motif), switchable side by side. Fake data only, no real logic. This code is not meant to ship; only the chosen design language moves on.

**Round 2 (default, `?variant=D`): Ember.** The user's merge: Rail's layout (B) with Prism's idea that the crystal's light is the state (A), using a rebuilt 3D crystal (36 translucent facets, inner core, orbiting shards). Definitive dark theme: Crunchyroll-style charcoals with `#F47521` as the only accent. No Mica: the crystal's glow in the rail is the only painted backdrop. Restraint calibrated on beautifului.dev (1px light rings instead of borders, 13px type, 180ms ease-out). The bar's *Crystal* toggle swaps the crystal between Ember (orange) and Aether (blue).

## Run

```sh
cd prototypes/lucent-look
npm install
npm run dev        # opens http://localhost:5199
```

Use the bottom bar (or `←` / `→`) to switch variants. The bar also jumps to any screen, sets the main-screen state, picks the GPU (tier and tier status), adds GShade leftovers to the scan and changes the desktop wallpaper behind the window. Every setting is in the URL, for example `?variant=C&screen=main&state=drift&gpu=rx7900`.

The window is a fixed **880×580** frameless window with custom caption buttons, as a Tauri 2 window would have (`decorations: false`, a drag region). The mock is interactive: the first-run flow runs from Scan to Done, and Repair, Update, Skip, Enabled, the profile selector and the ⋯ menu all respond.

## Variants

| | A · Prism | B · Rail | C · Facet |
|---|---|---|---|
| Layout | Centred column. The crystal is the hero; controls sit in a glass bar at the bottom | Left rail (setup steps, then the deployment's facts) and a pane of rows | Asymmetric split: huge status word on the left, control column on the right |
| Crystal motif | The identity: an original crystal whose light *is* the state (fills during install, cracks amber on drift, clear glass when Disabled) | Logo mark only | Geometry: chamfered cut-corner surfaces, prismatic edges, a faint gem lattice |
| Window backdrop | Windows 11 Mica (simulated; solid fallback on Windows 10) | Opaque, identical on Windows 10 and 11 | Painted by the app (drifting aether light), identical on Windows 10 and 11 |
| Type | Instrument Serif + Instrument Sans | Geist + Geist Mono | Unbounded + Manrope + Martian Mono |
| Icons | Phosphor (light/bold) | Lucide | Phosphor + geometric glyphs |
| Motion | Slow and luminous (450–900 ms, blur dissolves, breathing glow, light sweeps) | Crisp, functional (150 ms, springs on selection) | Kinetic (staggered letters, wipes, drifting light) |
| Update changelog | Modal sheet | Inline in the status card | Side drawer |
| Custom profile | Label above the selector, dashed outline on the base profile | A temporary fourth row | Label above the selector, dashed outline on the base profile |

All fonts are SIL OFL 1.1 and bundled through Fontsource (no CDN). Icons are MIT (Phosphor) and ISC (Lucide).

## Verdict (2026-10-12)

**Winner: D · Ember.** Round 1: the user preferred **Rail's layout** ("more polished and practical, less noisy") and liked **Prism's crystal** (the crystal's light is the state) but found it cheap and too minimal. They rejected **Mica** in favour of a definite theme with **`#F47521` orange** on dark, with Crunchyroll's colours as the reference, and set the cleanliness bar at beautifului.dev. Round 2 merged these. The crystal was then reshaped toward an aetheryte-like spire with **spinning rings**, which the user asked for by name. The user's words: "satisfied with Ember's preset for now".

## Design language (for the spec)

**Theme.** Dark only (no OS light/dark switching). An opaque window: no Mica or acrylic. The only painted backdrop is the crystal's glow in the rail.

**Colour tokens.**

| Token | Value | Use |
|---|---|---|
| `canvas` | `#141519` | right pane background |
| `rail` | `#0d0e11` | left rail background (the crystal glows here) |
| `surface` | `#1a1b20` | cards |
| `field` / `hover` / `hover-2` | `#212329` / `#1e1f25` / `#272930` | buttons, inputs, hover states |
| `line` / `line-strong` | `#24262c` / `#31343c` | dividers inside cards, unchecked controls |
| `ink` / `ink-2` / `ink-3` | `#f4f4f5` / `#a0a0a6` / `#6e7078` | text: primary, secondary, labels and meta |
| `accent` | `#F47521` (hover `#ff8638`, press `#dd6512`, tint `rgba(244,117,33,.13)`) | the only accent |
| `on-accent` | `#0b0b0c` | text on orange (white on orange fails contrast) |
| `caution` | `#FAB818` (tint `rgba(250,184,24,.1)`) | drift, Experimental badge |
| `danger` | `#ff6a5f` | Uninstall |

Edges are rings, not borders: card `0 0 0 1px rgba(255,255,255,.065), 0 1px 2px rgba(0,0,0,.3), 0 2px 6px rgba(0,0,0,.2)`, button `0 0 0 1px rgba(255,255,255,.09), 0 1px 2px rgba(0,0,0,.35)`, overlay `0 0 0 1px rgba(255,255,255,.1), 0 12px 32px rgba(0,0,0,.5)`.

**Typography.** **Geist** (UI) and **Geist Mono** (paths, versions, numbers, keycaps), both SIL OFL 1.1, bundled through Fontsource (no CDN). Scale: 20/600 screen titles, 14/600 status titles, 13/400–500 body, 12.5 secondary, 11.5–12 labels, 11/500 chips, Mono 22/500 for review figures.

**Spacing and radius.** A 4px grid. Pane padding 32px; card padding 14–16px; list rows 11px vertical. Radius: chip 6, control 8, card 10. Window corners 8, which is what Windows 11 imposes.

**Motion.** Two speeds.
- The **UI** is quick and quiet: 180ms `cubic-bezier(.16,1,.3,1)`; screens fade with a 6px slide; selection indicators use springs (stiffness 600–700, damping 40).
- The **crystal** is the only thing that moves continuously: a slow spin, ring precession and a gentle float, at about 30 fps.
  - It speeds up while repairing or updating, stalls on drift and freezes when Disabled.
  - It honours `prefers-reduced-motion` and should pause when the window is hidden or unfocused (the game may be running).

**Iconography.** Lucide (ISC), 1.75 stroke at 14–16px. Status glyphs sit in 30px tinted tiles.

**Accent and crystal.**
- **Orange** marks the primary action (black text), selection, progress, the focus ring and the healthy state.
- **Yellow** means caution and nothing else.
- **The crystal** is the brand mark and a status light, and it lives only in the rail. It's an original 3D spire with a clustered base and two gold rings carrying riding shards. It evokes an aetheryte without copying Square Enix's design: no cup or prong base, and rings with our own facet studs. Its states:

| State | Crystal |
|---|---|
| Scan | glass with a scan line |
| Profile, Review | glass |
| Install | fills with light as the install progresses |
| Done, healthy | lit |
| Update available | pulse ring |
| Repair or update running | fast spin |
| Drift | dark facets, the small ring stalls, a shard falls |
| Disabled | frozen steel and glass |

**Window chrome.** A fixed **880×580** frameless window (Tauri `decorations: false`) with custom minimize and close buttons (no maximize; close hovers `#c42b1c`). Drag regions cover the rail and the title strip. Keep the native Windows 11 shadow and rounded corners (`shadow: true`, to be verified).

**Layout.**
- **Left rail (248px):** the crystal, then the setup steps during first run, then the deployment facts afterwards (graphics card + tier + status badge, content version, game version), with the app version at the bottom.
- **Right pane:** the status card with its single contextual action, the performance profile as radio rows, the Enabled row, and ⋯ in the title strip.

**Decisions the prototype surfaced.**
- The self-install offer is an **"Add Lucent to the Start menu"** checkbox on Review, on by default.
- The update changelog appears **inline** in the status card, with Skip and Update buttons (no modal).
- **Custom** appears as a temporary fourth profile row, "Custom · based on Balanced", that explains the change. It disappears once a profile is picked.
