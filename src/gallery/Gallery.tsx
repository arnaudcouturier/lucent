// DEV ONLY: the state gallery. Renders each screen state from a real core on the fake Platform, so the
// look can be reviewed by eye without touching a game folder. Open with `?gallery` (or `?gallery=<state>`).
// The bar is deliberately styled unlike Lucent, so it reads as tooling.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createCore, type Activity, type Core } from '../core/core'
import { crystalState } from '../core/crystal'
import { createFakePlatform, FAKE_EXE_PATH, type Machine } from '../platform/fake'
import { MACHINES, frameGenerationContentHost, graphicsCard, manifestHost, machine, nextContentHost, steam, steamGameFolder, vanillaGame, xivLauncher } from '../platform/fixtures'
import { App } from '../ui/App'
import { UninstallWindow } from '../ui/UninstallWindow'
import { CoreContext } from '../ui/useCore'
import { Screen, Window } from '../ui/Window'
import { SettingsScreen } from '../ui/MainScreens'
import { dataPaths, readDeployment, type DeploymentPhase } from '../core/deployment'
import { PlatformError } from '../core/platform'
import { APP_EXE_TEXT, APP_RELEASE } from '../platform/appUpdateFixture'
import { APP_RELEASES_URL } from '../core/appUpdate'
import { BETA_CONTENT, BETA_MANIFEST, NEXT_CONTENT, NEXT_MANIFEST } from '../platform/contentFixture'
import { MANIFEST_URL } from '../core/manifest'
import './gallery.css'

/** An app release above the running version, so the update states show: dev runs as package.json's version, which the shared 0.2.0 fixture is older than. */
const GALLERY_APP_VERSION = (() => {
  const [core, beta] = __APP_VERSION__.split('-beta.')
  if (beta !== undefined) return core
  const [major, minor, patch] = core.split('.').map(Number)
  return [major, minor, patch + 1].join('.')
})()
const GALLERY_APP_EXE_URL = 'https://github.com/arnaudcouturier/lucent/releases/download/app-v' + GALLERY_APP_VERSION + '/Lucent.exe'
const appReleaseHost = (): Machine => ({
  files: { [FAKE_EXE_PATH]: 'Lucent 0.1.0' },
  remoteText: {
    [APP_RELEASES_URL]: JSON.stringify([{ ...APP_RELEASE, tag_name: 'app-v' + GALLERY_APP_VERSION, assets: [{ ...APP_RELEASE.assets[0], browser_download_url: GALLERY_APP_EXE_URL }] }]),
    [GALLERY_APP_EXE_URL]: APP_EXE_TEXT,
  },
})

const AN_UPDATE = { version: '2026.11.02', changelog: ['OptiScaler 2 with sharper Neural Rendering.', 'Drops the example shader.'], downloadSize: 160 * 1024 ** 2 }
const LONG_LIBRARY = 'E:\\Games\\Libraries\\Steam Library (fast NVMe drive)'

const scanned = (m: Machine) => async () => {
  const core = createCore(createFakePlatform(m))
  await core.scan()
  return core
}

interface GalleryState {
  key: string
  label: string
  setup: () => Promise<Core>
  preview?: { activity: Activity; description: string }
  /** The toolbar shows the resolved display facts for the screen gallery states. */
  showScreenFacts?: boolean
  /** The window Settings → Apps opens, instead of the main one. */
  uninstallWindow?: boolean
  /** Shows the Settings screen directly for update-card review. */
  settingsPreview?: boolean
  /** Opens Reset setup's confirmation dialog on the Settings preview. */
  openReset?: boolean
}

const crystalPreview = (key: string, label: string, activity: Activity, description: string): GalleryState => ({
  key: `crystal-${key}`, label: `Crystal · ${label}`, setup: scanned(MACHINES.steam), preview: { activity, description },
})
const deployment = (patch: Partial<Extract<Activity, { kind: 'deployment' }>> = {}): Activity => ({
  kind: 'deployment', enabled: true, drift: null, update: null, tierChange: null, operation: null, ...patch,
})

const workflow = (stage: 'review' | 'done' | 'healthy', m = MACHINES.steam, includeReShade = true) => async () => {
  const core = await scanned(m)()
  await core.review(includeReShade)
  if (stage !== 'review') await core.deploy()
  if (stage === 'healthy') core.finish()
  return core
}

