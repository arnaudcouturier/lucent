<p align="center">
  <img src="docs/assets/lucent-banner.svg" alt="Lucent — DLSS 5 and ReShade for XIV, in one app" width="100%">
</p>

<p align="center">
  <a href="https://github.com/arnaudcouturier/lucent/releases/latest"><img src="https://img.shields.io/github/v/release/arnaudcouturier/lucent?label=latest%20release&color=f47521" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-f47521" alt="MIT licence"></a>
  <a href="https://arnaudcouturier.github.io/lucent/"><img src="https://img.shields.io/badge/website-download-f47521" alt="Download site"></a>
</p>

Lucent is a portable Windows app that installs a tested DLSS 5 Neural Rendering + ReShade setup into your XIV game folder — and keeps it working after game patches. No 264 MB archives to unpack, no Discord attachment hunting, no config files to edit by hand.

## Download

**[⬇ Download Lucent.exe](https://github.com/arnaudcouturier/lucent/releases/latest/download/Lucent.exe)** — Windows 10 22H2 / 11, x64, single portable exe.

The app is in final review; the download becomes available with the first Stable app release. Developers can run the current app from source below.

The [download site](https://arnaudcouturier.github.io/lucent/) explains the Windows SmartScreen warning before you meet it. Lucent is open source, sends no telemetry, and never asks for an antivirus exclusion.

## How it works

1. **Scan** — Lucent finds your game folder, graphics card and launcher, and lists every file it will back up and replace (an existing GShade, ReShade or OptiScaler, for instance) and the folder where it keeps a copy.
2. **Your choices** — pick Fidelity, Balanced or Performance, whether to include ReShade, and whether to add Lucent to the Start menu.
3. **Review** — check the backup and file counts, download size and your choices before anything changes.
4. **Done** — Lucent deploys, then teaches you the in-game keys, read from the configs it deployed. The [guide](https://arnaudcouturier.github.io/lucent/guide.html) explains every key and setting.

After that it stays quiet: a health check runs on every open, Repair fixes patch drift in one click, updates are offered (never forced), and Uninstall restores every file Lucent replaced from its backups and removes what it added. Your own presets and shaders are kept; where a first deployment must write the same path as one of your files, Scan lists it and it is backed up first.

Home holds Launch XIV, the status card, performance profile and Enabled switch. The label below Launch names the selected launcher; when several apply, its arrow lets you choose, and Lucent remembers. Keys shows your current in-game shortcuts, Versions manages updates and rollback, Logs shows everything Lucent has done and what OptiScaler and ReShade report, Settings holds the game folder and launcher preferences, and Help holds diagnostics, the guide and credits.

## Graphics tiers

The current manifest publishes content for RTX 30/40 on the Beta channel. Enable **Beta channel** on Scan for a first deployment, or in Settings afterward. The other tiers await tested content. A tier's status describes how proven its setup is; the content channel determines which versions are offered. The [site's graphics card list](https://arnaudcouturier.github.io/lucent/#cards) reads availability directly from the manifest.

| Tier | Tier status | Content | Availability |
|---|---|---|---|
| RTX 50 | Community-verified | DLSS 5 Neural Rendering | Not published |
| RTX 30/40 | Stable | DLSS 5 via the compatibility runtime | Beta |
| RTX 20 | Experimental | DLSS 5 via the compatibility runtime | Not published |
| Radeon | Experimental | FSR upscaling + ReShade | Not published |
| Other | Stable | ReShade and presets | Not published |

## Credits

Lucent deploys other people's excellent work, each credited in the app, on the site, and with its licence file next to its files: SirenBrink and the OptiScaler authors, ShortFuse / RenoDX, crosire (ReShade), Marty McFly (iMMERSE), qUINT, Wafflezs (Alive NEXT), and ipsusu (ipsuShade). Lucent itself is not affiliated with Square Enix; FINAL FANTASY XIV is a trademark of Square Enix Holdings Co., Ltd.

## For developers

```sh
npm ci
npm run dev        # UI in a browser on a fake machine · npm run tauri dev for the real app
npm test           # TypeScript suite      ·  npm run test:rust for the Rust primitives
npm run typecheck
```

The domain core in `src/core/` is framework-free and reaches the machine only through the Platform port; the Tauri 2 shell in `src-tauri/` provides the real primitives. Start with [CONTEXT.md](CONTEXT.md) for the glossary, [docs/decisions.md](docs/decisions.md) for why things are the way they are, [docs/publishing.md](docs/publishing.md) to publish a content version, and [docs/release-checklist.md](docs/release-checklist.md) to cut an app release.

## Licence

Lucent is [MIT](LICENSE). The components it deploys keep their own licences, shipped alongside their files.
