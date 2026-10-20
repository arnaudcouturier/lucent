# Beta content candidate 2026.10.21

2026.10.20 with two recipe changes and no new files: ReShade's screenshot folder, and the folder OptiScaler's diagnostics fill. It requires Lucent app `0.3.0-beta.8`, which understands both (`{Pictures}` in an `ini_set` value, and a folder in `generatedFiles`). Publish the app first, then this content. Everything else (OptiScaler-FFXIV 2026.10.20, Streamline 2.14.16, the 310.9.16 runtimes, the Ember looks, the tiers) is 2026.10.20 unchanged: read `content/candidates/2026.10.19/README.md` for what lands in the game folder and the ini defaults, and `content/candidates/2026.10.20/README.md` for Ember.

`recipe.json` is 2026.10.20's with a new id, `minAppVersion`, changelog, `reshadeSettings` and `generatedFolders`; the pinned inputs (fork zip, ini, palette) are the same, so the same command assembles it.

## ReShade screenshots

`reshadeSettings` adds one `ini_set` after the `ReShade.ini` copy, for the `reshade` condition: `[SCREENSHOT] SavePath = {Pictures}\FFXIV Screenshots`. The base `ReShade.ini` still says `SavePath=.\`, and only a player's install replaces it with the real path, because the folder is theirs. ReShade 6.8.0 reads an absolute path as it is (`base / SavePath` is the absolute path), creates the folder when it saves the first screenshot (`runtime::save_screenshot` calls `create_directories`), and expands neither `%USERPROFILE%` nor `~`; that is why the app resolves it. New installs and Reset only, since `ReShade.ini` is `keep`.

## Uninstall

`generatedFolders` adds `OptiScaler/hudless-diag` to each tier's `generatedFiles`. The fork's HUD-less diagnostics (`[HudLess] Diagnostics`, on in the shipped ini) write a new folder of files there on every run, which the journal never saw, so Uninstall left them behind. An app that doesn't know folder entries ignores them, which is why the version requires 0.3.0-beta.8.

## Assemble and dry-run

From the repository root, in PowerShell (Git Bash drops the backslashes). The command writes `publish.json`, `manifest.json`, `files\`, `provenance.json` and the staged `sources\`, and publishes nothing:

```powershell
npx tsx scripts/prepare-fork-candidate.ts --base C:\LucentContent\candidate-2026.10.17\publish.json --recipe content\candidates\2026.10.21\recipe.json --fork-zip C:\LucentContent\downloads\OptiScaler-FFXIV-2026.10.20-d9b62110.zip --streamline-zip C:\LucentContent\downloads\streamline-sdk-v2.14.16.zip --nr-folder C:\Users\arnaudc\Desktop\nvngx_dlssnr --tuned-ini C:\Users\arnaudc\workspace\OptiScaler-FFXIV\builds\backup-game-20261019-1834-release-20261019\OptiScaler.ini --output C:\LucentContent\candidate-2026.10.21
npm run publish:content -- C:/LucentContent/candidate-2026.10.21/publish.json --dry-run
```

The dry run uploads nothing: every file is already published, so the release `content-2026.10.21` holds only the notes.
