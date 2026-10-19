# Lucent

Lucent is a manager for a player's FFXIV graphics mods. It deploys a tested set of third-party mods into the game folder, grouped as features (DLSS 5 through OptiScaler, and ReShade), and keeps them working across game patches and content updates. Once deployed, the config files are the player's: they tune them in OptiScaler's and ReShade's overlays, not in Lucent. It also offers a Starter set of Dalamud plugins and Penumbra mods, which it places or links to once and then leaves alone.

## Language

### The player's machine

**Game folder**:
The FFXIV directory that holds the game executable; the place a deployment is applied to.
_Avoid_: installation, install dir, game path

**Tier**:
The class of GPU a deployment targets (RTX 50, RTX 20/30/40, Radeon, Other), which decides the recipe.
_Avoid_: GPU profile, hardware profile

**Tier status**:
How proven a tier is: Stable, Experimental or Community-verified. An option can be Experimental too, such as a frame generation multiplier that needs an unlock.
_Avoid_: beta (that word belongs to channels)

**Scan**:
The first-run detection of the game folder, GPU, launcher and any existing setup.
_Avoid_: detection, health check

**Existing setup**:
Mod files that Lucent did not deploy and that would conflict with a deployment, such as another ReShade, GShade leftovers, another OptiScaler or GPosingway.
_Avoid_: foreign mod, conflict

**User file**:
A file in the game folder that belongs to the user rather than to Lucent, such as their own presets, shaders or paid shaders. Lucent never modifies or removes one, except where a first deployment writes the same path: Scan lists it, and it is backed up first.
_Avoid_: custom file, foreign file

**Vanilla**:
The state of a game folder with no deployment applied.
_Avoid_: using "vanilla" for a disabled deployment

**Self-install**:
Lucent copying itself onto the player's machine so it can be launched like any installed app.
_Avoid_: install (that word is ambiguous here)

**App uninstall**:
Removing Lucent itself from Settings → Apps: optionally an uninstall of every deployment, then Lucent's XIVLauncher add-ons, the shortcut, the Settings → Apps entry, the data folder and the exe.
_Avoid_: using "uninstall" alone for it (that word belongs to deployments)

### Content

**Feature**:
Something Lucent manages for the player, made of one or more components: **DLSS 5** (OptiScaler with a Neural Rendering runtime, or FSR on Radeon) and **ReShade** (ReShade, its add-on, shaders and presets). Lucent is meant to take on more features over time.
_Avoid_: module, plugin, mod (for the grouping; a Dalamud plugin and a Penumbra mod are the two kinds of item in the Starter set, which is not a Feature)

**Component**:
One piece of third-party software Lucent deploys: an OptiScaler build, a Neural Rendering runtime, ReShade, a ReShade add-on, a shader pack or a preset pack.
_Avoid_: package, mod, dependency

**Upstream**:
The original author or source of a component, such as OptiScaler-FFXIV, ShortFuse or ipsusu.

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

**Config file**:
A deployed file that OptiScaler or ReShade reads its settings from, such as `OptiScaler.ini` or `ReShade.ini`. Lucent writes it when it deploys the baseline; from then on it belongs to the player. A health check only checks that it exists, and an update touches it only as its config update rule says.
_Avoid_: managed config, settings file

