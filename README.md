<p align="center">
  <img src="docs/assets/lucent-banner.svg" alt="Lucent — DLSS 5 and ReShade for FINAL FANTASY XIV, in one app" width="100%">
</p>

<p align="center">
  <a href="https://github.com/arnaudcouturier/lucent/releases/latest"><img src="https://img.shields.io/github/v/release/arnaudcouturier/lucent?label=latest%20release&color=f47521" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-f47521" alt="MIT licence"></a>
  <a href="https://arnaudcouturier.github.io/lucent/"><img src="https://img.shields.io/badge/website-download-f47521" alt="Download site"></a>
</p>

Lucent is a portable Windows app that installs a tested DLSS 5 Neural Rendering + ReShade setup into your FINAL FANTASY XIV game folder — and keeps it working after game patches. No 264 MB archives to unpack, no Discord attachment hunting, no config files to edit by hand.

## Download

**[⬇ Download Lucent.exe](https://github.com/arnaudcouturier/lucent/releases/latest/download/Lucent.exe)** — Windows 10 22H2 / 11, x64, single portable exe.

The [download site](https://arnaudcouturier.github.io/lucent/) explains the Windows SmartScreen warning before you meet it. Lucent is open source, sends no telemetry, and never asks for an antivirus exclusion.

## How it works

1. **Scan** — Lucent finds your game folder, graphics card and launcher, and spots any existing setup (GShade leftovers, another ReShade or OptiScaler) that it will back up and replace.
2. **One question** — pick Fidelity, Balanced or Performance.
3. **Review** — see exactly what will be backed up, added and downloaded before anything changes.
4. **Done** — Lucent deploys, then teaches you the two overlay hotkeys.

After that it stays quiet: a health check runs on every open, Repair fixes patch drift in one click, updates are offered (never forced), and Uninstall restores your game folder exactly as it was. Your own and paid shaders are never modified or removed.

## Graphics tiers

| Tier | Status | What you get |
|---|---|---|
| RTX 50 | Community-verified | DLSS 5 Neural Rendering |
| RTX 30/40 | Stable | DLSS 5 via the compatibility runtime |
| RTX 20 | Experimental | DLSS 5 via the compatibility runtime |
| Radeon | Experimental | FSR upscaling + ReShade |
| Other | Stable | ReShade and presets |

## Credits

Lucent deploys other people's excellent work, each credited in the app, on the site, and with its licence file next to its files: SirenBrink and the OptiScaler authors, ShortFuse / RenoDX, crosire (ReShade), Marty McFly (iMMERSE), qUINT, the Alive NEXT authors, and ipsusu (ipsuShade). Lucent itself is not affiliated with Square Enix; FINAL FANTASY XIV is a trademark of Square Enix Holdings Co., Ltd.

## For developers

```sh
npm install
npm run dev        # UI in a browser on a fake machine · npm run tauri dev for the real app
npm test           # TypeScript suite      ·  npm run test:rust for the Rust primitives
npm run typecheck
```

The domain core in `src/core/` is framework-free and reaches the machine only through the Platform port; the Tauri 2 shell in `src-tauri/` provides the real primitives. Start with [CONTEXT.md](CONTEXT.md) for the glossary, [docs/decisions.md](docs/decisions.md) for why things are the way they are, [docs/publishing.md](docs/publishing.md) to publish a content version, and [docs/release-checklist.md](docs/release-checklist.md) to cut an app release.

## Licence

Lucent is [MIT](LICENSE). The components it deploys keep their own licences, shipped alongside their files.
