# Beta content candidate 2026.10.17

Replaces `winmm.dll` with the maintainer's rebuild that fixes the FPS counter overlay and other overlay bugs. Everything else is 2026.10.16 unchanged, so publishing uploaded one file.

- Replacement: `C:\Users\arnaudc\workspace\OptiScaler_FFXIV\builds\winmm-ffxiv-overlayfix.dll`, 27,097,600 bytes, SHA-256 `c7583720029d9830b53976a9fe29bb3492b829dda40f41adb4ec2a5a6dba1af0`. Its version string ends `36c53a15) (20261014_182444)`; the previous community build reported `36c53a15-community-preview-depth-jitter-20261013) (20261008)`.
- The derive script refuses the file if its SHA-256 differs from the one in `recipe.json`, then makes it the last source, so it wins the `winmm.dll` path.
- **Source pin:** the component `OptiScaler winmm.dll` still links to commit `36c53a15` of SirenBrink's repository. This build is that commit plus uncommitted changes in the maintainer's fork, so the link does not yet match the binary exactly. Commit and tag the fork, then update the component's `source` to that tag in a later content version.

```powershell
npx tsx scripts/derive-controls-candidate.ts --base C:\LucentContent\candidate-2026.10.16\publish.json --recipe content\candidates\2026.10.17\recipe.json --output C:\LucentContent\candidate-2026.10.17
npm run publish:content -- C:/LucentContent/candidate-2026.10.17/publish.json --dry-run
npm run publish:content -- C:/LucentContent/candidate-2026.10.17/publish.json
```
