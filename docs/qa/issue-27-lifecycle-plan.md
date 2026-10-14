# Issue #27 lifecycle validation plan

**Audit date:** 2026-10-14  
**Release under test:** `0.2.0-beta.1` with Beta content `2026.10.15`

This note records the collected evidence and the safe preparation for the remaining lifecycle acceptance work. It does not promote the release to Stable.

## Collected evidence

- The published app and `2026.10.15` content are available as Beta releases. The release record reports 666 TypeScript tests and 54 Rust tests, and records maintainer gameplay attestation for the profile, frame-generation, and HDR choices.
- The deployed record is `complete`, enabled, and describes RTX 4090 / Ultra / 2x frame generation / HDR Off / ReShade included. It owns 188 files. The game `game` directory currently contains 429 files; 241 are outside the record-owned graph.
- The current record-owned configuration bytes are unchanged after the native preflight: `OptiScaler.ini` is 68,685 bytes with SHA-256 `9f307279b2c11d477a1fc74d5787e658c742b12ec841ba49efd09e0be2d4bdf3`, `ReShade.ini` is 5,017 bytes with SHA-256 `663cf31060cf151a65101d3928599a6fb24532c9e7cb5d64f8934dbcd18426e2`, and `ReshadeEffectShaderToggler.ini` is 7,377 bytes with SHA-256 `4d55492fdebec366c18dd513c8d3427c8e5555f72f124d219bf63cc0685abdd8`.
- `ReShade.ini` has an empty `PresetPath`; no unowned shader or preset paths were found in the current file inventory. The record-owned shader and preset trees are included in the protected baseline.
- The only pre-existing game file recorded before the current install is `nvngx_dlss.dll`: 53,689,400 bytes, SHA-256 `68c99e387767c23a4205c04746809443619fdc88c65a5b57687350a313211010`. The readable backup agrees with the deployment journal. The internal deployment history contains 1,142 backup objects; it is not a substitute for an external snapshot before a destructive test.
- The cache has 176 content assets and one cached version entry (`2026.10.15`). No separate cached prior-version deployment snapshot for `2026.10.14` is present, so prior-content rollback is not proven by this record.

## Native preflight smoke

The settled native UI state was observed without changing the game:

- Home showed **Healthy** and **Enabled**.
- Settings showed Beta content `2026.10.15`, XIVLauncher selected, and AutoRepair off.
- Reset confirmation showed a readable timestamped backup destination.
- The prefilled choices were Ultra, 2x, HDR Off, and Include ReShade; the display values were 240 Hz, frame cap 224, and rendered cap 112.
- Review reported 188 backups, 0 added files, and 0 downloads.
- The flow was backed out to Home after Review. **Review was reached; Apply was not pressed.** This proves the preflight and cancel path only; it is not evidence that Reset rewrites files successfully.

The app record, configuration hashes, and timestamps were rechecked after cancellation and remain unchanged. No game process was launched, no uninstall was run, and no registry preference was changed.

## Applied Reset evidence

After the protected baseline was captured, root ran the coordinated reversible lifecycle check with XIV closed:

- Enabled was switched off and verified by the native UI; `winmm.dll` became `winmm.dll.disabled`.
- A temporary comment was appended to `OptiScaler.ini` to prove that Reset backed up the exact pre-Reset bytes. The marker hash was `fe81abce040018ea9a9b6ac205eeaa66b620783f29924f1332fda44796160b62`.
- Reset used the same Ultra / 2x / HDR Off / Include ReShade choices. Review showed 188 backups, 0 added files, and 0 downloads. Apply completed successfully while Disabled persisted.
- The displayed Reset backup contained 188 files, and its `OptiScaler.ini` hash matched the marked pre-Reset file exactly. The live marker was removed and the live config returned to the protected baseline hash.
- After re-enabling, the native UI returned to Healthy and Enabled. Read-only comparison found all 188 managed files matching the baseline, all 241 unowned paths matching by path, size, and UTC mtime, and all eight unowned top-level files byte-for-byte unchanged.

This proves the applied Reset, readable backup, Disabled persistence, and re-enable lifecycle. It does not prove uninstall, rollback to a prior content version, or gameplay behavior.

## Repair evidence

The same session replaced one managed file (`reshade-shaders/Shaders/OtisFX/MultiLUT.fx`) with XIV closed. Lucent's health check reported drift in exactly that file, Repair rewrote only it, and the check returned to healthy with 188 files. A harmless comment appended to `OptiScaler.ini` survived the Repair, so Repair keeps tuned configs.

## Uninstall and reinstall evidence (2026-10-14)

