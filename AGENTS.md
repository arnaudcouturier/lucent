# Lucent

Windows manager for FFXIV graphics mods. It manages two features so far: DLSS 5 (OptiScaler) and ReShade (with shaders and presets), and is built to take on more.
Design decisions: `docs/decisions.md`.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `arnaudcouturier/lucent`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root (`docs/adr/` is created when the first ADR is written). See `docs/agents/domain.md`.
