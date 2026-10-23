<p align="center">
  <img src="docs/assets/lucent-banner.svg" alt="Lucent, a manager for XIV graphics mods" width="100%">
</p>

<p align="center">
  <a href="https://github.com/arnaudcouturier/lucent/releases/latest"><img src="https://img.shields.io/github/v/release/arnaudcouturier/lucent?label=latest%20release&color=f47521" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-f47521" alt="MIT licence"></a>
  <a href="https://arnaudcouturier.github.io/lucent/"><img src="https://img.shields.io/badge/website-download-f47521" alt="Download site"></a>
</p>

<p align="center">
  <a href="https://arnaudcouturier.github.io/lucent/"><b>Website</b></a>
  &nbsp;·&nbsp;
  <a href="https://arnaudcouturier.github.io/lucent/guide.html"><b>Guide</b></a>
  &nbsp;·&nbsp;
  <a href="https://arnaudcouturier.github.io/lucent/files.html"><b>Files</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/arnaudcouturier/lucent/releases"><b>Releases</b></a>
</p>

<br>

Lucent is a portable Windows app that manages graphics mods for XIV. It installs them in your game folder and removes them cleanly. Every file it replaces is backed up first.

## Download

**[Lucent.exe](https://github.com/arnaudcouturier/lucent/releases/latest/download/Lucent.exe)** &nbsp;·&nbsp; Windows 10 22H2 or 11 &nbsp;·&nbsp; x64

Lucent.exe isn't code-signed, so Windows warns on first launch. The site shows [what to expect](https://arnaudcouturier.github.io/lucent/#smartscreen) and how to verify the file.

## Features

Lucent manages two features: DLSS 5 through OptiScaler, and ReShade with shaders and presets. It detects your graphics card and installs the setup made for it.

| Card | OptiScaler | ReShade | Content |
|:--|:--|:--|:--|
| RTX 50 | DLSS 5 Neural Rendering, with the runtime file NVIDIA ships | Optional | **Beta** |
| RTX 20 / 30 / 40 | DLSS 5 Neural Rendering, with ShortFuse's compatibility build of NVIDIA's runtime | Optional | **Beta** |
| Radeon | No Neural Rendering. FSR upscaling and FSR frame generation instead | Always | Not yet |
| Any other | Not installed | Always | Not yet |

To use Beta content, turn on **Beta channel** on the Scan screen. The [site](https://arnaudcouturier.github.io/lucent/#features) reads this list from the manifest, so it is always current. If there's another tool you'd like Lucent to manage, [open an issue](https://github.com/arnaudcouturier/lucent/issues).

## What the manager does

| | |
|:--|:--|
| **Finds your game** | Game folder, launcher and graphics card. Works with XIVLauncher, Steam and the Square Enix launcher. |
| **Backs up first** | Scan lists every file it will replace, such as an existing GShade, ReShade or OptiScaler. Each one is backed up. |
| **Repairs after patches** | Every deployed file is checked against its hash. If a patch replaced one, Repair puts it back. |
| **Updates when you say** | New versions are offered, never forced. Versions rolls back. |
| **Uninstalls cleanly** | Restores what it replaced and removes what it added. Your own presets and shaders stay. |
| **Offers a starter set** | The Mods section places a few Dalamud plugins once, after you read which plugin repositories it adds, and links to Penumbra mods on Heliosphere. It needs XIVLauncher with Dalamud, and Lucent leaves them alone afterwards. |
| **No telemetry** | Open source. [Every file it installs](https://arnaudcouturier.github.io/lucent/files.html) is listed with its SHA-256. |

## Credits

Lucent installs other people's work. Each component ships with its licence.

| | |
|:--|:--|
| OptiScaler | [OptiScaler-FFXIV](https://github.com/arnaudcouturier/OptiScaler-FFXIV) |
| AMD FidelityFX | [AMD](https://github.com/GPUOpen-LibrariesAndSDKs/FidelityFX-SDK) |
| Intel XeSS | [Intel](https://github.com/intel/xess) |
| Compatibility runtime | ShortFuse / [RenoDX](https://github.com/clshortfuse/renodx) |
| ReShade | [crosire](https://reshade.me/) |
| iMMERSE and qUINT | [Marty McFly](https://github.com/martymcmodding/iMMERSE) |
| SweetFX | [CeeJay.dk and contributors](https://github.com/CeeJayDK/SweetFX) |
| Alive presets | [Wafflezs](https://www.nexusmods.com/finalfantasy14/mods/156) |
| ipsuShade | [ipsusu](https://github.com/ipsusu/ipsuShade) |

## Licence

[MIT](LICENSE). The components Lucent installs keep their own licences.

Not affiliated with Square Enix. FINAL FANTASY XIV is a trademark of Square Enix Holdings Co., Ltd.
