# App release checklist

Use this checklist for every app version. Record the app version, commit, content versions,
game version, Windows version and NVIDIA driver version alongside the results. The manual
checks come from [the spec's Testing Decisions](https://github.com/arnaudcouturier/lucent/issues/1).
For an early app version, explicitly record checks for unfinished features as not applicable
and describe the available features in the release notes.

## Prepare the version

- [ ] Update `package.json` and `src-tauri/Cargo.toml` to the same app version, and refresh
  `package-lock.json` (`npm install --package-lock-only`) and `src-tauri/Cargo.lock`
  (`cargo check --manifest-path src-tauri/Cargo.toml`). Tauri reads its version from `package.json`.
- [ ] Use `X.Y.Z` for Stable or `X.Y.Z-beta.N` for Beta (for example, `0.2.0-beta.1`).
- [ ] Run `npm ci`, `npm run typecheck`, `npm test` and
  `npm run test:rust -- --locked`.
- [ ] Build the candidate with
  `npm run tauri -- build --ci --no-bundle --target x86_64-pc-windows-msvc -- --locked`.
- [ ] Write `docs/releases/<version>.md` for the version: the lines above its first `##` heading
  (minus the `# ` title) become the release notes the app shows on the status card, so keep them
  plain sentences. A version with no such file falls back to `--generate-notes` and the workflow
  prints a warning. Commit it with the version changes, before tagging: the notes file must be in
  the tagged commit. Beta promotion requires a new Stable version commit and tag; changing a Beta
  release's flags does not rebuild its exe.

## Manual checks on the RTX 4090

Use the real game on the maintainer's RTX 4090 machine. Keep a recursive SHA-256 listing of
the vanilla game folder's relative file paths and bytes before the first deployment; keep
the listing outside the game folder. Compare against it after uninstall, accounting separately
for files the game itself generates. Use two real content versions for the update checks.

- [ ] Deploy from a vanilla game folder, picking a DLSS preset, passes and Neural Rendering resolution on the Graphics
  step; confirm the game picks up its settings (`ForcePerfQuality`, `Passes`, `WorkingScale` in `OptiScaler.ini`).
- [ ] On the Graphics step, confirm the DLAA hint (75%), that residual frame generation is greyed out with a reason on RTX 30 and with
  frame generation Off, and that Unlock multi-frame generation gates 3×–6× and Dynamic on RTX 40 while 2× works with it on or off.
- [ ] On the Graphics step, confirm the frame generation modes match the card (RTX 4090 vs RTX 3080), the
  default is 2× at 120 Hz and up and Off below, HDR is offered only on an HDR monitor, and the line under each
  choice reads correctly. Deploy with HDR on: Windows Auto HDR is off for `ffxiv_dx11.exe` afterwards, and
  Uninstall puts it back. The step is usable at 1000×680 and 880×600 (it scrolls above its pinned actions in the
  richest case).
- [ ] In Keys, confirm the displayed shortcuts match the deployed configs. In game, use those
  shortcuts to open OptiScaler and ReShade, and confirm Neural Rendering is active.
- [ ] On Home, confirm there are no setting controls: only the status card, Launch XIV and
  Enabled, at 1000×680 and at 880×600.
- [ ] In the OptiScaler overlay, change a setting, save and close the game. Reopen Lucent and
  launch XIV from it: `OptiScaler.ini` still holds your value and the deployment is healthy. Change
  the monitor's refresh rate or Windows HDR and do the same: the frame cap and `PeakNits` in
  `OptiScaler.ini` stay as they were.
- [ ] With the game closed, replace a deployed file to simulate a game patch. Reopen Lucent,
  confirm drift, choose Repair, and confirm a healthy deployment and working game.
- [ ] With XIVLauncher auto-repair on (Settings) and the Lucent window closed, replace a deployed
  file, launch through XIVLauncher and close the game. Confirm both notifications and that the
  file is repaired.
- [ ] While one Lucent window is deploying or repairing, open another window and start a
  XIVLauncher check or repair. Confirm each reports the active operation without undoing its
  journal. After the first operation finishes, the second window can Scan and headless repair works.
  Repeat a game-folder change through UAC and confirm it uses the original player's data folder.
- [ ] Turn Enabled off. Confirm the Disabled deployment runs the game as vanilla.
- [ ] In Settings, open **Reset setup…**. Confirm the dialog names a new readable backup folder,
  the Profile step is prefilled with the stored choices, and changing the screen recomputes the
  frame cap and peak brightness. Confirm Reset rewrites tuned config files, keeps Disabled,
  and Uninstall afterwards restores the original vanilla folder.
- [ ] Change to a GPU in another tier. Confirm **Switch tier** opens the same prefilled Profile →
  Review flow, defaults options unavailable in the new tier, and keeps Disabled through Apply setup.
- [ ] Update and roll back between two real content versions; confirm the game works after each.
  With a setting tuned in each config file first, confirm the tuned value survives where the new content
  keeps the file, only absent keys appear where it adds missing keys, and the file is backed up and
  rewritten where it replaces. The status card's changelog names the files it adds keys to or replaces, and
  Logs has a line per config file.
- [ ] Delete `OptiScaler.ini` and choose Repair (or let XIVLauncher's repair run on close): it returns with
  your first-install choices and the frame cap of the screen you have now. Tune it again, replace a deployed
  file, and Repair: the tuned file is left alone.
- [ ] Open a 0.1.1 deployment with this app: every config file stays as it was, the activity log
  says the record was migrated once, and Reset later offers the recorded profile (Fidelity as Ultra),
  frame generation Off and HDR Off.
- [ ] Update from the full shader pack to the pruned content. Confirm unused Lucent-owned shaders
  are removed, user shaders stay, and the Alive and ipsuShade presets load their shipped effects.
  Presets that require paid or user-supplied effects still require those files from the player.
- [ ] In Help, Copy diagnostics puts the full diagnostics on the clipboard, Report a bug opens
  a pre-filled GitHub issue, and Credits lists every component and upstream author.
- [ ] On Home, Launch XIV names the selected launcher. When multiple launchers apply, choose
  each from the arrow and Settings, confirm the choice persists after reopening Lucent, and
  confirm Launch opens the selected launcher. While XIV runs, Home shows “In game”.
- [ ] With "Add Lucent to the Start menu" checked, confirm the Start menu shortcut and the
  Settings → Apps entry, then uninstall from Settings → Apps with "Restore the game folder" on.
  Confirm Lucent's data folder and installed exe are gone after it exits.
- [ ] Before installing over an existing setup, open Scan's Show files and confirm the list and the
  "Backed up to" folder. After installing, confirm that folder holds every listed file.
- [ ] Uninstall and compare the game folder against the pre-deployment hash listing. Confirm the
  readable backup folder is gone.
- [ ] Check the window chrome on Windows 11 and in a Windows 10 22H2 x64 VM: dragging,
  minimize, maximize and restore (button and double-click), resizing from every edge down to
  880×600, close, shadow and rounded corners where supported. The uninstall window stays fixed.
- [ ] A fresh launch opens at 1000×680. At that size, at the 880×600 minimum and maximized,
  visit Home, Keys, Versions, Logs, Settings and Help. Confirm controls and long paths fit, scrolling
  reaches every action, and Launch XIV and its chooser stay clearly below the caption buttons.

## First session only

Before the first release, on top of the checks above:

- [ ] Deploy over the existing hand-made setup rather than a vanilla folder (#27). Confirm Scan
  lists it, its presets carry over, and uninstall brings the hand-made setup back.
- [ ] Check the GPosingway signature and the swapped-DLSS backup names (`.dlsss`, `.bak`,
  `.backup`) in `manifest.json` against real installs.
- [ ] Measure the crystal with the game running, following [the crystal procedure](crystal.md),
  including minimize and Alt-Tab (#22).
- [ ] Close #22 once its check passes.

## Publish and verify

Pushing an app tag publishes immediately after the automated checks succeed. Finish the
candidate checks before pushing it. The workflow runs on GitHub-hosted
Windows x64, uses the committed dependency locks, and runs both complete test suites before
building. It publishes only the portable `Lucent.exe`.

- [ ] Push the version commit, then an annotated tag for that exact commit:

  ```sh
  git tag -a app-v0.2.0 -m "Lucent 0.2.0"
  git push origin app-v0.2.0
  ```

  For Beta, use `app-v0.2.0-beta.1` instead. Content tags (`content-YYYY.MM.DD`) do not
  trigger the app workflow. Invalid app tags or version mismatches fail before the build.
- [ ] Confirm the **Release app** Actions run passes and the release contains `Lucent.exe`.
  Stable is marked Latest; Beta is marked Pre-release and never Latest. Publish Stable
  versions in increasing order. Re-running an already published tag fails rather than
  replacing its assets; fix a published app by shipping a new version.
- [ ] Download the published exe and repeat the portable launch smoke check from a folder
  outside the checkout. Confirm the reported app version and Scan against the real game.
- [ ] For Stable, download through
  [the stable download link](https://github.com/arnaudcouturier/lucent/releases/latest/download/Lucent.exe)
  and compare its SHA-256 to the versioned release asset. For Beta, confirm the link still
  serves the previous Stable exe. Before the first Stable release there is no Latest link.
- [ ] After the first Stable release, check that
  `https://github.com/arnaudcouturier/lucent/releases/latest/download/Lucent.exe` and the
  README's latest-release badge resolve, then remove the README's "The first release isn't out yet"
  note.
- [ ] Submit the **published exe** to
  [Microsoft Security Intelligence](https://www.microsoft.com/en-us/wdsi/filesubmission)
  as a **Software developer** for false-positive analysis. Record its SHA-256, submission ID,
  any detection name and Microsoft's result with the release checks. If the file is flagged,
  report it as an incorrect detection and follow up on the result. Never add Defender exclusions.
- [ ] Review the published release notes (from `docs/releases/<version>.md`, or generated when
  there is no file): describe the shipped features and known limitations, and link the manual
  check results.
