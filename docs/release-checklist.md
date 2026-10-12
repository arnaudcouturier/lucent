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
- [ ] Commit the version changes and release notes before tagging. Beta promotion requires
  a new Stable version commit and tag; changing a Beta release's flags does not rebuild its exe.

## Manual checks on the RTX 4090

Use the real game on the maintainer's RTX 4090 machine. Keep a recursive SHA-256 listing of
the vanilla game folder's relative file paths and bytes before the first deployment; keep
the listing outside the game folder. Compare against it after uninstall, accounting separately
for files the game itself generates. Use two real content versions for the update checks.

- [ ] Deploy from a vanilla game folder.
- [ ] In game, confirm Insert opens OptiScaler, Home opens ReShade, and Neural Rendering is active.
- [ ] With the game closed, replace a deployed file to simulate a game patch. Reopen Lucent,
  confirm drift, choose Repair, and confirm a healthy deployment and working game.
- [ ] Turn Enabled off. Confirm the Disabled deployment runs the game as vanilla.
- [ ] Update and roll back between two real content versions; confirm the game works after each.
- [ ] Uninstall and compare the game folder against the pre-deployment hash listing.
- [ ] Check the window chrome on Windows 11 and in a Windows 10 22H2 x64 VM: dragging,
  minimize, close, fixed size, shadow and rounded corners where supported.

## Publish and verify

Pushing an app tag publishes immediately after the automated checks and optional signing
succeed. Finish the candidate checks before pushing it. The workflow runs on GitHub-hosted
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
  Unauthenticated downloads become available when the private repo is made public at launch.
- [ ] When signing is enabled, confirm `Get-AuthenticodeSignature .\Lucent.exe` reports `Valid`
  and the expected publisher. While #25 is pending, record that the exe is unsigned.
- [ ] Submit the **published exe** to
  [Microsoft Security Intelligence](https://www.microsoft.com/en-us/wdsi/filesubmission)
  as a **Software developer** for false-positive analysis. Record its SHA-256, submission ID,
  any detection name and Microsoft's result with the release checks. If the file is flagged,
  report it as an incorrect detection and follow up on the result. Never add Defender exclusions.
- [ ] Review the generated release notes: describe the shipped features, known limitations
  and signing status, and link the manual check results.

## Enable SignPath after #25

Signing is inactive while `SIGNPATH_ENABLED` is absent or not `true`. Complete
[#25](https://github.com/arnaudcouturier/lucent/issues/25) before enabling it.

1. Connect the repository to the approved SignPath Foundation project and allow its GitHub
   integration to read build artifacts. Use GitHub-hosted runners, as required by
   [SignPath's GitHub integration](https://docs.signpath.io/trusted-build-systems/github).
2. Create an artifact configuration with slug `portable-exe` using
   [`.signpath/portable-exe.xml`](../.signpath/portable-exe.xml). The uploaded artifact is a ZIP
   with `Lucent.exe` at its root; the configuration signs that exe with Authenticode.
3. Store `SIGNPATH_API_TOKEN` as a repository Actions secret with submitter permission for
   the project's signing policy. Set these repository Actions variables to the approved values:

   | Variable | Value |
   | --- | --- |
   | `SIGNPATH_ORGANIZATION_ID` | SignPath organization ID |
   | `SIGNPATH_PROJECT_SLUG` | Project slug |
   | `SIGNPATH_SIGNING_POLICY_SLUG` | Policy that uses the approved production signing certificate |
   | `SIGNPATH_ENABLED` | `true`, set last |

4. Run the next Beta release through the workflow and verify the signed release asset before
   shipping Stable. The workflow waits for signing, verifies the signature, and publishes the
   returned exe. A signing failure stops publication; it never falls back to the unsigned exe.
