# Lucent

Lucent applies a curated stack of third-party graphics mods (upscaling, DLSS 5 Neural Rendering, ReShade) to a player's FFXIV game folder, and keeps it working across game patches and content updates.

## Language

### The player's machine

**Game folder**:
The FFXIV directory that holds the game executable; the place a deployment is applied to.
_Avoid_: installation, install dir, game path

**Tier**:
The class of GPU a deployment targets (RTX 50, RTX 30/40, RTX 20, Radeon, Other), which decides the recipe.
_Avoid_: GPU profile, hardware profile

**Tier status**:
How proven a tier is: Stable, Experimental or Community-verified.
_Avoid_: beta (that word belongs to channels)

**Scan**:
The first-run detection of the game folder, GPU, launcher and any existing setup.
_Avoid_: detection, health check

**Existing setup**:
Mod files that Lucent did not deploy and that would conflict with a deployment, such as another ReShade, GShade leftovers, another OptiScaler or GPosingway.
_Avoid_: foreign mod, conflict

**User file**:
A file in the game folder that belongs to the user rather than to Lucent, such as their own presets, shaders or paid shaders. Lucent never modifies or removes one.
_Avoid_: custom file, foreign file

**Vanilla**:
The state of a game folder with no deployment applied.
_Avoid_: using "vanilla" for a disabled deployment

**Self-install**:
Lucent copying itself onto the player's machine so it can be launched like any installed app.
_Avoid_: install (that word is ambiguous here)

### Content

**Component**:
One piece of third-party software Lucent deploys: an OptiScaler build, a Neural Rendering runtime, ReShade, a ReShade add-on, a shader pack or a preset pack.
_Avoid_: package, mod, dependency

**Upstream**:
The original author or source of a component, such as SirenBrink, ShortFuse or ipsusu.

**Upstream round**:
SirenBrink's name for its own releases ("ROUND 5"). Used only when talking about upstream.
_Avoid_: calling a content version a "round"

**Manifest**:
The published document that describes every content version, tier, recipe and performance profile Lucent can deploy.
_Avoid_: catalog, index, config

**Content version**:
A dated, immutable, tested set of components and recipes, such as 2026.10.12.
_Avoid_: round, bundle, payload, release

**App version**:
A version of Lucent itself, released independently of content versions.

**Recipe**:
The ordered steps that turn a vanilla game folder into a deployment for one tier.
_Avoid_: script, install plan

**Step**:
One declarative operation in a recipe: copy, rename, set an ini key, or delete. A deployment over an existing setup also carries its presets over: a copy that becomes a user file once the deployment completes.
_Avoid_: action, command, op

**User change**:
A config setting whose value on disk differs from what Lucent last wrote. It survives an update unless the new content version changes the same setting or resets it.
_Avoid_: managed key, override, tweak

**Reset key**:
A config setting that a content version forces back to its shipped value, overriding any user change.
_Avoid_: forced key, breaking key

**Performance profile**:
One of Fidelity, Balanced or Performance: a named set of config setting values that the user picks.
_Avoid_: preset (that word belongs to ReShade), quality mode

**Custom**:
The state of a performance profile after a user change to one of its settings.
_Avoid_: modified, manual

**Preset**:
A ReShade preset file that defines a visual look. Lucent installs all of them and activates none.
_Avoid_: profile, look, theme

**Publish**:
The maintainer's act of turning a tested folder into a new content version in the manifest.
_Avoid_: release (ambiguous), upload

### Deployment

**Deployment**:
Everything Lucent has applied to one game folder, as recorded in its journal.
_Avoid_: install, mod install, setup

**Journal**:
The record of every step applied to a game folder, used to undo them exactly.
_Avoid_: log, history

**Backup**:
The original copy of a file that a step overwrote or removed.

**Health check**:
A comparison of the game folder against what the deployment should be.
_Avoid_: verify, scan

**Drift**:
Any difference a health check finds, such as a game patch replacing a deployed file.
_Avoid_: broken, corruption

**Repair**:
Re-applying the deployment so that no drift remains.
_Avoid_: fix, reinstall

**Disabled**:
The state of a deployment whose files are present but inactive, so the game runs as if vanilla. It persists through repair, update and profile changes.
_Avoid_: vanilla mode, paused, off

**Uninstall**:
Undoing a deployment from its journal, leaving a vanilla game folder. An existing setup comes back as it was; its carried-over presets stay as user files.
_Avoid_: remove, clean up

**Recovery**:
Undoing an unfinished deployment from its journal after a failure or a crash, so the game folder is as it was before. It runs before anything else at startup.
_Avoid_: rollback (that word belongs to updates), revert

### Updates

**Channel**:
Stable or Beta: which app versions and content versions are offered to the user.
_Avoid_: track, ring

**Update**:
Moving to a newer content version or app version, always started by the user.
_Avoid_: upgrade, sync

**Pin**:
Staying on a specific version. Newer versions are still announced but never applied without the user's request.
_Avoid_: lock, freeze

**Skip**:
Marking a version as unwanted so it is no longer announced. It can still be applied manually.
_Avoid_: ignore, dismiss

**Rollback**:
Returning to a previously cached content version. It pins that version and skips the one left behind.
_Avoid_: downgrade, revert
