# Ember palette

`palette.json` is the palette of OptiScaler-FFXIV's Ember menu style (`ext/menu/EmberPalette.h` in the fork) for Lucent's accent, `#FF640A`, and window opacity, `0.92`. It is not written by hand: the fork's `ember_palette` test dumps it. `scripts/ember-style.ts` renames its slots to ReShade's `[STYLE]` keys, so ReShade's menu carries exactly the colours and corner rounding OptiScaler's does. ReShade has no keys for padding or spacing, so only colours and rounding carry over; the font stays Segoe UI at 13 in both.

Built from fork commit `923120f0` (branch `ember-style`). To regenerate after the palette changes, from the fork checkout:

```powershell
$env:EMBER_PALETTE_JSON = 'C:\path\to\lucent\content\ember\palette.json'
pwsh -File tools\test.ps1 -Filter ember_palette
```

A candidate uses it through `reshadeStyle` in its `recipe.json` (see `scripts/prepare-fork-candidate.ts`): the base `ReShade.ini` is hash-checked, its `[STYLE]` is rewritten, and the result ships in place of the old file. Only new installs and Reset get it, because `ReShade.ini` is a `keep` config.