**Config update rule**:
What a content version does to one config file on update: **keep** (the default: leave it alone), **add missing keys** (write the keys absent on disk with the baseline's value, leaving every other key as the player has it) or **replace** (back it up, then write the baseline from the first-install choices). The changelog announces add missing keys and replace.
_Avoid_: merge, reset key

**First-install choices**:
What the player picks on the screen shown before the baseline is deployed: the performance profile, the frame generation mode, the HDR mode, Include ReShade and Add to Start menu. Lucent writes them into the config files once and keeps them only so Reset can offer them again.
_Avoid_: settings, configurator

**Performance profile**:
One of Ultra, Fidelity, Balanced or Performance: a named set of config setting values, picked among the first-install choices and written once. Some of its values depend on the resolution of the screen XIV runs on.
_Avoid_: preset (that word belongs to ReShade), quality mode

**Frame generation mode**:
Off, a fixed multiplier (2× to 6×) or Dynamic: how many frames OptiScaler generates, picked among the first-install choices, separately from the performance profile.
_Avoid_: FG preset, MFG level

**Frame cap**:
The highest frame rate XIV presents, generated frames included, just below the refresh rate. Lucent computes it from XIV's screen when it writes the config files, and never again.
_Avoid_: FPS limit, frame limiter

**HDR mode**:
Off, HDR or Scene HDR: how OptiScaler presents XIV on an HDR monitor, picked among the first-install choices.
_Avoid_: OptiHDR (upstream's name)

**Preset**:
A ReShade preset file that defines a visual look. Lucent installs all of them and activates none.
_Avoid_: profile, look, theme

**Publish**:
The maintainer's act of turning a tested folder into a new content version in the manifest.
_Avoid_: release (ambiguous), upload

### Starter set

**Starter set**:
The curated list of Dalamud plugins and Penumbra mods that the Mods section offers, defined in the manifest by the maintainer. Lucent seeds its plugins or links to its mods once and then forgets them: it has no deployment, journal or health check. Its items are not components.
_Avoid_: default set (Penumbra has a Default collection and Dalamud a default profile), bundle, pack

**Dalamud plugin**:
A plugin that Dalamud loads into the game, kept under `%APPDATA%\XIVLauncher\installedPlugins`. Lucent can place the Starter set's plugins; from then on Dalamud owns them.
_Avoid_: add-on (that word belongs to XIVLauncher add-ons and ReShade add-ons), mod

**Plugin repo**:
A published list of Dalamud plugins and where to download them (`repo.json`): the official one, or a third-party one the player has in Dalamud's `ThirdRepoList`. Lucent adds third-party repos only after the player has read its consent panel.
_Avoid_: repository (that word belongs to Git)

**Seed**:
To place a Dalamud plugin once, fetched from its repo's current release, recording nothing to check or repair afterwards.
_Avoid_: install and deploy (a deployment is journaled and health-checked)

**Penumbra mod**:
A folder in Penumbra's `ModDirectory` that changes how the game looks or plays. Lucent lists some in the Starter set and links to where to get them; it never downloads, places or edits one, and it never writes `ModDirectory`.
_Avoid_: component, plugin

### Deployment

**Deployment**:
Everything Lucent has applied to one game folder, as recorded in its journal.
_Avoid_: install, mod install, setup

**Journal**:
The record of every step applied to a game folder, used to undo them exactly.
_Avoid_: log, history

**Backup**:
The original copy of a file that a step overwrote or removed.

**Readable backup**:
A copy of every file from before a first deployment, kept under its own path in `Lucent\Backups\<game folder name>` so the player can find it. Uninstall never depends on it.
_Avoid_: backup folder (the journal's backups are elsewhere)

**Health check**:
A comparison of the game folder against what the deployment should be: every deployed file by hash, except config files, which only have to exist. The player starts a full one with the main screen's **Scan** button; that label is the only player-facing use of "scan" for it.
_Avoid_: verify, scan

**Drift**:
Any difference a health check finds, such as a game patch replacing a deployed file or a missing config file. A config file's contents are never drift.
_Avoid_: broken, corruption

**Repair**:
Putting back the drifted files so that no drift remains. It writes a config file only when it is missing.
_Avoid_: fix, reinstall

**Reset**:
Deploying the baseline again as a first install would: the first-install choices are offered again, prefilled, then every file is rewritten, config files included, after backing up the player's ones. The player starts it with **Reset setup…** in Settings.
_Avoid_: restore (that word belongs to uninstall), reconfigure, restore baseline

**Tier switch**:
A Reset for the tier the current GPU matches, started by the user after a graphics card change: the first-install choices are offered with the new tier's options. Disabled stays.
_Avoid_: re-tier, migrate

**Disabled**:
The state of a deployment whose files are present but inactive, so the game runs as if vanilla. It persists through repair, update and Reset.
_Avoid_: vanilla mode, paused, off

**Uninstall**:
Undoing a deployment from its journal, leaving a vanilla game folder. An existing setup comes back as it was; its carried-over presets stay as user files.
_Avoid_: remove, clean up

**Activity log**:
Lucent's own line-by-line account of what it found and did, kept in `lucent.log` in its data folder and shown in the Logs section. Nothing is undone from it.
_Avoid_: journal (that is the undo record), history

**Tool log**:
A log one of the deployed components writes in the game folder while XIV runs, such as `ReShade.log`. Uninstall removes it.
_Avoid_: mod log

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