const recommendedProfileHome = (gpu: string) => async () => {
  const core = await scanned(machine(MACHINES.screen144Hdr, frameGenerationContentHost(), graphicsCard(gpu)))()
  await core.continueSetup()
  return core
}
/** The first-install choices, with the player's picks made on the way; later stages carry on from there. */
const choicesStep = (m: Machine, gpu: Machine, stage: 'profile' | 'review' | 'done' = 'profile', pick: (core: Core) => void = () => {}) => async () => {
  const core = await scanned(machine(m, gpu))()
  await core.continueSetup()
  pick(core)
  if (stage !== 'profile') await core.review()
  if (stage === 'done') await core.deploy()
  return core
}
const nrPicks = (core: Core) => core.setNeuralRendering({ preset: 'dlaa' })
const nrEverything = (core: Core) => {
  core.setMfgUnlocked(true)
  core.selectFrameGenerationMode('4x')
  core.setNeuralRendering({ preset: 'ultra-quality', passes: 3, scale: 125, spatialCompression: true, residualFg: true })
}
const resetFlow = (stage: 'confirmation' | 'profile') => async () => {
  const core = await workflow('healthy')()
  if (stage === 'profile') await core.resetSetup()
  return core
}
const experimentalPicks = (core: Core) => {
  core.selectFrameGenerationMode('4x')
  core.selectHdrMode('scene-hdr')
}
const multipleLaunchers = async () => {
  const platform = createFakePlatform(machine(MACHINES.steam, xivLauncher(steamGameFolder('D:\\SteamLibrary'))))
  await platform.writeText(`${await platform.envFolder('LocalAppData')}\\XIVLauncher\\current\\XIVLauncher.exe`, 'XIVLauncher')
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  return core
}
const installStage = (phase: DeploymentPhase) => async () => {
  // Only a folder with files to replace has a Backing up stage.
  const platform = createFakePlatform(phase === 'backing-up' ? MACHINES.existing : MACHINES.steam)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await new Promise<void>((resolve) => {
    const unsubscribe = core.subscribe(() => {
      if (core.getState().deploymentProgress?.phase === phase) {
        platform.hold()
        unsubscribe()
        resolve()
      }
    })
    void core.deploy()
  })
  return core
}

const failedDeployment = async () => {
  const platform = createFakePlatform(MACHINES.steam)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  platform.downloadFile = async () => { throw new PlatformError('network', 'Connection lost') }
  await core.deploy()
  return core
}
const recoveredDeployment = (blocked = false) => async () => {
  const platform = createFakePlatform(MACHINES.steam)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  const folder = core.getState().gameFolder
  if (folder.status !== 'found') throw new Error('Gallery game folder missing')
  const record = (await readDeployment(platform, folder.path))!
  record.status = 'applying'
  await platform.writeText((await dataPaths(platform, folder.path)).record, JSON.stringify(record))
  if (blocked) platform.isGameRunning = async () => true
  const reopened = createCore(platform)
  await reopened.scan()
  return reopened
}

/** A game patch replaces OptiScaler's proxy DLL, optionally holding the repair midway. */
const patched = (stage: 'drift' | 'repairing') => async () => {
  const platform = createFakePlatform(MACHINES.steam)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  const folder = core.getState().gameFolder
  if (folder.status !== 'found') throw new Error('Gallery game folder missing')
  await platform.writeText(`${folder.path}\\game\\winmm.dll`, 'Patched')
  await platform.writeText(`${folder.path}\\game\\ffxivgame.ver`, '2026.10.20.0000.0000')
  const reopened = createCore(platform)
  await reopened.scan()
  if (stage === 'repairing') await new Promise<void>((resolve) => {
    const unsubscribe = reopened.subscribe(() => {
      if (reopened.getState().deploymentProgress?.phase === 'applying') { platform.hold(); unsubscribe(); resolve() }
    })
    void reopened.repair()
  })
  return reopened
}

/** Drift no longer hides a pending update outright: both show, drift as the primary card, the app and
    content updates as slim secondary rows beneath it. */
const driftWithUpdates = async () => {
  const m = machine(MACHINES.steam, { remoteText: { [APP_RELEASES_URL]: '[]' } })
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  const folder = core.getState().gameFolder
  if (folder.status !== 'found') throw new Error('Gallery game folder missing')
  await platform.writeText(`${folder.path}\\game\\winmm.dll`, 'Patched')
  await platform.writeText(`${folder.path}\\game\\ffxivgame.ver`, '2026.10.20.0000.0000')
  Object.assign(m.remoteText!, appReleaseHost().remoteText)
  Object.assign(m.remoteText!, nextContentHost().remoteText)
  const reopened = createCore(platform)
  await reopened.scan()
  return reopened
}

