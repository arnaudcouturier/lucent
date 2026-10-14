# The crystal (#22)

The Ember rail draws the original clustered spire and two shards orbiting it into a 248×214 canvas. The two precessing gold hoops were removed on 2026-10-13; the shards keep the larger hoop's tilted, precessing orbit. The geometry follows variant D on the `lucent-look-prototype` tag; it has no cup, prongs or zigzag ornament. Illustration materials live beside the renderer, while UI colours remain in the Ember tokens.

`crystalState` projects the core's `activity` into the spec's eight states. Disabled wins over every deployment status; otherwise a running repair, update or rollback wins over drift, then an update announcement, then healthy. The current production workflow still reports Scan. Future workflow commands advance `activity`; the dev gallery projects typed activities onto a real Scan core on the fake Platform without adding production fixture setters.

The canvas paints at most 30 times per second at rest, and up to 120 while filling or running repair/update/rollback/Scan, with no animation through React state. Paints are counted in display frames, not timed (`src/ui/crystal/pacing.ts`): a "33.3 ms since the last paint" threshold falls exactly on 2 frames at 60 Hz (4 at 120 Hz), so timestamp jitter alternated 33 and 50 ms steps in runs that drifted with the display clock, which read as the crystal jumping every half minute or so. A hitch advances the pose by at most one and a half steps. Independent accumulated phases let a speed change preserve the pose. The fill eases toward deployment progress with a 0.45 s time constant, so steps in progress glide. Disabled and reduced motion schedule no animation frames. Visibility and DOM focus pause the browser loop; Tauri's native focus listener also covers minimize and Alt-Tab. Resume starts from the saved pose without advancing through time spent paused. Media-query listeners handle changes to the system's reduced-motion preference while the app is open. The backing store is capped at 2× device pixel ratio.

The README banner and the site's still crystal (`site/crystal.svg`) are traced from this renderer by `npm run build:art`; run it after changing the crystal.

## Gallery and measurement

Run `npm run dev` and open `http://localhost:5173/?gallery=crystal-lit&crystal-perf`. The gallery includes all eight states, plus Profile/Review, Done/healthy, repair/update/rollback, and Disabled during repair. Deploying has a progress slider. **Still preview** exercises the same static rendering path as reduced motion, including a visible scan line and a fallen shard. It does not change the OS preference. The gallery is development-only.

`crystal-perf` adds a development-only draw counter and mean/p95 duration for the latest 60 draws. Durations cover JavaScript geometry, shading and canvas draw submission, excluding GPU/compositor work. They do not measure game frame times or total app CPU. Collection and the gallery are excluded from production builds.

Browser measurements on the maintainer's RTX 4090 machine, 2026-10-12, without FFXIV running:

| State | Latest 60 draws: mean | p95 |
| --- | ---: | ---: |
| Healthy | 0.53 ms | 0.80 ms |
| Update available | 0.53 ms | 0.80 ms |
| Repair running | 0.50 ms | 0.70 ms |

These are local development samples, not an in-game performance result. Canvas was selected up front to avoid continuously reconciling the prototype's SVG facets through React. Visual review covered all eight modes, the deployment endpoints, and the static reduced-motion path. The embedded browser kept both tabs reporting focus, so it could not establish a native focus/visibility result.

## Remaining native and in-game checks

The in-game acceptance criterion remains pending because `ffxiv_dx11.exe` was not running during implementation. [All Worlds Maintenance](https://na.finalfantasyxiv.com/lodestone/news/detail/24dff898070f0d2a8bafb3b1a862e344abecc9b5) prevents an in-game check on October 12: the announced window is October 12, 06:00 through October 13, 06:00 Toronto time (EDT), subject to change. Do not close #22 on the strength of the browser samples alone.

1. With the real game in the same repeatable scene, compare Lucent closed against Lucent open and unfocused. Capture app CPU/GPU and game frame times for at least 60 seconds each. The canvas draw count should stop while Lucent is unfocused or minimized.
2. Repeat with Lucent focused beside the game: Healthy, Update available and Repair running. Capture draw mean/p95 along with process CPU/GPU and game frame times; draw duration alone excludes composition cost.
3. Alt-Tab and minimize/restore Lucent. Confirm its pose stays fixed while paused and resumes gently; repeat focus changes several times to catch duplicate loops.
4. Toggle the OS reduced-motion preference while Lucent is open. Confirm rotation, precession, float, pulse, scan and shard animation stop. Scan retains a stationary line, drift retains a fallen shard, and status/progress changes still repaint.
5. Confirm Disabled stays frozen through repair, update and rollback, and normal motion returns when enabled. Check a high DPI monitor and moving between displays.
6. If game frame times or app CPU/GPU regress materially, profile the canvas/compositor before reducing draw frequency or moving more work to cached geometry. Record the scene, sample duration and before/after values here.