With XIV closed, a fresh recursive listing of the game folder was captured outside it before the test: 451 files, SHA-256 for every file up to 200 MB and size plus UTC mtime for the 73 larger ones. Before the listing, the Repair marker was removed so `OptiScaler.ini` matched the protected baseline hash.

**Settings → Uninstall from this game** was confirmed in the published `0.2.0-beta.1` app, and the log reported that Lucent put back the file it had replaced.

- The folder went from 451 to 264 files. Exactly the 187 record-owned additions were removed; no record-owned file remained apart from `nvngx_dlss.dll`.
- `game/nvngx_dlss.dll` was restored byte-for-byte to its original 53,689,400 bytes, SHA-256 `68c99e387767c23a4205c04746809443619fdc88c65a5b57687350a313211010`.
- No file was added. No other file changed in hash, or in size and mtime for the large files. The 241 unowned game paths and the other unowned files were untouched.
- All 50 directories Lucent created were removed (67 to 17 directories). Lucent generated no logs in that deployment (`OptiScaler.log`, `ReShade.log` absent).

Then the first-install flow was run again with Ultra, 2x, HDR Off and ReShade included. The Profile step's defaults picked HDR on this machine, so Off was chosen explicitly to match the record. Review showed 1 backup, 187 added, 0 downloaded. Install finished in 2 s and the health check reported healthy with 188 files. All 188 managed files match the protected baseline hashes, the live file set is again the 451 pre-uninstall paths with no hash difference, and `OptiScaler.ini` and `ReShade.ini` match the baseline hashes.

This proves Uninstall restores the folder exactly and the same setup can be reinstalled from cache. Prior-content rollback and gameplay remain unobserved. The 130 GB of unowned game assets were compared by size and mtime, not rehashed.

## Protective baseline

A private external baseline was created outside the game directory and is intentionally not committed. It contains:

- copies of `record.json` and `settings.json`;
- byte-verified copies of all 188 record-owned files (618,965,378 bytes);
- a 241-path inventory for the unowned game files;
- copies of the eight unowned top-level files, including both `XInputXIV` files; and
- the readable pre-existing `nvngx_dlss.dll` backup with the exact hash above.

The baseline is a safety aid for the upcoming coordinated test. Immediately before any destructive action, capture a fresh recursive path, size, and SHA-256 listing of the live game directory while XIV is closed; the current external inventory intentionally avoids hashing the 130 GB of unowned game assets a second time.

## Remaining coordinated test sequence

1. Confirm XIV is closed and retain the external baseline. Root/user coordination is required before any operation that rewrites or removes live game files.
2. **Completed 2026-10-14:** Opened Reset, verified the readable destination, prefilled choices, review counts, and current graph; applied once while Disabled; verified the marked config in the 188-file backup, baseline restoration, managed hashes, the unowned-file listing, Disabled persistence, and subsequent Healthy/Enabled state.
3. Keep uninstall as a separate destructive test. Before applying it, capture the fresh recursive listing. Afterward verify that the backed-up `nvngx_dlss.dll` is restored byte-for-byte, Lucent-owned additions and empty created directories are removed, and every unowned file and user path is unchanged. Preserve the external baseline if the app cleans its normal backup directory.
4. A maintainer must perform the coordinated game launch and gameplay attestation for the required profile, frame-generation, HDR, ReShade, and launcher choices. The agent will not launch the user’s game or alter the user’s setup for this step.
5. Stable promotion stays blocked until the gameplay attestation is recorded (applied Reset and uninstall evidence are now in this note).

## Acceptance status

| Item | Status | Evidence boundary |
| --- | --- | --- |
| Published Beta app/content | proved | release assets and local deployment record |
| Test suites and prior gameplay attestation | proved | release evidence |
| Existing setup deployed and healthy | proved | complete record, matching managed hashes, native Home state |
| Reset UI preflight and cancel path | proved | native settled UI observation; no Apply |
| Applied Reset and backup restoration | proved | coordinated run restored the baseline and preserved the marked config in the readable 188-file backup |
| Disabled persistence and re-enable | proved | `winmm.dll.disabled` remained in place through Reset, then native Enable restored the active entry |
| Repair of a drifted managed file | proved | one-file drift detected and repaired; tuned config comment preserved |
| Uninstall and preservation of user files | proved | 187 additions removed, original `nvngx_dlss.dll` restored, no unowned file changed; reinstalled and healthy |
| Fresh gameplay attestation for this lifecycle run | unchecked | requires maintainer/game launch |
| Stable promotion | unchecked | blocked by the gameplay attestation |
