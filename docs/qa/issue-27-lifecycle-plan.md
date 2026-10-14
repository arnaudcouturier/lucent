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
- The flow was backed out to Home. **Continue/Apply was not pressed.** This proves the preflight and cancel path only; it is not evidence that Reset rewrites files successfully.

The app record, configuration hashes, and timestamps were rechecked after cancellation and remain unchanged. No game process was launched, no uninstall was run, and no registry preference was changed.

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
2. Open Reset and verify the readable destination, prefilled choices, review counts, and current graph. If Reset is approved, apply once, then verify the backup contents, expected baseline configuration, all managed hashes, the unowned-file listing, and a subsequent Healthy/Enabled state.
3. Keep uninstall as a separate destructive test. Before applying it, capture the fresh recursive listing. Afterward verify that the backed-up `nvngx_dlss.dll` is restored byte-for-byte, Lucent-owned additions and empty created directories are removed, and every unowned file and user path is unchanged. Preserve the external baseline if the app cleans its normal backup directory.
4. A maintainer must perform the coordinated game launch and gameplay attestation for the required profile, frame-generation, HDR, ReShade, and launcher choices. The agent will not launch the user’s game or alter the user’s setup for this step.
5. Stable promotion stays blocked until the applied Reset and uninstall evidence, plus the gameplay attestation, are recorded.

## Acceptance status

| Item | Status | Evidence boundary |
| --- | --- | --- |
| Published Beta app/content | proved | release assets and local deployment record |
| Test suites and prior gameplay attestation | proved | release evidence |
| Existing setup deployed and healthy | proved | complete record, matching managed hashes, native Home state |
| Reset UI preflight and cancel path | proved | native settled UI observation; no Apply |
| Applied Reset and backup restoration | unchecked | requires coordinated live-file write |
| Uninstall and preservation of user files | unchecked | requires coordinated destructive action |
| Fresh gameplay attestation for this lifecycle run | unchecked | requires maintainer/game launch |
| Stable promotion | unchecked | blocked by the three items above |