/** The next content version is published after a deployment, optionally holding the update midway. */
const updateAvailable = (stage: 'update' | 'updating') => async () => {
  const m = machine(MACHINES.steam)
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  Object.assign(m.remoteText!, nextContentHost().remoteText)
  const reopened = createCore(platform)
  await reopened.scan()
  if (stage === 'updating') await new Promise<void>((resolve) => {
    const unsubscribe = reopened.subscribe(() => {
      if (reopened.getState().deploymentProgress?.phase === 'applying') { platform.hold(); unsubscribe(); resolve() }
    })
    void reopened.update()
  })
  return reopened
}

/** The Settings update card across its quiet, current, available and failed check states. */
const updateCheckPreview = (stage: 'checking' | 'current' | 'app' | 'content' | 'both' | 'failed') => async () => {
  const m = machine(MACHINES.steam, { remoteText: { [APP_RELEASES_URL]: '[]' } })
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()

  if (stage === 'checking') {
    const fetchText = platform.fetchText.bind(platform)
    platform.fetchText = async (url) => url === MANIFEST_URL ? new Promise<string>(() => {}) : fetchText(url)
    void core.checkForUpdates()
    return core
  }
  if (stage === 'app' || stage === 'both') Object.assign(m.remoteText!, appReleaseHost().remoteText)
  if (stage === 'content' || stage === 'both') Object.assign(m.remoteText!, nextContentHost().remoteText)
  if (stage === 'failed') {
    delete m.remoteText![MANIFEST_URL]
    delete m.remoteText![APP_RELEASES_URL]
  }
  await core.checkForUpdates()
  return core
}

/** The player swaps their graphics card after deploying. */
const newGraphicsCard = async () => {
  const m = machine(MACHINES.steam)
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  m.gpus = graphicsCard('AMD Radeon RX 7900 XTX', 0x1002).gpus
  const reopened = createCore(platform)
  await reopened.scan()
  return reopened
}

/** The game folder is emptied or moved after deploying. */
const missingGameFolder = async () => {
  const platform = createFakePlatform(MACHINES.steam)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  const folder = core.getState().gameFolder
  if (folder.status !== 'found') throw new Error('Gallery game folder missing')
  for (const file of await platform.listFiles(folder.path)) await platform.removeFile(`${folder.path}\\${file}`)
  const reopened = createCore(platform)
  await reopened.scan()
  return reopened
}

const versionHistory = async () => {
  const m = machine(MACHINES.steam)
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  Object.assign(m.remoteText!, nextContentHost().remoteText)
  let reopened = createCore(platform)
  await reopened.scan()
  await reopened.update()
  const third = { ...NEXT_CONTENT, id: '2026.11.20', changelog: ['Neural Rendering refinements.'] }
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...NEXT_MANIFEST, versions: [...NEXT_MANIFEST.versions, third] })
  reopened = createCore(platform)
  await reopened.scan()
  await reopened.update()
  const fourth = { ...NEXT_CONTENT, id: '2026.12.01', changelog: ['A new content version you can apply later.'] }
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...NEXT_MANIFEST, versions: [...NEXT_MANIFEST.versions, third, fourth] })
  reopened = createCore(platform)
  await reopened.scan()
  await reopened.skipUpdate()
  return reopened
}

const knownBrokenContent = async () => {
  const m = machine(MACHINES.steam)
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  const folder = core.getState().gameFolder
  if (folder.status !== 'found') throw new Error('Gallery game folder missing')
  Object.assign(m.remoteText!, nextContentHost().remoteText)
  let reopened = createCore(platform)
  await reopened.scan()
  await reopened.update()
  // The caution is for pinned players, so roll back to the known-broken version first.
  const [first, ...rest] = NEXT_MANIFEST.versions
  await platform.writeText(`${folder.path}\\game\\ffxivgame.ver`, '2026.10.20.0000.0000')
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...NEXT_MANIFEST, versions: [{ ...first, knownBrokenGameVersions: ['2026.10.20.0000.0000'] }, ...rest] })
  reopened = createCore(platform)
  await reopened.scan()
  await reopened.applyVersion(first.id)
  return reopened
}

/** A Stable deployment whose player turns on the Beta channel: the Beta content version and the app pre-release appear. */
const betaChannel = async () => {
  const core = createCore(createFakePlatform(machine(MACHINES.beta)))
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  await core.setChannel('beta')
  return core
}

