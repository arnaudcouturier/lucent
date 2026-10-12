# Manifest schema and dev content

`manifest.json` is fetched from `main` in `arnaudcouturier/lucent` on GitHub. The app and the
future publish tool share `src/shared/manifest.ts`: `parseManifest` validates JSON text and
`validateManifest` validates an object before publishing. The module has no UI or Platform dependency.

Schema version **1** contains only `schemaVersion` and `tiers`. Content versions, files and recipes
will be added by later tickets. A newer schema version produces an app-update message before its
contents are interpreted. Invalid manifests and fetch failures leave the graphics card visible
without assigning a tier.

Each tier has `id`, `label`, `status` (`stable`, `experimental`, `community-verified`), `gpuMatch`,
`neuralRendering` and `requiresReShade`. The first matching tier wins. A GPU rule contains a numeric
PCI `vendorId` and `deviceNamePatterns`, a nonempty list of case-insensitive regular expressions.
Both the vendor and at least one pattern must match. NVIDIA is 4318 (`0x10de`), AMD is 4098
(`0x1002`), Intel is 32902 (`0x8086`). The last tier must use `"gpuMatch": "any"`; earlier tiers
must supply rules. Tier IDs are unique. Patterns are checked at validation time.

Scan discards software adapters and chooses the adapter with the most dedicated video memory,
excluding shared system memory. Windows enumeration uses DXGI. XIVLauncher presence is determined
independently from the game folder, from its config file under `%APPDATA%\XIVLauncher`.

## Local content in a dev build

The repo remains private before launch, so an unauthenticated GitHub fetch may fail. Set these
environment variables **before** starting the Tauri dev process:

```powershell
$env:LUCENT_DEV_MANIFEST = 'C:\Users\arnaudc\workspace\ffxiv-dlss5\manifest.json'
$env:LUCENT_DEV_FILES = 'C:\LucentContent\files'
npm run tauri dev
```

`LUCENT_DEV_MANIFEST` selects a local manifest instead of GitHub. `LUCENT_DEV_FILES` selects its
local release-files directory; it defaults to `files` alongside the manifest. Scan carries that
directory in the validated manifest's content source for subsequent deployment work. Schema v1
does not list or download payload files yet. Local content is never silently replaced with remote
content if the local manifest is missing or invalid. Portable release builds ignore both variables.

Browser dev mode uses fake machines and a fake release host, with the committed manifest's tiers.
The dev-only gallery includes every tier, an app-update request, invalid/unavailable manifests and
a machine without a hardware adapter. Open `?gallery=rtx-20` to inspect the caution badge.
