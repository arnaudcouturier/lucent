# Starter set (Mods) validation plan

**Written:** 2026-10-17  
**Build under test:** branch `feat/starter-set-mods`, not released. Design: `docs/decisions.md`, Starter set (Mods). Schema: `docs/manifest.md`, Starter set.

What is already checked, and the one run in the game that is left.

## Checked without the game

- **Tests:** 824 TypeScript tests and 71 Rust tests pass, and `cargo test --locked` accepts the committed `Cargo.lock`. The core is tested against the fake Platform: repo splice (empty list, CRLF, BOM, single-line file, exact-string matching, refusing an unexpected layout), every skip reason, the game and XIVLauncher checks at each of the three points, and a failed copy halfway being cleaned up.
- **The real download links:** each of the nine plugins Lucent can fetch (Weatherman, AcrylicXIV, CharacterPanelRefined, MultiHit and Browsingway from Dalamud's repository; Penumbra and Glamourer from SeaOfStars; ActionTimelineReplacement from papapachin's repo; IINACT from marzent's) was downloaded from its `DownloadLinkInstall` with Lucent's own user agent: HTTP 200 after redirects, and a real zip every time. The largest is Penumbra at 7 MB.
- **The real extractor:** the Rust `extract_zip` unpacked all nine. Each has `<InternalName>.json` and `<InternalName>.dll` at its root, the manifest's `InternalName` and `AssemblyVersion` match its repo entry, no cap is near (Penumbra is 36 files and 17 MB), and no entry name is unsafe.
- **The app's path rule:** `assertGamePath` accepts all 133 entries across those nine zips.
- **The browser:** the Mods section on the fake machines `?machine=mods` and `?machine=modsFresh`, the consent panel, a full Add, the unavailable card on a PC without Dalamud, and the rail at the 880×600 minimum window (seven rows fit; below 640px tall the rail's rows are 30px).
- **The spike (2026-10-17):** a plugin placed by script loads on the very next start. See `docs/decisions.md`, Implementation notes.
- **The release build:** `tauri build --ci --no-bundle --target x86_64-pc-windows-msvc`, as `release.yml` runs it.

## HaselTweaks (added 2026-10-26)

Checked against the real thing before it went into the set: the author's repository (`https://raw.githubusercontent.com/Haselnussbomber/MyDalamudPlugins/main/repo.json`, the address the plugin's README gives) lists `HaselTweaks` 50.0.2.0 at Dalamud API level 15, the level of 412 of the 500 plugins in Dalamud's own repository. Its `DownloadLinkInstall` was downloaded with Lucent's user agent (HTTP 200, 9,599,922 bytes), and the zip's own `HaselTweaks.json` matches the repo entry (`InternalName`, `AssemblyVersion`, `DalamudApiLevel`). The Rust `extract_zip` unpacked it (40 files, 50,597,911 bytes, against limits of 4,000 files, 256 MB and 128 MB per file; the largest entry is the 26 MB `FFXIVClientStructs.xml`), including the `runtimes/win/lib/net10.0` subfolder, and `assertGamePath` accepts all 40 entries. `src/core/starterSetHaselTweaks.test.ts` runs the Add against the repository's own set: the repository is appended with its exact address, the plugin lands with every file and `InstalledFromUrl` equal to that address, an existing entry is left alone, and a switched-off repository skips the plugin with a reason. Not run in the game.

## In the game: one combined run

This covers what nothing above can: the real window, the real Tauri port, Lucent writing the repository entry itself, and adding a plugin the player had removed. It uses ActionTimelineReplacement because its repository is the one Dalamud will load only if the entry is exactly right.

1. **Remove it the way a player would.** With XIV running, open `/xlplugins` and uninstall ActionTimelineReplacement. Open `/xlsettings`, the Experimental tab, and remove papapachin's custom repository from the list. Close XIV and XIVLauncher.
2. **Back up.** Copy `%APPDATA%\XIVLauncher\dalamudConfig.json` and the folder `%APPDATA%\XIVLauncher\installedPlugins` somewhere safe.
3. **Run the built Lucent** (`src-tauri\target\x86_64-pc-windows-msvc\release\lucent.exe`, built from this branch with `npx tauri build --ci --no-bundle --target x86_64-pc-windows-msvc`) and open **Mods** (from the first-run steps if there is no deployment, or from the rail). Touch nothing else in it. Expected:
   - ActionTimelineReplacement reads **Not installed**; the other plugins you have read **Installed**.
   - **Add plugins…** says `1 plugin to add`.
   - Its confirmation names papapachin's repository and its address, with the warning.
   - After confirming, the report says it added ActionTimelineReplacement and a repository.
4. **Launch XIV from XIVLauncher with Dalamud on.** Expected: ActionTimelineReplacement is in `/xlplugins` under installed plugins, enabled, with no warning icon, and papapachin's repository is back in `/xlsettings`, Experimental.
5. **Close XIV, then open `dalamudConfig.json`.** The `ThirdRepoList` still holds papapachin's entry after Dalamud saved its own settings.
6. **If anything differs,** close XIV and XIVLauncher and put the two backed-up items back. Then report which step differed, and what `%APPDATA%\XIVLauncher\dalamud.log` says about the plugin.

Pass: steps 3 to 5 behave as written.

## Optional: a clean first install

The spike was a reinstall, so `dalamudConfig.json` still held the plugins' profile entries. A new player has neither. To try it, use a Windows user or a PC with a fresh XIVLauncher and Dalamud that has launched the game once, and run step 3 and 4 with all the core plugins. Expected: each plugin appears enabled on the first launch.

## Left out on purpose

- **Refusing a plugin whose repository is disabled or whose address doesn't match.** That is Dalamud's behaviour, and Lucent never creates either state: it skips a plugin whose repository is off, and it writes the exact address already in `ThirdRepoList`.
- **Installing mods.** Lucent only links to Heliosphere's pages and detects what is in Penumbra's mod folder. Heliosphere's own one-click install is its business.
- **The Heliosphere plugin.** Lucent never downloads it (its terms bar other programs from its endpoints), so the row tells the player to install it from `/xlplugins`.