const appUpdateAvailable = (stage: 'app-update' | 'app-updating' | 'app-update-failed') => async () => {
  const m = machine(MACHINES.steam, appReleaseHost())
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  if (stage === 'app-updating') { platform.hold(); void core.updateApp() }
  if (stage === 'app-update-failed') {
    m.remoteText![GALLERY_APP_EXE_URL] = 'Corrupt download'
    await core.updateApp()
  }
  return core
}

/** Lucent deployed and in the Start menu, then opened from Settings → Apps. */
const appUninstall = (stage: 'confirm' | 'game-running' | 'done' | 'backups' | 'elsewhere') => async () => {
  // An old ReShade setup in the game folder gives a deployment copies of the files it replaced to keep.
  const m = machine(stage === 'backups' ? MACHINES.existing : MACHINES.steam)
  const platform = createFakePlatform(m)
  const deployed = createCore(platform)
  await deployed.scan()
  await deployed.review()
  await deployed.deploy()
  // A vanilla uninstall leaves the originals out and keeps their copies; App uninstall then says where they are.
  if (stage === 'backups') {
    deployed.finish()
    await deployed.uninstall(false)
  }
  const exe = `${await platform.envFolder('LocalAppData')}\\Lucent\\Lucent.exe`
  m.exePath = exe
  m.headlessMode = 'uninstall'
  if (stage === 'game-running') m.gameRunning = true
  if (stage === 'elsewhere') m.processes = [exe]
  const core = createCore(platform)
  await core.openAppUninstall()
  if (stage === 'done') await core.uninstallApp(true)
  return core
}

/** Deployed, then ReShade's shortcuts rebound with modifiers in its overlay: Keys reads them from the config each time it opens, so open Keys. */
const reboundKeys = async () => {
  const platform = createFakePlatform(MACHINES.steam)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  const ini = `${steamGameFolder('D:\\SteamLibrary')}\\game\\ReShade.ini`
  // `key,ctrl,shift,alt`: Ctrl+Shift+Alt+F2, Ctrl+Alt+F12 and Ctrl+Shift+F7.
  const keys = ['KeyOverlay=113,1,1,1', 'KeyEffects=123,1,0,1', 'KeyNextPreset=118,1,1,0'].join('\n')
  const text = await platform.readText(ini)
  await platform.writeText(ini, text.includes('[INPUT]') ? text.replace('[INPUT]', '[INPUT]\n' + keys) : text + '\n[INPUT]\n' + keys + '\n')
  return core
}

