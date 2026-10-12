# Lucent

A Windows manager that deploys DLSS 5 (OptiScaler), ReShade, shaders and presets for XIV, and keeps them working across game patches. Design decisions: `docs/decisions.md`. Glossary: `CONTEXT.md`.

## Layout

- `src/core/`: the core. All domain logic, framework-free, with one observable state. It reaches the machine only through the Platform port (`src/core/platform.ts`).
- `src/platform/`: the port's implementations: `tauri.ts` (the real one, over the Rust primitives), `fake.ts` (in memory, for tests, the gallery and the browser) and `fixtures.ts` (fake machines).
- `src/ui/`: the React UI. It renders the core's state and calls its commands. The Ember design tokens live in `src/ui/styles/tokens.css`.
- `src-tauri/`: the Tauri 2 shell and the Rust primitives (`src/platform.rs`).

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

## Release

Push an `app-vX.Y.Z` tag for Stable or `app-vX.Y.Z-beta.N` for Beta. GitHub Actions runs
the TypeScript and Rust tests, builds the portable Windows x64 app, and publishes `Lucent.exe`.
Stable releases are marked Latest; Beta releases are pre-releases. The
[release checklist](docs/release-checklist.md) covers version preparation, the RTX 4090 manual
checks, Microsoft false-positive submissions, and enabling SignPath after approval.
