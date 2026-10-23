# Stable content candidate 2026.10.27

The first Stable content version: Beta content 2026.10.26 under a new id, with `channel` set to `stable` and `minAppVersion` set to `1.0.0`. Nothing about the payload changes. OptiScaler-FFXIV stays at `ffxiv-2026.10.23-d9b62110`, and the choices on the Graphics step, Streamline, the runtimes, ReShade, the Ember looks and the tiers are 2026.10.26 unchanged. The dry run uploads nothing: every file is already published, and the base `OptiScaler.ini` is byte for byte 2026.10.26's, so the release `content-2026.10.27` holds only the notes.

## Why a new version rather than editing a channel

A Stable content version cannot require a beta app (`assertStableNeedsStableApp`), and every Beta version requires `0.3.0-beta.N`. Promoting one in place would also have to lower its `minAppVersion`, which a player on an older Beta app would then be offered and could not run. So the Stable version is a new id that needs Lucent 1.0.0, published after the app, and the Beta versions stay as they are.

## Who gets it

- A player on the Stable channel with Lucent 1.0.0 is offered it on an RTX 20/30/40 card, whose tier is Stable. An RTX 50 card is offered the RTX 50 tier, which carries the community-verified label because the maintainer cannot test it (`docs/decisions.md`, "GPU tiers").
- Radeon and Other have no content in any version yet, so those cards still see "Stable content isn't published for this graphics card yet".
- A player on the Beta channel sees it as the newest version; Beta players on 1.0.0 or later who were on 2026.10.26 are announced it with its changelog, and the payload is the same.
- An older app (before 1.0.0) does not offer it, since the minimum app version is not met.

## Assemble and dry-run

The same inputs as 2026.10.23. From the repository root, in PowerShell:

```powershell
npx tsx scripts/prepare-fork-candidate.ts --base C:\LucentContent\candidate-2026.10.17\publish.json --recipe content\candidates\2026.10.27\recipe.json --fork-zip C:\LucentContent\downloads-fork-2026.10.23\OptiScaler-FFXIV-ffxiv-2026.10.23-d9b62110.zip --streamline-zip C:\LucentContent\downloads\streamline-sdk-v2.14.16.zip --nr-folder C:\LucentContent\nr-folder-2026.10.23 --tuned-ini C:\LucentContent\candidate-2026.10.21\sources\saved-ini\OptiScaler.ini --output C:\LucentContent\candidate-2026.10.27
npm run publish:content -- C:/LucentContent/candidate-2026.10.27/publish.json --dry-run
```