const STATES: GalleryState[] = [
  {
    key: 'scanning',
    label: 'Scan · looking',
    async setup() {
      const platform = createFakePlatform(MACHINES.steam)
      platform.hold()
      const core = createCore(platform)
      void core.scan()
      return core
    },
  },
  { key: 'xivlauncher', label: 'Scan · found through XIVLauncher', setup: scanned(MACHINES.xivlauncher) },
  { key: 'steam', label: 'Scan · found in a Steam library', setup: scanned(MACHINES.steam) },
  { key: 'screen-60-sdr', label: 'Screen · 60 Hz SDR', setup: scanned(MACHINES.screen60Sdr), showScreenFacts: true },
  { key: 'screen-144-hdr', label: 'Screen · 144 Hz HDR', setup: scanned(MACHINES.screen144Hdr), showScreenFacts: true },
  { key: 'screen-240-dual', label: 'Screen · 240 Hz HDR, dual monitors', setup: scanned(MACHINES.screen240Dual), showScreenFacts: true },
  { key: 'beta-setup', label: 'Scan · first deployment with Beta content', setup: scanned(machine(MACHINES.beta, manifestHost({ ...BETA_MANIFEST, versions: [BETA_CONTENT] }))) },
  { key: 'no-published-tier', label: 'Scan · no content published for this card', setup: scanned(machine(MACHINES.steam, manifestHost({ ...BETA_MANIFEST, versions: [] }))) },
  { key: 'squareenix', label: 'Scan · found through the Square Enix launcher', setup: scanned(MACHINES.squareenix) },
  {
    key: 'long-path',
    label: 'Scan · found, long path',
    setup: scanned(machine(manifestHost(), graphicsCard(), steam({ libraries: [LONG_LIBRARY], game: LONG_LIBRARY }), vanillaGame(steamGameFolder(LONG_LIBRARY)))),
  },
  {
    key: 'no-version',
    label: 'Scan · found, no version file',
    setup: scanned(machine(manifestHost(), graphicsCard(), xivLauncher('D:\\XIV'), { files: { 'D:\\XIV\\game\\ffxiv_dx11.exe': 'MZ' } })),
  },
  { key: 'existing-setup', label: 'Scan · existing setups found', setup: scanned(MACHINES.existing) },
  { key: 'not-found', label: 'Scan · not found', setup: scanned(MACHINES.none) },
  { key: 'rtx-50', label: 'Scan · RTX 50, Community-verified', setup: scanned(machine(MACHINES.steam, graphicsCard('NVIDIA GeForce RTX 5090'))) },
  { key: 'rtx-20', label: 'Scan · RTX 20, shares the RTX 20/30/40 tier', setup: scanned(machine(MACHINES.steam, graphicsCard('NVIDIA GeForce RTX 2080 SUPER'))) },
  { key: 'radeon', label: 'Scan · Radeon, Experimental', setup: scanned(machine(MACHINES.steam, graphicsCard('AMD Radeon RX 7900 XTX', 0x1002))) },
  { key: 'intel', label: 'Scan · Intel, Other', setup: scanned(machine(MACHINES.steam, graphicsCard('Intel Arc A770 Graphics', 0x8086))) },
  { key: 'schema-update', label: 'Scan · app update required', setup: scanned(machine(MACHINES.steam, manifestHost({ schemaVersion: 3 }), appReleaseHost())) },
  { key: 'invalid-manifest', label: 'Scan · invalid manifest', setup: scanned(machine(MACHINES.steam, manifestHost({ schemaVersion: 1, tiers: [] }))) },
  { key: 'manifest-offline', label: 'Scan · manifest unavailable', setup: scanned(machine(steam(), graphicsCard())) },
  { key: 'no-gpu', label: 'Scan · no hardware graphics card', setup: scanned(machine(MACHINES.steam, { gpus: [] })) },
  {
    key: 'rejected',
    label: 'Scan · picked a folder without the game',
    async setup() {
      const platform = createFakePlatform(MACHINES.none)
      const core = createCore(platform)
      await core.scan()
      platform.answerPicker('C:\\Users\\Player\\Downloads')
      await core.chooseGameFolder()
      return core
    },
  },
  { key: 'profile', label: 'Profile · Neural Rendering', async setup() {
    const core = await scanned(MACHINES.steam)()
    await core.continueSetup()
    return core
  } },
  { key: 'profile-v2-rtx4090', label: 'Profile · RTX 4090 · Ultra recommended', setup: recommendedProfileHome('NVIDIA GeForce RTX 4090') },
  { key: 'profile-v2-rtx4070', label: 'Profile · RTX 4070 · Balanced fallback', setup: recommendedProfileHome('NVIDIA GeForce RTX 4070') },
  { key: 'choices-rtx40-240-hdr', label: 'Profile · RTX 40, 240 Hz HDR', setup: choicesStep(MACHINES.choices240Hdr, graphicsCard('NVIDIA GeForce RTX 4090')) },
  { key: 'choices-rtx30-60', label: 'Profile · RTX 30, 60 Hz SDR', setup: choicesStep(MACHINES.choices60Sdr, graphicsCard('NVIDIA GeForce RTX 3080')) },
  { key: 'nr-rtx4090', label: 'Graphics · RTX 4090, 240 Hz HDR', setup: choicesStep(MACHINES.nr240Hdr, graphicsCard('NVIDIA GeForce RTX 4090')) },
  { key: 'nr-dlaa', label: 'Graphics · DLAA, resolution hint', setup: choicesStep(MACHINES.nr240Hdr, graphicsCard('NVIDIA GeForce RTX 4090'), 'profile', nrPicks) },
  { key: 'nr-everything', label: 'Graphics · Every option on', setup: choicesStep(MACHINES.nr240Hdr, graphicsCard('NVIDIA GeForce RTX 4090'), 'profile', nrEverything) },
  { key: 'nr-rtx30', label: 'Graphics · RTX 30, 60 Hz SDR', setup: choicesStep(MACHINES.nr60Sdr, graphicsCard('NVIDIA GeForce RTX 3080')) },
  { key: 'nr-review', label: 'Review · Neural Rendering picks', setup: choicesStep(MACHINES.nr240Hdr, graphicsCard('NVIDIA GeForce RTX 4090'), 'review', nrEverything) },
  { key: 'nr-done', label: 'Done · Neural Rendering picks', setup: choicesStep(MACHINES.nr240Hdr, graphicsCard('NVIDIA GeForce RTX 4090'), 'done', nrEverything) },
  { key: 'choices-experimental', label: 'Profile · Experimental picks (4×, Scene HDR)', setup: choicesStep(MACHINES.choices240Hdr, graphicsCard('NVIDIA GeForce RTX 4090'), 'profile', experimentalPicks) },
  { key: 'choices-options', label: 'Options · tier without profiles (Radeon, HDR)', setup: choicesStep(MACHINES.choices240Hdr, graphicsCard('AMD Radeon RX 7900 XTX', 0x1002)) },
  { key: 'choices-options-intel', label: 'Options · tier without profiles (Intel, ReShade only)', setup: choicesStep(MACHINES.steam, graphicsCard('Intel Arc A770 Graphics', 0x8086)) },
  { key: 'review-choices', label: 'Review · Experimental picks', setup: choicesStep(MACHINES.choices240Hdr, graphicsCard('NVIDIA GeForce RTX 4090'), 'review', experimentalPicks) },
  { key: 'done-choices', label: 'Done · Experimental picks', setup: choicesStep(MACHINES.choices240Hdr, graphicsCard('NVIDIA GeForce RTX 4090'), 'done', experimentalPicks) },
  { key: 'review', label: 'Review · ReShade included', setup: workflow('review') },
  { key: 'review-no-reshade', label: 'Review · ReShade excluded', setup: workflow('review', MACHINES.steam, false) },
  { key: 'review-radeon', label: 'Review · ReShade required', setup: workflow('review', machine(MACHINES.steam, graphicsCard('AMD Radeon RX 7900 XTX', 0x1002))) },
  { key: 'review-existing-setup', label: 'Review · existing setup replaced', setup: workflow('review', MACHINES.existing) },
  { key: 'review-user-file', label: 'Review · user file protected', setup: workflow('review', machine(MACHINES.xivlauncher, { files: { 'C:\\Games\\FFXIV\\game\\winmm.dll': 'User mod' } })) },
  { key: 'review-failed', label: 'Review · download failed', setup: failedDeployment },
  { key: 'scan-recovered', label: 'Scan · unfinished deployment recovered', setup: recoveredDeployment() },
  { key: 'scan-recovery-blocked', label: 'Scan · recovery needs attention', setup: recoveredDeployment(true) },
  ...(['downloading', 'backing-up', 'applying', 'checking'] as const).map((phase) => ({ key: `install-${phase}`, label: `Install · ${phase}`, setup: installStage(phase) })),
  { key: 'done', label: 'Done · both hotkeys', setup: workflow('done') },
  { key: 'done-no-reshade', label: 'Done · OptiScaler only', setup: workflow('done', MACHINES.steam, false) },
  { key: 'done-radeon', label: 'Done · FSR and ReShade', setup: workflow('done', machine(MACHINES.steam, graphicsCard('AMD Radeon RX 7900 XTX', 0x1002))) },
  { key: 'done-other', label: 'Done · ReShade only', setup: workflow('done', machine(MACHINES.steam, graphicsCard('Intel Arc A770', 0x8086))) },
  { key: 'healthy', label: 'Main · Healthy', setup: workflow('healthy') },
  { key: 'healthy-existing', label: 'Main · Healthy over an existing setup (Uninstall asks what to do with its files)', setup: workflow('healthy', MACHINES.existing) },
  { key: 'healthy-launchers', label: 'Main · Choose XIVLauncher or Steam', setup: multipleLaunchers },
  { key: 'healthy-official', label: 'Main · Square Enix launcher', setup: workflow('healthy', MACHINES.squareenix) },
  ...([
    ['checking', 'Checking…'], ['current', 'Up to date'], ['app', 'App update available'],
    ['content', 'Content update available'], ['both', 'App and content updates'], ['failed', 'Couldn’t reach GitHub'],
  ] as const).map(([stage, label]) => ({ key: `settings-update-${stage}`, label: `Settings · ${label}`, setup: updateCheckPreview(stage), settingsPreview: true })),
  { key: 'game-running', label: 'Main · XIV running', async setup() {
    const m = machine(MACHINES.steam)
    const core = await workflow('healthy', m)()
    m.gameRunning = true
    await core.refreshGameRunning()
    return core
  } },
  { key: 'review-game-running', label: 'Review · XIV running', setup: workflow('review', machine(MACHINES.steam, { gameRunning: true })) },
  { key: 'disabled', label: 'Main · Disabled', async setup() {
    const core = await workflow('healthy')()
    await core.setEnabled(false)
    return core
  } },
  { key: 'reset-confirmation', label: 'Settings · Reset setup confirmation', setup: resetFlow('confirmation'), settingsPreview: true, openReset: true },
  { key: 'reset-profile', label: 'Profile · Reset setup prefilled', setup: resetFlow('profile') },
  { key: 'drift', label: 'Main · Drift after a game patch', setup: patched('drift') },
  { key: 'drift-with-updates', label: 'Main · Drift, with an app and content update pending', setup: driftWithUpdates },
  { key: 'repairing', label: 'Main · Repairing', setup: patched('repairing') },
  { key: 'new-gpu', label: 'Main · New graphics card', setup: newGraphicsCard },
  { key: 'folder-missing', label: 'Main · Game folder missing', setup: missingGameFolder },
  { key: 'update', label: 'Main · Content update available', setup: updateAvailable('update') },
  { key: 'updating', label: 'Main · Updating', setup: updateAvailable('updating') },
  { key: 'versions', label: 'Main · Versions and rollback', setup: versionHistory },
  { key: 'known-broken', label: 'Main · Known-broken content warning', setup: knownBrokenContent },
  { key: 'beta-channel', label: 'Main · Beta channel on', setup: betaChannel },
  { key: 'app-update', label: 'Main · App update available', setup: appUpdateAvailable('app-update') },
  { key: 'app-updating', label: 'Main · Updating Lucent', setup: appUpdateAvailable('app-updating') },
  { key: 'app-update-failed', label: 'Main · App hash mismatch', setup: appUpdateAvailable('app-update-failed') },
  { key: 'uninstalled', label: 'Scan · after uninstall', async setup() {
    const core = await workflow('healthy')()
    await core.uninstall()
    return core
  } },
  { key: 'app-uninstall', label: 'Settings → Apps · Uninstall Lucent', setup: appUninstall('confirm'), uninstallWindow: true },
  { key: 'app-uninstall-game-running', label: 'Settings → Apps · XIV running', setup: appUninstall('game-running'), uninstallWindow: true },
  { key: 'app-uninstall-backups', label: 'Settings → Apps · copies of replaced files kept', setup: appUninstall('backups'), uninstallWindow: true },
  { key: 'app-uninstall-elsewhere', label: 'Settings → Apps · Lucent open in another window', setup: appUninstall('elsewhere'), uninstallWindow: true },
  { key: 'app-uninstall-done', label: 'Settings → Apps · uninstalled', setup: appUninstall('done'), uninstallWindow: true },
  { key: 'keys-rebound', label: 'Keys · rebound combinations (open Keys)', setup: reboundKeys },
  crystalPreview('scan', 'Scan', { kind: 'scan' }, 'Glass with a line scanning the spire.'),
  crystalPreview('glass', 'Profile', { kind: 'profile' }, 'Unlit glass, slow spin, two orbiting shards and a gentle float.'),
  crystalPreview('review', 'Review', { kind: 'review' }, 'The same glass state as Performance profile.'),
  crystalPreview('fill', 'Deploying', { kind: 'deploying', progress: 0.5 }, 'Light fills the cluster from its base, easing between progress reports.'),
  crystalPreview('done', 'Done', { kind: 'done' }, 'The lit state after deployment completes.'),
  crystalPreview('lit', 'Healthy', deployment(), 'A lit spire with a slow spin, orbiting shards and a gentle float.'),
  crystalPreview('update', 'Update available', deployment({ update: AN_UPDATE }), 'A swelling glow announces an available update.'),
  crystalPreview('repair', 'Repair running', deployment({ drift: { files: ['winmm.dll'], patch: null }, operation: 'repair' }), 'The spire and shards move faster during repair.'),
  crystalPreview('busy-update', 'Update running', deployment({ update: AN_UPDATE, operation: 'update' }), 'The same fast spin during an update.'),
  crystalPreview('rollback', 'Rollback running', deployment({ operation: 'rollback' }), 'The same fast spin during rollback.'),
  crystalPreview('drift', 'Drift', deployment({ drift: { files: ['winmm.dll'], patch: null } }), 'Dark facets, a slowed spin and a falling shard.'),
  crystalPreview('disabled', 'Disabled', deployment({ enabled: false }), 'A frozen steel crystal.'),
  crystalPreview('disabled-repair', 'Disabled during repair', deployment({ enabled: false, drift: { files: ['winmm.dll'], patch: null }, operation: 'repair' }), 'Disabled stays frozen during repair, update and rollback.'),
]

