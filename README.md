# Lucent

A Windows manager that deploys DLSS 5 (OptiScaler), ReShade, shaders and presets for XIV, and keeps them working across game patches. Design decisions: `docs/decisions.md`. Glossary: `CONTEXT.md`.

## Layout

- `src/core/`: the core. All domain logic, framework-free, with one observable state. It reaches the machine only through the Platform port (`src/core/platform.ts`).
- `src/platform/`: the port's implementations: `tauri.ts` (the real one, over the Rust primitives), `fake.ts` (in memory, for tests, the gallery and the browser) and `fixtures.ts` (fake machines).
- `src/ui/`: the React UI. It renders the core's state and calls its commands. The Ember design tokens live in `src/ui/styles/tokens.css`.
- `src-tauri/`: the Tauri 2 shell and the Rust primitives (`src/platform.rs`).
- `site/`: the static GitHub Pages download site. It shares the app's Ember tokens and bundled fonts; its build goes to `site-dist/`, separately from the app.

## Develop

Needs Node, Rust and the MSVC Build Tools.

```sh
npm install
npm run dev            # the UI in a browser, on the fake Platform: http://localhost:5173
                       #   ?machine=steam|xivlauncher|squareenix|none picks the fake machine
                       #   ?gallery opens the state gallery (← → to step through states)
npm run tauri dev      # the real app
npm test               # the core against the fake Platform (Vitest)
npm run test:rust      # the Rust primitives on a real temp folder (cargo test)
npm run typecheck
npx tauri build --no-bundle   # the portable exe, in src-tauri/target/release
```

Game-folder mutations share the guard in `src/core/gameAccess.ts`, including recovery. The UI
checks the DX11 process every second and restores actions when it closes. Only a denied
game-folder write probe requests UAC; the probe checks the command's files and existing parent
folders. A one-use resume file preserves the command, folder, setup choices and the player's data
context even when UAC uses another administrator account. Cancelling UAC keeps the current screen and files intact.
The core tests simulate both processes, and the Rust tests exercise a disposable folder with a
Windows ACL that denies file creation.

## Download site

```sh
npm run dev:site       # http://localhost:5174
npm run build:site     # static HTML, CSS, SVG and bundled fonts in site-dist/
npm run preview:site   # preview the production build at http://localhost:4174
```

The page needs no JavaScript, external fonts or third-party runtime requests. Check it at desktop and phone widths, including the SmartScreen instructions and keyboard navigation. Keep the upstream credits aligned with the app's Credits screen and `docs/decisions.md`.

In the repository's **Settings → Pages**, select **GitHub Actions** as the publishing source. `.github/workflows/pages.yml` builds the site on pull requests and deploys it on relevant pushes to `main` or a manual workflow run on `main`. Only `site-dist/` is uploaded. Relative asset URLs work at the project URL, `https://arnaudcouturier.github.io/lucent/`.

The download button uses `https://github.com/arnaudcouturier/lucent/releases/latest/download/Lucent.exe`. Publish stable app versions as `app-vX.Y.Z` with the asset named **Lucent.exe** and mark them as latest. Beta app versions must be pre-releases, and content versions must use `make_latest=false`, as specified in `docs/decisions.md`. Until the first stable app version is published, that download URL returns 404. The repository and its releases must be public before the public launch; this workflow does not change repository visibility.

## Release

Publish tested content with `npm run publish:content -- <publish.json> --dry-run`, then run the
same command without `--dry-run`. The [publishing guide](docs/publishing.md) describes inputs,
validation, 7-Zip, hash reuse and recovery. Content releases keep the app's Latest link intact.

Push an `app-vX.Y.Z` tag for Stable or `app-vX.Y.Z-beta.N` for Beta. GitHub Actions runs
the TypeScript and Rust tests, builds the portable Windows x64 app, and publishes `Lucent.exe`.
Stable releases are marked Latest; Beta releases are pre-releases. The
[release checklist](docs/release-checklist.md) covers version preparation, the RTX 4090 manual
checks, Microsoft false-positive submissions, and enabling SignPath after approval.