/** DEV ONLY: project future activities onto a real Scan core, without adding fixture setters to production. */
function previewActivity(source: Core, activity: Activity): Core {
  let previous = source.getState()
  let snapshot = { ...previous, activity }
  return { ...source, getState() {
    const current = source.getState()
    if (current !== previous) {
      previous = current
      snapshot = { ...current, activity }
    }
    return snapshot
  } }
}

export function Gallery() {
  const initial = new URLSearchParams(location.search).get('gallery')
  const [index, setIndex] = useState(Math.max(0, STATES.findIndex((s) => s.key === initial)))
  const [core, setCore] = useState<Core | null>(null)
  const [progress, setProgress] = useState(0.5)
  const performanceRef = useRef<HTMLOutputElement>(null)
  const state = STATES[index]
  const screenFacts = core?.getState().screen
  const previewCore = useMemo(() => {
    if (!core || !state.preview) return core
    const activity = state.preview.activity.kind === 'deploying' ? { kind: 'deploying' as const, progress } : state.preview.activity
    return previewActivity(core, activity)
  }, [core, state, progress])

  useEffect(() => {
    const showCost = (event: Event) => {
      const { frames, mean, p95 } = (event as CustomEvent<{ frames: number; mean: number; p95: number }>).detail
      if (performanceRef.current) performanceRef.current.textContent = `${frames} draws · ${mean.toFixed(2)} ms mean · ${p95.toFixed(2)} ms p95`
    }
    document.addEventListener('crystal-performance', showCost)
    return () => document.removeEventListener('crystal-performance', showCost)
  }, [])

  useEffect(() => {
    let live = true
    const params = new URLSearchParams(location.search)
    params.set('gallery', state.key)
    history.replaceState(null, '', `?${params}`)
    void state.setup().then((c) => live && setCore(c))
    return () => {
      live = false
    }
  }, [state])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, select, textarea')) return
      if (e.key === 'ArrowLeft') setIndex((i) => (i - 1 + STATES.length) % STATES.length)
      if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % STATES.length)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      {previewCore && (
        <CoreContext.Provider value={previewCore} key={state.key}>
          {state.preview ? (
            <Window>
              <Screen title={state.label} sub="Crystal state preview · dev gallery">
                <div className="card crystal-preview">
                  <p>{state.preview.description}</p>
                  <p className="mono">State: {crystalState(previewCore.getState()).mode}</p>
                  {state.preview.activity.kind === 'deploying' && (
                    <label>
                      Deployment progress: {Math.round(progress * 100)}%
                      <input aria-label="Deployment progress" type="range" min="0" max="1" step="0.01" value={progress} onChange={(event) => setProgress(Number(event.target.value))} />
                    </label>
                  )}
                </div>
              </Screen>
            </Window>
          ) : state.settingsPreview ? <Window><SettingsScreen openReset={state.openReset} /></Window> : state.uninstallWindow ? <UninstallWindow /> : <App />}
        </CoreContext.Provider>
      )}
      <div className="gallery-bar" role="toolbar" aria-label="State gallery">
        <b>Gallery</b>
        <select value={index} onChange={(e) => setIndex(Number(e.target.value))}>
          {STATES.map((s, i) => (
            <option key={s.key} value={i}>
              {s.label}
            </option>
          ))}
        </select>
        {state.showScreenFacts && screenFacts && <output className="gallery-screen" aria-label="Resolved screen facts">
          {`${screenFacts.deviceName} · ${screenFacts.width}×${screenFacts.height} · ${screenFacts.refreshHz} Hz · ${screenFacts.frameCap} fps · HDR ${screenFacts.hdrOn ? 'on' : screenFacts.hdrSupported ? 'supported, off' : 'unsupported'}`}
        </output>}
        <span>← →</span>
        <label className="gallery-still">
          <input type="checkbox" checked={new URLSearchParams(location.search).has('crystal-still')} onChange={(event) => {
            const params = new URLSearchParams(location.search)
            if (event.target.checked) params.set('crystal-still', '')
            else params.delete('crystal-still')
            location.search = params.toString()
          }} />
          Still preview
        </label>
        {new URLSearchParams(location.search).has('crystal-perf') && <output ref={performanceRef} aria-label="Crystal draw cost">Measuring…</output>}
      </div>
    </>
  )
}
