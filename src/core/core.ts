// The core: all of Lucent's domain logic, framework-free. It exposes one observable state and the
// commands the UI calls. It reaches the machine only through the Platform port.
import type { GpuAdapter, Platform } from './platform'
import { checkPickedFolder, findGameFolder, isGameFolder, type GameFolder } from './gameFolder'
import { loadManifest, type ManifestState } from './manifest'
import { matchTier, scanGraphics, type GraphicsState } from './graphics'
import { removeXivLauncherAddons, scanXivLauncher, setAutoRepair, type XivLauncherState } from './xivLauncher'
import { assertReviewedTakeovers, backupFolderName, replacedOriginals, dataPaths, deployContent, deploymentRecords, DeploymentError, failureReason, lostDeployment, readableBackupPath, readDeployment, recoverDeployments, repairDeployment, restoreAutoHdrPreference, scanDeployment, setDeploymentEnabled, undoDeployment, UnreviewedFilesError, uninstallDeployment, updateDeployment, type DeploymentProgress, type DeploymentRecord } from './deployment'
import { disabledName, folderChanges, planDeployment, stepWritePaths, type FolderChanges, type Plan, type PlanSelection } from './planner'
import { checkHealth, type Drift } from './health'
import { announcedContent, needsNewerApp, onChannel, type Channel } from './updates'
import { APP_RELEASES_URL, announcedAppUpdate, cleanupOldExe, fetchAppUpdate, parseAppReleases, performAppUpdate, type AppUpdate } from './appUpdate'
export type { AppUpdate } from './appUpdate'
import { readSettings, writeSettings } from './settings'
import { detectExistingSetups, type ExistingSetup } from './existingSetup'
import { joinPath } from './paths'
import { type ContentVersion, type FrameGenerationId, type PerformanceProfile, type ProfileId, type Tier } from '../shared/manifest'
import { defaultProfileForRecipe, profilesForRecipe, recommendedProfile, selectProfileForUpdate } from './profileValues'
import { bugReportUrl, collectDiagnostics } from './diagnostics'
import { cacheSnapshot, pruneContentCache, versionChoices, type VersionChoice } from './versions'
import { gameWriteAccess, requireGameStopped, takeElevationResume, type GameWriteRequest } from './gameAccess'
import { installedExe, isSelfInstalled, lucentFolder, refreshSelfInstall, removeSelfInstall, selfInstall } from './selfInstall'
import { deploymentHotkeys, deploymentKeyCodes, liveKeyBindings, liveKeyCodes, type KeyBinding } from './hotkeys'
import { chosenLauncher, LAUNCH_LABELS, launchOptions, STEAM_GAME_ID, type LaunchKind, type LaunchOption } from './launch'
import { withOperationLock } from './operation'
import { gameRelative, loggedPort, loggedProgress, openActivityLog, parseLog, readLogTail, scanLines, trimActivityLog, type LogLine, type LogSource } from './log'
import { fileCount } from './format'
import { readResolvedScreen, type ResolvedScreen } from './screen'
import { defaultFrameGenerationMode, frameGenerationOptionsForGpu } from './frameGeneration'

/** A content version the status card announces. Nothing downloads until the player clicks Update. */
export interface ContentUpdate {
  version: string
  changelog: string[]
  /** The size of the files the update needs that aren't cached yet. */
  downloadSize: number
}

/** `missing`: no game folder was found, and the one Lucent last deployed to no longer holds the game. */
export type GameFolderState = { status: 'idle' } | { status: 'scanning' } | ({ status: 'found' } & GameFolder) | { status: 'not-found' } | { status: 'missing'; path: string }

/** The graphics card now matches another tier than the deployed one, and that tier has content to switch to. */
export interface TierChange {
  gpu: string
  /** The deployed tier's label. */
  from: string
  /** The new tier's label. */
  to: string
  /** The new adapter remains in the same tier, so this applies current-GPU recipe variants. */
  sameTier?: boolean
}

/** The last successful update check time plus any result currently shown in Settings. */
export interface UpdateCheckState {
  status: 'idle' | 'checking' | 'checked' | 'stale' | 'failed'
  checkedAt: string | null
  error: string | null
  outcome: { channel: Channel; appVersion: string | null; contentVersion: string | null } | null
}

/** Activity reported by the core. Later workflow commands will advance this beyond Scan. */
export type Activity =
  | { kind: 'scan' | 'profile' | 'review' | 'done' }
  | { kind: 'deploying'; progress: number }
  | {
      kind: 'deployment'
      enabled: boolean
      /** Null when the last health check found the deployment healthy. */
      drift: Drift | null
      /** The content version to announce, or null when there's none. */
      update: ContentUpdate | null
      /** Null when the graphics card still matches the deployed tier, or the new tier has no content yet. */
      tierChange: TierChange | null
      /** `scan` is the main screen's on-demand health check; the others write to the game folder. */
      operation: 'repair' | 'update' | 'rollback' | 'tier' | 'gpu-refresh' | 'scan' | null
    }

export interface State {
  activity: Activity
  /** Null when the process check has not succeeded; game writes stay unavailable. */
  gameRunning: boolean | null
  /** App releases are available even before a deployment exists. */
  appUpdate: AppUpdate | null
  /** Settings' update status. `checkedAt` is the last check where both sources loaded. */
  updateCheck: UpdateCheckState
  /** Null while idle; otherwise the app download/replacement progress from 0 to 1. */
  appUpdateProgress: number | null
  /** Beta also offers beta app and content versions. Leaving it changes nothing deployed. */
  channel: Channel
  gameFolder: GameFolderState
  /** The last folder the player picked that turned out not to hold the game; null once a pick succeeds. */
  rejectedFolder: string | null
  graphics: GraphicsState
  /** XIV's resolved monitor and frame cap, read at Scan and before a deployment or update writes its configs; nothing else uses it. */
  screen: ResolvedScreen | null
  manifest: ManifestState
  xivLauncher: XivLauncherState
  plan: Plan | null
  /** Mod files Lucent didn't deploy, found by Scan in a folder without a deployment. */
  existingSetups: ExistingSetup[]
  /** What a first deployment would back up, then replace or remove, as Scan lists it; null once there is a deployment. */
  folderChanges: FolderChanges | null
  deployment: DeploymentRecord | null
  versions: VersionChoice[]
  deploymentProgress: DeploymentProgress | null
  /** Profile's "Include ReShade". */
  includeReShade: boolean
  /** Profile's "Add Lucent to the Start menu"; Install self-installs when it's on. */
  addToStartMenu: boolean
  /** Lucent is in the Start menu and Settings → Apps, so Profile no longer offers it. */
  selfInstalled: boolean
  /** Set once the uninstall from Settings → Apps finishes; the real port has exited by then. */
  appUninstalled: boolean
  profiles: PerformanceProfile[]
  selectedProfile: ProfileId | null
  /** The card's first-run recommendation; null for legacy content without GPU recommendations. */
  recommendedProfile: ProfileId | null
  busy: boolean
  error: string | null
  notice: string | null
  recoveryRequired: boolean
  /** The in-game keys the Done screen teaches, read from the configs Lucent deployed. */
  hotkeys: KeyBinding[]
  /** Every in-game key as the game folder's configs say now; null until read or without a deployment. */
  keybinds: KeyBinding[] | null
  /** The ways this game folder can be started: XIVLauncher, Steam or the Square Enix launcher. */
  launchOptions: LaunchOption[]
  /** How Launch starts XIV: the player's choice, else the usual way for this folder; null when there's none. */
  launcher: LaunchKind | null
  /** Launch was just pressed; it clears once XIV runs, or after a few seconds while its launcher is open. */
  launching: boolean
}

export interface Core {
  getState(): State
  /** Calls `listener` after every state change. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void
  /** Scan: finds the game folder, graphics card, manifest tier and XIVLauncher. */
  scan(): Promise<void>
  /** Refreshes the process state without resetting the player's screen or choices. */
  refreshGameRunning(): Promise<void>
  /** Lets the player pick the game folder, whether or not Scan found one. */
  chooseGameFolder(): Promise<void>
  /** Find it: scans again for a missing game folder; if it's still gone, Scan offers the folder picker. */
  findGameFolder(): Promise<void>
  continueSetup(): Promise<void>
  /** The Profile step's choice; once there is a deployment, its profile stays as it was deployed. */
  selectProfile(profile: ProfileId): Promise<void>
  /** Profile's "Include ReShade"; Scan's list follows it. */
  setIncludeReShade(include: boolean): void
  review(includeReShade?: boolean): Promise<void>
  setAddToStartMenu(add: boolean): void
  backToScan(): void
  backToProfile(): void
  deploy(): Promise<void>
  finish(): void
  /** Switches the deployment between Enabled and Disabled, renaming its entry files through the journal. */
  setEnabled(enabled: boolean): Promise<void>
  /** Re-applies the deployment so that no drift remains, then checks its health again. */
  repair(): Promise<void>
  /** Scan on the main screen: hashes every deployed file now, then shows drift with Repair, or confirms all is well. Only reads. */
  checkFiles(): Promise<void>
  /** Reads the in-game keys from the game folder's configs again, so a key changed in game shows. */
  refreshKeybinds(): Promise<void>
  /** Starts XIV the way the player does, without closing Lucent. */
  launchGame(): Promise<void>
  /** Remembers how Launch starts XIV. */
  setLauncher(kind: LaunchKind): Promise<void>
  /** Plans the deployment again for the graphics card's new tier, keeping the profile it still has, Disabled and user changes. */
  switchTier(): Promise<void>
  /** Moves the deployment to the announced content version, then checks its health again. */
  update(): Promise<void>
  /** Applies a version from Versions, including cached rollback targets and skipped versions. */
  applyVersion(version: string): Promise<void>
  /** Downloads the announced app version, verifies it, replaces the running exe and relaunches. */
  updateApp(): Promise<void>
  /** Stops announcing the announced app version. */
  skipAppUpdate(): Promise<void>
  /** Stops announcing the announced content version. */
  skipUpdate(): Promise<void>
  /** Undoes the deployment, leaving the game folder vanilla, then returns to Scan. */
  uninstall(): Promise<void>
  /** Adds or removes XIVLauncher's add-on entries that check on game launch and repair on game close. */
  setAutoRepair(enabled: boolean): Promise<void>
  /** Switches between Stable and Beta for app and content versions, then announces again. Never touches the game folder, so XIV may be running. */
  setChannel(channel: Channel): Promise<void>
  /** Settings' Check now: refreshes app/content announcements and exposes the result in updateCheck. Never touches the game folder. */
  checkForUpdates(): Promise<void>
  /** Opens the uninstall window Settings → Apps starts, continuing a confirmed uninstall after admin access. */
  openAppUninstall(): Promise<void>
  /** Optionally uninstalls every deployment, then removes the shortcut, the Settings → Apps entry, the data folder and the exe. */
  uninstallApp(restoreGameFolder: boolean): Promise<void>
  copyDiagnostics(): Promise<void>
  reportBug(): Promise<void>
  /** The last lines of a log the Logs section shows; null when that log hasn't been written yet. Works while Lucent is busy. */
  readLog(source: LogSource): Promise<LogLine[] | null>
  /** Copies those lines to the clipboard, as written. Resolves to whether there was a log to copy. */
  copyLog(source: LogSource): Promise<boolean>
  openLink(url: string): Promise<void>
}

const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.1.0'

/** What the Profile step offers: the performance profile, then ReShade and the Start menu where each is still a choice. */
export function setupChoices(state: State) {
  const tier = state.graphics.status === 'found' ? state.graphics.tier : null
  const choices = { profiles: state.profiles.length > 0, reShade: !!tier && !tier.requiresReShade, startMenu: !state.selfInstalled }
  return { ...choices, any: choices.profiles || choices.reShade || choices.startMenu }
}

/**
 * Progress arrives per file, per step and per downloaded chunk, far more often than anyone can see; each report is a
 * state change that renders the window again. At most ten a second reach the state, and the UI eases between them.
 * A new phase and the final report always pass.
 */
export function pacedProgress<T extends { phase?: string; progress: number }>(apply: (progress: T) => void, intervalMs = 100) {
  let last = -Infinity
  let phase: string | undefined
  return (progress: T) => {
    const now = performance.now()
    if (progress.phase === phase && progress.progress < 1 && now - last < intervalMs) return
    last = now
    phase = progress.phase
    apply(progress)
  }
}

export function createCore(platform: Platform): Core {
  const nativePlatform = platform
  let playerLocalAppData: string | null = null
  platform = new Proxy(nativePlatform, { get(target, key) {
    if (key === 'envFolder') return (folder: Parameters<Platform['envFolder']>[0]) => folder === 'LocalAppData' && playerLocalAppData
      ? Promise.resolve(playerLocalAppData) : target.envFolder(folder)
    return Reflect.get(logged, key) ?? Reflect.get(target, key)
  } })
  // The activity log lives in the player's data folder, so it is opened on the port that knows where that is.
  const log = openActivityLog(platform)
  const logged = loggedPort(nativePlatform, log, (path) => gameRelative(state.deployment?.gameFolder ?? ('path' in state.gameFolder ? state.gameFolder.path : null), path))
  let state: State = {
    activity: { kind: 'scan' }, gameRunning: null, appUpdate: null, appUpdateProgress: null, updateCheck: { status: 'idle', checkedAt: null, error: null, outcome: null }, channel: 'stable', gameFolder: { status: 'idle' }, rejectedFolder: null,
    graphics: { status: 'idle' }, manifest: { status: 'idle' }, xivLauncher: { status: 'idle' },
    plan: null, existingSetups: [], folderChanges: null, deployment: null, versions: [], deploymentProgress: null, includeReShade: true, addToStartMenu: true, selfInstalled: false, appUninstalled: false, profiles: [], selectedProfile: null, recommendedProfile: null, busy: false, error: null, notice: null, recoveryRequired: false, screen: null, hotkeys: [], keybinds: null, launchOptions: [], launcher: null, launching: false,
  }
  const listeners = new Set<() => void>()
  const set = (patch: Partial<State>) => {
    // Whatever the window tells the player goes in the log too.
    if (patch.error && patch.error !== state.error) log.write('error', patch.error)
    if (patch.notice && patch.notice !== state.notice) log.write('info', patch.notice)
    state = { ...state, ...patch }
    for (const l of listeners) l()
  }

  const message = (error: unknown) => error instanceof Error ? error.message : String(error)
  /** The log's first line for this process, once it's known whether it reopened with administrator access. */
  let logOpened = false
  const openLog = async (elevated: boolean) => {
    if (logOpened) return
    logOpened = true
    await trimActivityLog(platform)
    log.write('info', `Lucent ${APP_VERSION} started${elevated ? ' with administrator access' : ''}`)
  }
  /** The health check runs around every command; the log says only when its result changes. */
  let notedHealth: string | null = null
  const noteHealth = (record: DeploymentRecord, drift: Drift | null) => {
    const result = drift ? drift.files.join('|') : 'healthy'
    if (result === notedHealth) return
    notedHealth = result
    if (!drift) { log.write('info', `Health check: healthy, ${fileCount(Object.keys(record.files).length)}`); return }
    const more = drift.files.length - 5
    log.write('warning', `Drift in ${fileCount(drift.files.length)}${drift.patch ? ` after game patch ${drift.patch}` : ''}: ${drift.files.slice(0, 5).join(', ')}${more > 0 ? ` and ${more.toLocaleString('en')} more` : ''}`)
  }
  const profileNote = (profiles: PerformanceProfile[] | undefined, id: ProfileId | null | undefined) => id ? `, ${profiles?.find((p) => p.id === id)?.label ?? id} profile` : ''
  /** What a deployment or an update plans its config values from: the card's frame generation options, and XIV's screen. */
  const frameGenerationSelection = (content: ContentVersion, tier: Tier, mode?: FrameGenerationId | null): PlanSelection => {
    const gpuName = state.graphics.status === 'found' ? state.graphics.adapter.name : state.deployment?.graphics.name ?? ''
    const options = frameGenerationOptionsForGpu(content.tiers[tier.id]?.frameGenerationOptions ?? [], gpuName)
    return { gpuName, outputHeight: state.screen?.height, frameGenerationOptions: options, frameGenerationMode: mode === undefined
      ? defaultFrameGenerationMode(options, state.screen?.refreshHz ?? 60) : mode, hdrOn: state.screen?.hdrOn ?? false, screen: state.screen }
  }
  const elapsed = (since: number) => `${Math.max(1, Math.round((performance.now() - since) / 1000))} s`
  const access = gameWriteAccess(platform, (gameRunning) => set({ gameRunning }))
  /** A cached version rolls back without the manifest; any other comes from the published manifest. */
  const versionSource = (deployment: DeploymentRecord, version: string) => {
    const { manifest } = state
    const cached = deployment.cachedVersions?.find((v) => v.content.id === version)
    const content = cached?.content ?? (manifest.status === 'ready' ? manifest.manifest.versions.find((v) => v.id === version && onChannel(v, state.channel)) : null)
    const tier = cached?.tier ?? (manifest.status === 'ready' ? manifest.manifest.tiers.find((t) => t.id === deployment.tier) : null)
    if (!content || !tier) throw new Error('This content version is no longer published. Reopen Lucent to check again.')
    return { content, tier }
  }
  const writeTargets = async (request: GameWriteRequest): Promise<string[]> => {
    if (request.kind === 'deploy') return state.plan?.steps.flatMap(stepWritePaths) ?? []
    const record = await readDeployment(platform, request.gameFolder)
    if (!record) throw new Error('The deployment is no longer available. Run Scan again.')
    if (request.kind === 'enabled') return record.recipe.entryFiles.filter((p) => p.when !== 'reshade' || record.includeReShade).flatMap((p) => [p.path, disabledName(p.path)])
    if (request.kind === 'update' || request.kind === 'tier') {
      const target = request.kind === 'update' ? versionSource(record, request.contentVersion) : tierSwitchTarget(record)
      if (!target || target.content.id !== request.contentVersion) throw new Error('This content version is no longer published. Reopen Lucent to check again.')
      const scan = await scanDeployment(platform, record.gameFolder, target.content, record, [])
      const targetRecipe = target.content.tiers[target.tier.id]
      const profile = selectProfileForUpdate(targetRecipe, record.recipe, record.profile ?? null, state.graphics.status === 'found' ? state.graphics.adapter.name : '')
      const selection = frameGenerationSelection(target.content, target.tier, record.frameGenerationMode)
      selection.outputHeight = state.screen?.height
      return [...planDeployment(target.content, target.tier, record.includeReShade, scan, profile, record.enabled, selection).steps.flatMap(stepWritePaths),
        ...(selection.frameGenerationOptions ?? []).flatMap((option) => option.settings.map((setting) => setting.file))]
    }
    return [...record.journal.slice(request.kind === 'recover' ? record.changeStart ?? 0 : 0).flatMap((entry) => Object.keys(entry.before)),
      ...(record.createdDirectories ?? []), ...(request.kind === 'uninstall' || record.uninstalling ? record.generatedFiles ?? [] : [])]
  }
  const prepareWrite = async (request: GameWriteRequest, targets?: string[]) => {
    if (state.gameFolder.status === 'missing') throw new Error('The game folder is missing. Find it before changing your setup.')
    await requireGameStopped(platform, (gameRunning) => set({ gameRunning }))
    const writePaths = [...new Set(targets ?? await writeTargets(request))]
    const ready = await access(request, writePaths)
    if (!ready) set({ notice: 'Lucent is reopening with administrator access to continue your change.' })
    return ready
  }
  class ElevationPending extends Error {}
  let resumeContentVersion: string | null = null
  let resumeReviewedPaths: string[] | null = null
  /** Find it clears this, so a scan that still finds no game folder leads to first-run Scan and its folder picker. */
  let showLostDeployment = true
  const recover = async () => {
    try {
      const recovered = await recoverDeployments(platform, async (record) => {
        if (!await prepareWrite({ kind: 'recover', gameFolder: record.gameFolder })) throw new ElevationPending()
      })
      const notice = recovered.some((r) => r.uninstalling) ? 'Lucent finished uninstalling. Your game folder is as it was before.'
        : recovered.length ? 'Lucent found an unfinished deployment and restored the game folder to how it was before. You can try again.' : null
      set({ recoveryRequired: false, ...(notice ? { notice } : {}) })
      return true
    } catch (error) {
      if (error instanceof ElevationPending) return false
      set({ recoveryRequired: true, error: `Recovery could not finish. ${failureReason(error)} Try recovery again once the problem is resolved.` })
      throw error
    }
  }
  const signatures = () => state.manifest.status === 'ready' ? state.manifest.manifest.existingSetups : []
  /** The game folder's files as Scan last listed them, before any deployment. */
  let scanned: { gameFolder: string; files: string[] } | null = null
  /** Only the takeover paths accepted by Review, carried unchanged through Install and elevation. */
  let reviewedPaths: string[] | null = null
  const requireNewScan = () => {
    scanned = null
    reviewedPaths = null
    set({ activity: { kind: 'scan' }, plan: null, folderChanges: null })
  }
  /** Plans with today's choices to list what would be backed up; Review may never add takeovers to this scanned list. */
  const refreshFolderChanges = async () => {
    const content = newestContentForTier()
    const tier = state.graphics.status === 'found' ? state.graphics.tier : null
    if (!scanned || !content || !tier || state.deployment) { set({ folderChanges: null }); return }
    const { gameFolder, files } = scanned
    try {
      const plan = planDeployment(content, tier, state.includeReShade, { files, ownedFiles: [], cachedFiles: [], existingSetups: state.existingSetups }, state.selectedProfile, true,
        { ...frameGenerationSelection(content, tier), gpuName: state.graphics.status === 'found' ? state.graphics.adapter.name : '', outputHeight: state.screen?.height })
      const changes = folderChanges(plan, await readableBackupPath(platform, gameFolder, await backupFolderName(platform, gameFolder)))
      if (scanned?.gameFolder === gameFolder) set({ folderChanges: changes })
    } catch { set({ folderChanges: null }) }
  }
  /** When Launch was pressed; the button shows it starting until XIV runs or this passes. */
  let launchingUntil = 0
  let launcherPreference: LaunchKind | null = null
  const refreshLaunch = async (folder: GameFolder, loadPreference = true) => {
    try {
      const options = await launchOptions(platform, folder)
      if (loadPreference) launcherPreference = (await readSettings(platform)).launcher
      set({ launchOptions: options, launcher: chosenLauncher(options, launcherPreference) })
    } catch { set({ launchOptions: [], launcher: null }) }
  }
  const refreshScreen = async (): Promise<ResolvedScreen | null> => {
    try {
      const screen = await readResolvedScreen(platform)
      set({ screen })
      return screen
    } catch {
      // A monitor enumeration failure should not prevent the rest of Scan from opening.
      set({ screen: null })
      return null
    }
  }
  const restoreDeployment = async (folder: GameFolder) => {
    await refreshLaunch(folder)
    let record = await readDeployment(platform, folder.path)
    if (record?.status === 'applying') {
      if (!await prepareWrite({ kind: 'recover', gameFolder: record.gameFolder })) return
      await undoDeployment(platform, record); record = null
    }
    const files = record?.status === 'complete' ? [] : await platform.listFiles(joinPath(folder.path, 'game'))
    scanned = record?.status === 'complete' ? null : { gameFolder: folder.path, files }
    set({ existingSetups: detectExistingSetups(signatures(), files) })
    if (state.existingSetups.length) log.write('info', `Existing setup: ${state.existingSetups.map((setup) => setup.label).join(', ')}`)
    await refreshFolderChanges()
    if (record?.status === 'complete') {
      // Older journals acquire a snapshot when their deployed version is still published.
      if (!record.cachedVersions?.length && state.manifest.status === 'ready') {
        const content = state.manifest.manifest.versions.find((v) => v.id === record!.contentVersion)
        const tier = state.manifest.manifest.tiers.find((t) => t.id === record!.tier)
        if (content && tier) {
          const hashes = new Set(record.recipe.recipe.filter((s) => s.kind === 'copy').map((s) => s.file))
          record.cachedVersions = [cacheSnapshot(content, tier, record.recipe, content.files.filter((f) => hashes.has(f.sha256)))]
          await platform.writeText((await dataPaths(platform, record.gameFolder)).record, JSON.stringify(record, null, 2))
        }
      }
      try { await finishSelection(record) }
      catch (error) { set({ notice: `Content ${record.contentVersion} is applied. Lucent will finish saving your version choice when you reopen it. ${message(error)}` }) }
      const drift = await checkHealth(platform, record, folder.version)
      // A version that can't be planned is never announced; it must not keep the deployment from opening.
      const update = await announceUpdate(record).catch(() => null)
      log.write('info', `Deployment: content ${record.contentVersion}, ${state.manifest.status === 'ready' && state.manifest.manifest.tiers.find((t) => t.id === record.tier)?.label || record.tier} tier${profileNote(profilesForRecipe(record.recipe), record.profile)}, ${record.enabled ? 'Enabled' : 'Disabled'}`)
      noteHealth(record, drift)
      if (update) log.write('info', `Content ${update.version} is available`)
      set({ deployment: record, profiles: profilesForRecipe(record.recipe), selectedProfile: record.profile ?? null, recommendedProfile: null, includeReShade: record.includeReShade, activity: deploymentActivity(record, drift, update) })
      await refreshKeybinds()
      await pruneCache(record)
      await refreshVersions()
    }
  }
  const checkSelfInstall = async () => {
    try {
      const selfInstalled = await isSelfInstalled(platform)
      set({ selfInstalled })
      if (selfInstalled) await refreshSelfInstall(platform, APP_VERSION)
    } catch { /* Review offers the Start menu again; adding it once more is harmless. */ }
  }
  const addToStartMenu = async () => {
    try {
      await selfInstall(platform, APP_VERSION)
      set({ selfInstalled: true })
    } catch (error) { set({ notice: `Lucent couldn’t add itself to the Start menu. ${message(error)} It keeps working from where it is.` }) }
  }
  const deploymentActivity = (record: DeploymentRecord, drift: Drift | null, update: ContentUpdate | null): Activity =>
    ({ kind: 'deployment', enabled: record.enabled, drift, update, tierChange: tierChange(record), operation: null })
  /** The graphics card's tier and the content to plan it with: the deployed version when it has that tier, else the newest. */
  const tierSwitchTarget = (record: DeploymentRecord): { tier: Tier; content: ContentVersion } | null => {
    const { graphics, manifest } = state
    if (graphics.status !== 'found' || !graphics.tier || manifest.status !== 'ready') return null
    const sameTier = graphics.tier.id === record.tier
    if (sameTier && graphics.adapter.name.trim().toLowerCase() === record.graphics.name.trim().toLowerCase()) return null
    const tier = graphics.tier
    const candidates = manifest.manifest.versions.filter((v) => v.tiers[tier.id] && (v.id === record.contentVersion || onChannel(v, state.channel)) && !needsNewerApp(v.minAppVersion, APP_VERSION))
    const content = candidates.find((v) => v.id === record.contentVersion)
      ?? (!sameTier ? candidates.sort((a, b) => b.id.localeCompare(a.id))[0] : undefined)
    return content ? { tier, content } : null
  }
  const tierChange = (record: DeploymentRecord): TierChange | null => {
    const target = tierSwitchTarget(record)
    if (!target || state.graphics.status !== 'found' || state.manifest.status !== 'ready') return null
    const from = state.manifest.manifest.tiers.find((t) => t.id === record.tier)?.label ?? record.cachedVersions?.[0]?.tier.label ?? record.tier
    return { gpu: state.graphics.adapter.name, from, to: target.tier.label, ...(target.tier.id === record.tier ? { sameTier: true } : {}) }
  }
  /** App releases come from GitHub, never the manifest; a failed fetch announces nothing. */
  const announceApp = async (): Promise<AppUpdate | null> => {
    const { skippedApp } = await readSettings(platform)
    return fetchAppUpdate(platform, { appVersion: APP_VERSION, skipped: skippedApp, channel: state.channel })
  }
  /** Checked on open and after an update or a skip; there is no background service. */
  const announceUpdate = async (record: DeploymentRecord, manifestState = state.manifest): Promise<ContentUpdate | null> => {
    if (manifestState.status !== 'ready') return null
    const { manifest } = manifestState
    const { skippedContent } = await readSettings(platform)
    const content = announcedContent(manifest, { channel: state.channel, tier: record.tier, current: record.contentVersion, skipped: [...skippedContent, ...(record.pendingSelection?.skip ? [record.pendingSelection.skip] : [])], appVersion: APP_VERSION })
    const tier = manifest.tiers.find((t) => t.id === record.tier)
    if (!content || !tier) return null
    const scan = await scanDeployment(platform, record.gameFolder, content, record, [])
    const targetRecipe = content.tiers[tier.id]
    const profile = selectProfileForUpdate(targetRecipe, record.recipe, record.profile ?? null, state.graphics.status === 'found' ? state.graphics.adapter.name : '')
    const plan = planDeployment(content, tier, record.includeReShade, scan, profile, record.enabled,
      { ...frameGenerationSelection(content, tier, record.frameGenerationMode ?? null), gpuName: state.graphics.status === 'found' ? state.graphics.adapter.name : '', outputHeight: state.screen?.height })
    return { version: content.id, changelog: content.changelog, downloadSize: plan.downloadSize }
  }
  /** The health check right after a deployment, shown once the player leaves Done. */
  let deployedDrift: Drift | null = null
  /** Runs the health check before and after every command that writes to the game folder. */
  const refreshHealth = async (record: DeploymentRecord, full = false, progress?: (checked: number, total: number) => void) => {
    const version = state.gameFolder.status === 'found' ? state.gameFolder.version : null
    const drift = await checkHealth(platform, record, version, full, progress)
    noteHealth(record, drift)
    if (state.activity.kind === 'deployment') set({ activity: { ...state.activity, drift } })
    return drift
  }
  /** The keys as OptiScaler.ini and ReShade.ini say now; a file that can't be read leaves that tool on its defaults. */
  const refreshKeybinds = async () => {
    const record = state.deployment
    if (record?.status !== 'complete' || state.gameFolder.status !== 'found') { if (state.keybinds) set({ keybinds: null }); return }
    const root = joinPath(record.gameFolder, 'game')
    const read = async (name: string) => {
      try { return await platform.readText(await platform.resolveGamePath(root, name)) } catch { return null }
    }
    const onDisk = { optiScaler: await read('OptiScaler.ini'), reShade: await read('ReShade.ini') }
    let names: Record<number, string> = {}
    try { names = await platform.getKeyNames(liveKeyCodes(record, onDisk)) } catch { /* The US labels remain available if Windows lookup fails. */ }
    const keybinds = liveKeyBindings(record, onDisk, names)
    if (JSON.stringify(keybinds) !== JSON.stringify(state.keybinds)) set({ keybinds })
  }
  /** After a command, whether it succeeded or was undone, checks the deployment as it now stands on disk. */
  const refreshHealthAfter = async (full = false) => {
    if (state.recoveryRequired || state.gameFolder.status !== 'found') return
    try {
      const record = await readDeployment(platform, state.gameFolder.path)
      if (record?.status === 'complete') { set({ deployment: record }); await refreshHealth(record, full); await refreshKeybinds() }
    } catch { /* A failed check leaves the last result showing; the command's own error already explains. */ }
  }
  const refreshVersions = async () => {
    if (!state.deployment) { set({ versions: [] }); return }
    set({ versions: await versionChoices(platform, state.deployment, state.manifest.status === 'ready' ? state.manifest.manifest : null, await readSettings(platform), state.channel, APP_VERSION) })
  }
  const refreshUpdateCheck = async (manual = false, knownManifest?: ManifestState) => {
    const previous = state.updateCheck
    set({ updateCheck: { ...previous, status: 'checking', error: null } })
    const [manifest, releases, settings] = await Promise.all([
      knownManifest ? Promise.resolve(knownManifest) : loadManifest(platform),
      platform.fetchText(APP_RELEASES_URL).then((text) => ({ text }), (error: unknown) => ({ error })),
      readSettings(platform).then((value) => ({ value }), (error: unknown) => ({ error })),
    ])
    if ('error' in settings) {
      set({ updateCheck: manual
        ? { ...previous, status: 'failed', error: message(settings.error) }
        : { ...previous, status: previous.checkedAt ? 'stale' : 'idle', error: null } })
      return
    }
    const preferences = settings.value
    let releasesError: string | null = null
    let appUpdate: AppUpdate | null = state.appUpdate
    if ('text' in releases) {
      let releaseList: unknown
      try { releaseList = JSON.parse(releases.text) }
      catch { releasesError = 'GitHub returned an unreadable app releases list.' }
      if (!releasesError && !Array.isArray(releaseList)) releasesError = 'GitHub returned an invalid app releases list.'
      if (!releasesError) appUpdate = announcedAppUpdate(parseAppReleases(releases.text), { appVersion: APP_VERSION, skipped: preferences.skippedApp, channel: state.channel })
    } else releasesError = message(releases.error)

    const manifestError = manifest.status === 'ready' ? null : `The manifest didn’t load. ${'message' in manifest ? manifest.message : ''}`.trim()
    const record = state.activity.kind === 'deployment' ? state.deployment : null
    let update = state.activity.kind === 'deployment' ? state.activity.update : null
    let versions = state.versions
    let contentError: string | null = null
    if (manifest.status === 'ready' && record) {
      try {
        update = await announceUpdate(record, manifest)
        versions = await versionChoices(platform, record, manifest.manifest, preferences, state.channel, APP_VERSION)
      } catch (error) { contentError = message(error) }
    }

    const allSucceeded = !manifestError && !releasesError && !contentError
    let checkedAt: string | null = null
    let outcome = previous.outcome
    let settingsError: string | null = null
    if (allSucceeded) {
      checkedAt = new Date().toISOString()
      const successfulOutcome = { channel: state.channel, appVersion: appUpdate?.version ?? null, contentVersion: update?.version ?? null }
      try {
        await writeSettings(platform, { ...preferences, lastUpdateCheck: { checkedAt, ...successfulOutcome } })
        outcome = successfulOutcome
      }
      catch (error) { settingsError = `Could not save the check time. ${message(error)}` }
    }
    const checkSucceeded = allSucceeded && !settingsError

    const graphics = manifest.status === 'ready' && state.graphics.status === 'found'
      ? { ...state.graphics, tier: matchTier(state.graphics.adapter, manifest.manifest) } : state.graphics
    const patch: Partial<State> = {
      appUpdate,
      ...(manifest.status === 'ready' ? { manifest, graphics } : {}),
      ...(manifest.status === 'ready' && !contentError && record ? { versions } : {}),
      updateCheck: checkSucceeded && checkedAt
        ? { status: 'checked', checkedAt, error: null, outcome }
        : manual
          ? { ...previous, status: 'failed', error: manifestError ?? releasesError ?? contentError ?? settingsError ?? 'The check failed.' }
          : { ...previous, status: previous.checkedAt ? 'stale' : 'idle', error: null },
    }
    set(patch)
    if (manifest.status === 'ready' && !contentError && record && state.activity.kind === 'deployment') {
      set({ activity: { ...state.activity, update, tierChange: tierChange(record) } })
    }
  }
  const refreshAnnouncement = async () => { await refreshUpdateCheck() }
  const finishSelection = async (record: DeploymentRecord) => {
    if (!record.pendingSelection) return
    const settings = await readSettings(platform)
    await writeSettings(platform, { ...settings, skippedContent: [...new Set([...settings.skippedContent.filter((id) => id !== record.contentVersion), ...(record.pendingSelection.skip ? [record.pendingSelection.skip] : [])])] })
    await platform.writeText((await dataPaths(platform, record.gameFolder)).record, JSON.stringify({ ...record, pendingSelection: undefined }, null, 2))
    delete record.pendingSelection
  }
  const pruneCache = async (record: DeploymentRecord) => {
    try { await pruneContentCache(platform, record.gameFolder) }
    catch (error) { set({ notice: `Lucent could not prune older cached files. ${message(error)}` }) }
  }
  const newestContentForTier = (): ContentVersion | undefined => {
    if (state.manifest.status !== 'ready' || state.graphics.status !== 'found' || !state.graphics.tier) return undefined
    const tier = state.graphics.tier
    return state.manifest.manifest.versions.filter((v) => onChannel(v, state.channel) && v.tiers[tier.id]).sort((a, b) => b.id.localeCompare(a.id))[0]
  }
  const contentForTier = (): ContentVersion => {
    if (state.manifest.status !== 'ready' || state.graphics.status !== 'found' || !state.graphics.tier) throw new Error('Finish Scan before continuing.')
    const tierId = state.graphics.tier.id
    const content = resumeContentVersion
      ? state.manifest.manifest.versions.find((v) => v.id === resumeContentVersion && v.tiers[tierId])
      : newestContentForTier()
    if (!content) throw new Error('No content is published for this tier yet.')
    if (needsNewerApp(content.minAppVersion, APP_VERSION)) throw new Error('Update Lucent before installing this content version.')
    return content
  }
  const prepareProfiles = (content: ContentVersion) => {
    if (state.graphics.status !== 'found' || !state.graphics.tier) return
    const recipe = content.tiers[state.graphics.tier.id]
    const profiles = profilesForRecipe(recipe)
    const recommendation = recipe.performanceProfilesV2 === undefined ? null : recommendedProfile(profiles, state.graphics.adapter.name)?.id ?? null
    const selectedProfile = profiles.some((p) => p.id === state.selectedProfile) ? state.selectedProfile : defaultProfileForRecipe(recipe, state.graphics.adapter.name)
    set({ profiles, selectedProfile, recommendedProfile: recommendation })
  }
  /** Moves the deployment to other content, a version or a tier, through the update path, then checks it again. */
  const changeContent = async (operation: 'update' | 'rollback' | 'tier' | 'gpu-refresh', request: GameWriteRequest, target: () => { content: ContentVersion; tier: Tier }, graphics?: GpuAdapter) => {
    const { activity, deployment, manifest } = state
    if (activity.kind !== 'deployment' || !deployment) return
    set({ busy: true, error: null, notice: null, deploymentProgress: null, activity: { ...activity, operation } })
    let applied = false
    try {
      if (!await prepareWrite(request)) return
      await refreshHealth(deployment)
      const { content, tier } = target()
      if (needsNewerApp(content.minAppVersion, APP_VERSION)) throw new Error('Update Lucent before applying this content version.')
      const since = performance.now()
      const title = operation === 'gpu-refresh' ? `GPU refresh for ${tier.label}`
        : operation === 'tier' ? `Tier switch to ${tier.label}` : operation === 'rollback' ? 'Rollback' : 'Update'
      log.write('info', `${title}${content.id === deployment.contentVersion ? '' : `: content ${deployment.contentVersion} to ${content.id}`}`)
      const targetGraphics = graphics ?? (state.graphics.status === 'found' && state.graphics.tier?.id === tier.id ? state.graphics.adapter : undefined)
      const record = await updateDeployment(platform, deployment.gameFolder, content, tier, manifest.status === 'ready' ? manifest.source : { kind: 'github' }, loggedProgress(log, pacedProgress((progress) => set({ deploymentProgress: progress }))), targetGraphics, await refreshScreen())
      applied = true
      log.write('success', `${title} finished in ${elapsed(since)}`)
      set({ deployment: record, profiles: profilesForRecipe(record.recipe), selectedProfile: record.profile ?? null, recommendedProfile: null, includeReShade: record.includeReShade })
      try { await finishSelection(record) }
      catch (error) { set({ notice: `Content ${record.contentVersion} is applied. Lucent will finish saving your version choice when you reopen it. ${message(error)}` }) }
      await pruneCache(record)
    } catch (error) {
      set(error instanceof DeploymentError
        ? { error: error.message, recoveryRequired: error.recoveryRequired }
        : { error: applied ? `${failureReason(error)} The change itself finished; run Scan to check the deployment.` : `${failureReason(error)} The game folder has not been changed.` })
    }
    finally {
      await refreshHealthAfter(true)
      await refreshAnnouncement()
      if (state.activity.kind === 'deployment') set({ activity: { ...state.activity, operation: null, tierChange: state.deployment ? tierChange(state.deployment) : null } })
      set({ busy: false, deploymentProgress: null })
    }
  }
  const core: Core = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async copyDiagnostics() {
      if (state.busy) return
      set({ busy: true, error: null, notice: null })
      try {
        await platform.copyText(await collectDiagnostics(platform, state, APP_VERSION, state.channel))
        set({ notice: 'Diagnostics copied to the clipboard.' })
      } catch (error) { set({ error: `Could not copy diagnostics. ${message(error)}` }) }
      finally { set({ busy: false }) }
    },
    async readLog(source) {
      try {
        // Lines still on their way to the file belong in what the player sees.
        await log.flushed()
        const text = await readLogTail(platform, source, state.deployment?.gameFolder ?? null)
        return text === null ? null : parseLog(source, text)
      } catch (error) { return [{ date: null, time: null, level: 'error', text: `Lucent couldn’t read this log. ${message(error)}` }] }
    },
    async copyLog(source) {
      try {
        await log.flushed()
        const text = await readLogTail(platform, source, state.deployment?.gameFolder ?? null)
        if (text) await platform.copyText(text)
        return !!text
      } catch (error) {
        set({ error: `Could not copy the log. ${message(error)}` })
        return false
      }
    },
    async openLink(url) {
      if (state.busy) return
      set({ busy: true, error: null })
      try {
        const link = new URL(url)
        if (link.protocol !== 'https:' || /[\u0000-\u001f]/.test(url)) throw new Error('Source links must use HTTPS.')
        await platform.openUrl(link.href)
      } catch (error) { set({ error: `Could not open the link. ${message(error)}` }) }
      finally { set({ busy: false }) }
    },
    async setAutoRepair(enabled) {
      const { xivLauncher, deployment } = state
      if (state.busy || xivLauncher.status !== 'found' || !deployment) return
      set({ busy: true, error: null, notice: null })
      try {
        // The entries run elevated when the game folder needs it; Lucent only ever elevates for that reason.
        const runAsAdmin = enabled && (await platform.isElevated()
          || !await platform.isDirectoryWritable(joinPath(deployment.gameFolder, 'game'), Object.keys(deployment.files)))
        // A portable copy may be deleted once the installed one exists, so the entries start the installed one.
        const exePath = state.selfInstalled ? await installedExe(platform) : await platform.exePath()
        await setAutoRepair(platform, xivLauncher.configPath, { enabled, exePath, runAsAdmin })
        set({ xivLauncher: { ...xivLauncher, autoRepair: enabled } })
        log.write('info', `XIVLauncher auto-repair: ${enabled ? 'on' : 'off'}`)
      } catch (error) { set({ error: `Could not change auto-repair. ${message(error)}` }) }
      finally { set({ busy: false }) }
    },
    async setChannel(channel) {
      if (state.busy || channel === state.channel) return
      set({ busy: true, error: null, notice: null })
      try {
        // Only the setting changes: the deployment stays on whatever version it has, and the game folder isn't touched.
        await writeSettings(platform, { ...await readSettings(platform), channel })
        set({ channel })
        log.write('info', `Channel: ${channel === 'beta' ? 'Beta' : 'Stable'}`)
        await refreshAnnouncement()
        if (state.activity.kind === 'deployment' && state.deployment) set({ activity: { ...state.activity, tierChange: tierChange(state.deployment) } })
      } catch (error) { set({ error: `Could not change the channel. ${message(error)}` }) }
      finally { set({ busy: false }) }
    },
    async checkForUpdates() {
      const record = state.deployment
      if (state.busy || !record || state.activity.kind !== 'deployment') return
      set({ busy: true })
      try { await refreshUpdateCheck(true) }
      finally { set({ busy: false }) }
    },
    async reportBug() {
      if (state.busy) return
      set({ busy: true, error: null, notice: null })
      try {
        await platform.copyText(await collectDiagnostics(platform, state, APP_VERSION, state.channel))
        set({ notice: 'Diagnostics copied to the clipboard.' })
        await platform.openUrl(bugReportUrl(state))
        set({ notice: 'Diagnostics copied. Paste them into the GitHub issue.' })
      } catch (error) { set({ error: `Could not report the bug. ${message(error)}` }) }
      finally { set({ busy: false }) }
    },
    async refreshGameRunning() {
      try {
        const gameRunning = await platform.isGameRunning()
        const closed = state.gameRunning === true && !gameRunning
        if (state.gameRunning !== null && state.gameRunning !== gameRunning) log.write('info', gameRunning ? 'XIV started' : 'XIV closed')
        if (state.gameRunning !== gameRunning) set({ gameRunning })
        if (state.launching && (gameRunning || Date.now() > launchingUntil)) set({ launching: false })
        if (closed) await refreshKeybinds()
      } catch { if (state.gameRunning !== null) set({ gameRunning: null }) }
    },
    async scan() {
      if (state.busy) return
      scanned = null
      reviewedPaths = null
      notedHealth = null
      set({ busy: true, error: null, plan: null, existingSetups: [], folderChanges: null, deployment: null, keybinds: null, versions: [], profiles: [], selectedProfile: null, activity: { kind: 'scan' }, gameFolder: { status: 'scanning' }, rejectedFolder: null, graphics: { status: 'scanning' }, manifest: { status: 'loading' }, xivLauncher: { status: 'scanning' } })
      let resume: GameWriteRequest | null = null
      try {
        const context = await takeElevationResume(platform)
        if (context) { playerLocalAppData = context.localAppData; resume = context.request }
        await openLog(!!context)
        await core.refreshGameRunning()
        if (!await recover()) return
        await refreshScreen()
        // Recovery precedes all startup work, including cleanup of the last app update.
        await cleanupOldExe(platform)
        await checkSelfInstall()
        // The channel decides which app and content versions the announcements below look at.
        const settings = await readSettings(platform)
        set({ channel: settings.channel, updateCheck: { status: settings.lastUpdateCheck ? 'checked' : 'idle', checkedAt: settings.lastUpdateCheck?.checkedAt ?? null,
          error: null, outcome: settings.lastUpdateCheck ? { channel: settings.lastUpdateCheck.channel, appVersion: settings.lastUpdateCheck.appVersion, contentVersion: settings.lastUpdateCheck.contentVersion } : null } })
        // A folder the player picked by hand outranks the auto-detected ones, on every Scan.
        const picked = settings.gameFolder ? await checkPickedFolder(platform, settings.gameFolder) : null
        const [found, graphics, manifest, xivLauncher] = await Promise.all([
          picked ? Promise.resolve(picked) : findGameFolder(platform), scanGraphics(platform), loadManifest(platform), scanXivLauncher(platform),
        ])
        if (graphics.status === 'found' && manifest.status === 'ready') graphics.tier = matchTier(graphics.adapter, manifest.manifest)
        set({ gameFolder: found ? { status: 'found', ...found } : { status: 'not-found' }, graphics, manifest, xivLauncher })
        const folder = resume ? await checkPickedFolder(platform, resume.gameFolder) : found
        if (resume && !folder) throw new Error('The game folder from the administrator request no longer contains XIV.')
        if (folder) set({ gameFolder: { status: 'found', ...folder } })
        for (const line of scanLines(state)) log.write(line.level, line.text)
        if (folder) await restoreDeployment(folder)
        else if (showLostDeployment && !resume) {
          const lost = await lostDeployment(platform)
          if (lost) log.write('warning', `Game folder missing: ${lost.gameFolder}`)
          if (lost) set({ gameFolder: { status: 'missing', path: lost.gameFolder }, deployment: lost, profiles: profilesForRecipe(lost.recipe), selectedProfile: lost.profile ?? null, recommendedProfile: null, includeReShade: lost.includeReShade, activity: deploymentActivity(lost, null, null) })
        }
        if (!state.deployment && manifest.status === 'ready' && graphics.status === 'found' && graphics.tier) {
          const content = newestContentForTier()
          if (content) prepareProfiles(content)
          await refreshFolderChanges()
        }
        await refreshUpdateCheck(false, manifest)
      } catch (error) { set({ error: state.recoveryRequired ? state.error : message(error) }) }
      finally { set({ busy: false }) }
      if (resume && !state.error && !state.recoveryRequired) {
        try {
          if (resume.kind === 'deploy') {
            resumeContentVersion = resume.contentVersion
            resumeReviewedPaths = resume.reviewedPaths
            prepareProfiles(contentForTier())
            // The player's own process already self-installed before asking for admin access.
            set({ selectedProfile: resume.profile, includeReShade: resume.includeReShade, addToStartMenu: false })
            await core.review(resume.includeReShade)
            if (!state.error) await core.deploy()
          } else if (resume.kind === 'enabled') await core.setEnabled(resume.enabled)
          else if (resume.kind === 'repair') await core.repair()
          else if (resume.kind === 'uninstall') await core.uninstall()
          else if (resume.kind === 'update') await core.applyVersion(resume.contentVersion)
          else if (resume.kind === 'tier') await core.switchTier()
        } catch (error) { set({ error: message(error) }) }
        finally { resumeContentVersion = null; resumeReviewedPaths = null }
      }
    },
    async findGameFolder() {
      if (state.gameFolder.status !== 'missing') return
      showLostDeployment = false
      try { await core.scan() } finally { showLostDeployment = true }
    },
    async chooseGameFolder() {
      if (state.busy || state.activity.kind !== 'scan') return
      set({ busy: true })
      try {
        if (!await recover()) return
        const picked = await platform.pickFolder({ title: 'Choose the game folder' })
        if (picked === null) return
        const folder = await checkPickedFolder(platform, picked)
        // Remember the pick, so later Scans (channel changes, restarts, an uninstall) return to this folder.
        if (folder) await writeSettings(platform, { ...await readSettings(platform), gameFolder: folder.path })
        log.write(folder ? 'info' : 'warning', folder ? `Game folder chosen: ${folder.path}` : `Not a game folder: ${picked}`)
        set(folder ? { gameFolder: { status: 'found', ...folder }, rejectedFolder: null, error: null, deployment: null, plan: null, existingSetups: [], folderChanges: null } : { rejectedFolder: picked })
        if (folder) await restoreDeployment(folder)
      } catch (error) { set({ error: state.recoveryRequired ? state.error : message(error) }) }
      finally { set({ busy: false }) }
    },
    async continueSetup() {
      if (state.busy || state.deployment || state.recoveryRequired || state.activity.kind !== 'scan') return
      try {
        prepareProfiles(contentForTier())
        if (setupChoices(state).any) set({ activity: { kind: 'profile' }, error: null })
        else await core.review()
      } catch (error) { set({ error: message(error) }) }
    },
    async selectProfile(profile) {
      if (state.busy || state.recoveryRequired || state.activity.kind !== 'profile' || !state.profiles.some((p) => p.id === profile)) return
      set({ selectedProfile: profile, error: null })
    },
    async setEnabled(enabled) {
      if (state.busy || state.recoveryRequired || state.activity.kind !== 'deployment' || !state.deployment) return
      set({ busy: true, error: null })
      try {
        if (!await prepareWrite({ kind: 'enabled', gameFolder: state.deployment.gameFolder, enabled })) return
        await refreshHealth(state.deployment)
        const deployment = await setDeploymentEnabled(platform, state.deployment.gameFolder, enabled)
        set({ deployment })
        log.write('info', enabled ? 'Deployment enabled' : 'Deployment disabled')
      } catch (error) { set({ error: message(error), recoveryRequired: error instanceof DeploymentError && error.recoveryRequired }) }
      finally {
        await refreshHealthAfter()
        if (state.activity.kind === 'deployment' && state.deployment) set({ activity: { ...state.activity, enabled: state.deployment.enabled } })
        set({ busy: false })
      }
    },
    async repair() {
      const { activity, deployment, manifest } = state
      if (state.busy || state.recoveryRequired || activity.kind !== 'deployment' || !deployment) return
      set({ busy: true, error: null, notice: null, deploymentProgress: null, activity: { ...activity, operation: 'repair' } })
      let record = deployment
      try {
        await requireGameStopped(platform, (gameRunning) => set({ gameRunning }))
        const drift = await refreshHealth(record, true)
        if (!drift) log.write('info', 'Repair: nothing to repair')
        else {
          if (!await prepareWrite({ kind: 'repair', gameFolder: record.gameFolder }, drift.files)) return
          log.write('info', `Repair: ${fileCount(drift.files.length)}`)
          const content = manifest.status === 'ready' ? manifest.manifest.versions.find((v) => v.id === record.contentVersion) ?? null : null
          record = await repairDeployment(platform, record.gameFolder, drift.files, content, manifest.status === 'ready' ? manifest.source : null,
            loggedProgress(log, pacedProgress((progress) => set({ deploymentProgress: progress }))))
          set({ deployment: record })
          log.write('success', 'Repair finished')
        }
      } catch (error) {
        set(error instanceof DeploymentError
          ? { error: error.message, recoveryRequired: error.recoveryRequired }
          : { error: record !== deployment ? `${failureReason(error)} The repair itself finished; run Scan to check the deployment.` : `${failureReason(error)} The game folder has not been changed.` })
      }
      finally {
        await refreshHealthAfter(true)
        if (state.activity.kind === 'deployment') set({ activity: { ...state.activity, operation: null } })
        set({ busy: false, deploymentProgress: null })
      }
    },
    async checkFiles() {
      const { activity, deployment, gameFolder } = state
      if (state.busy || state.recoveryRequired || activity.kind !== 'deployment' || !deployment || gameFolder.status !== 'found') return
      // Reading files is safe while XIV runs, so Scan doesn't wait for the game to close.
      set({ busy: true, error: null, notice: null, deploymentProgress: null, activity: { ...activity, operation: 'scan' } })
      try {
        const record = await readDeployment(platform, gameFolder.path)
        if (record?.status !== 'complete') throw new Error('The deployment record is no longer complete. Reopen Lucent to recover it.')
        const report = loggedProgress(log, pacedProgress((progress: DeploymentProgress) => set({ deploymentProgress: progress })))
        const drift = await refreshHealth(record, true, (done, total) => report({ phase: 'checking', progress: total ? done / total : 1, file: null, done, total }))
        set({ deployment: record })
        await refreshLaunch(gameFolder, false)
        await refreshKeybinds()
        const files = Object.keys(record.files).length
        if (!drift) set({ notice: `Scan checked ${files.toLocaleString('en')} ${files === 1 ? 'file' : 'files'}. Everything matches what Lucent deployed.` })
        // The XIV-running card hides drift until the game closes, so say what Scan found.
        else if (state.gameRunning) set({ notice: `Scan found ${drift.files.length === 1 ? '1 file' : `${drift.files.length} files`} to repair. Close XIV, then use Repair.` })
      } catch (error) { set({ error: `Scan couldn’t check the game folder. ${message(error)}` }) }
      finally {
        if (state.activity.kind === 'deployment') set({ activity: { ...state.activity, operation: null } })
        set({ busy: false, deploymentProgress: null })
      }
    },
    async update() {
      if (state.activity.kind === 'deployment' && state.activity.update) await core.applyVersion(state.activity.update.version)
    },
    async switchTier() {
      const { activity, deployment, graphics } = state
      if (state.busy || state.recoveryRequired || activity.kind !== 'deployment' || !deployment || graphics.status !== 'found') return
      const target = tierSwitchTarget(deployment)
      if (target) await changeContent(target.tier.id === deployment.tier ? 'gpu-refresh' : 'tier',
        { kind: 'tier', gameFolder: deployment.gameFolder, tier: target.tier.id, contentVersion: target.content.id }, () => target, graphics.adapter)
    },
    async applyVersion(version) {
      const { activity, deployment } = state
      if (state.busy || state.recoveryRequired || activity.kind !== 'deployment' || !deployment || version === deployment.contentVersion) return
      await changeContent(version < deployment.contentVersion ? 'rollback' : 'update', { kind: 'update', gameFolder: deployment.gameFolder, contentVersion: version }, () => versionSource(deployment, version))
    },
    async updateApp() {
      if (state.busy || state.recoveryRequired || !state.appUpdate) return
      const update = state.appUpdate
      set({ busy: true, error: null, notice: null, appUpdateProgress: 0 })
      log.write('info', `Updating Lucent ${APP_VERSION} to ${update.version}`)
      try {
        const report = pacedProgress((p: { progress: number }) => set({ appUpdateProgress: p.progress }))
        await performAppUpdate(platform, update, (progress) => report({ progress }))
        // The real port relaunches and exits, so this runs only on the fake: the new exe is in place.
        set({ appUpdate: null })
      } catch (error) { set({ error: message(error) }) }
      finally { set({ busy: false, appUpdateProgress: null }) }
    },
    async skipAppUpdate() {
      const update = state.appUpdate
      if (state.busy || !update) return
      set({ busy: true, error: null })
      try {
        const settings = await readSettings(platform)
        await writeSettings(platform, { ...settings, skippedApp: [...new Set([...settings.skippedApp, update.version])] })
        log.write('info', `Skipped Lucent ${update.version}`)
        set({ appUpdate: await announceApp() })
      } catch (error) { set({ error: message(error) }) }
      finally { set({ busy: false }) }
    },
    async skipUpdate() {
      const { activity } = state
      if (state.busy || activity.kind !== 'deployment' || !activity.update) return
      set({ busy: true, error: null })
      try {
        const settings = await readSettings(platform)
        await writeSettings(platform, { ...settings, skippedContent: [...new Set([...settings.skippedContent, activity.update.version])] })
        log.write('info', `Skipped content ${activity.update.version}`)
        await refreshAnnouncement()
      } catch (error) { set({ error: message(error) }) }
      finally { set({ busy: false }) }
    },
    async review(includeReShade = state.includeReShade) {
      if (state.busy || state.deployment || state.recoveryRequired) return
      set({ busy: true, error: null })
      try {
        const content = contentForTier()
        prepareProfiles(content)
        if (state.gameFolder.status !== 'found' || state.graphics.status !== 'found' || !state.graphics.tier) throw new Error('Choose the game folder before continuing.')
        if (!scanned || scanned.gameFolder !== state.gameFolder.path) throw new UnreviewedFilesError([])
        const selection = frameGenerationSelection(content, state.graphics.tier)
        const acknowledged = resumeReviewedPaths ?? planDeployment(content, state.graphics.tier, includeReShade,
          { files: scanned.files, ownedFiles: [], cachedFiles: [], existingSetups: state.existingSetups }, state.selectedProfile, true, selection).filesToBackup
        const scan = await scanDeployment(platform, state.gameFolder.path, content, null, signatures())
        const plan = planDeployment(content, state.graphics.tier, includeReShade, scan, state.selectedProfile, true, selection)
        assertReviewedTakeovers(plan, acknowledged)
        reviewedPaths = [...plan.filesToBackup]
        set({ plan, includeReShade: plan.includeReShade, activity: { kind: 'review' } })
      } catch (error) {
        if (error instanceof UnreviewedFilesError) requireNewScan()
        set({ error: message(error) })
      }
      set({ busy: false })
    },
    setIncludeReShade(include) {
      if (state.busy || state.activity.kind !== 'profile' || include === state.includeReShade) return
      set({ includeReShade: include })
      void refreshFolderChanges()
    },
    setAddToStartMenu(add) { if (!state.busy && (state.activity.kind === 'profile' || state.activity.kind === 'review')) set({ addToStartMenu: add }) },
    backToScan() { if (!state.busy && !state.deployment) { reviewedPaths = null; set({ activity: { kind: 'scan' }, plan: null, error: null }) } },
    backToProfile() { if (!state.busy && !state.deployment) { reviewedPaths = null; set({ activity: { kind: setupChoices(state).any ? 'profile' : 'scan' }, plan: null, error: null }) } },
    async deploy() {
      if (state.busy || state.recoveryRequired || state.activity.kind !== 'review' || !state.plan || !reviewedPaths) return
      const acknowledged = [...reviewedPaths]
      set({ busy: true, error: null, notice: null, activity: { kind: 'deploying', progress: 0 } })
      let installed: DeploymentRecord | null = null
      try {
        if (!await recover()) { set({ activity: { kind: 'review' } }); return }
        const content = contentForTier()
        if (state.gameFolder.status !== 'found' || state.graphics.status !== 'found' || !state.graphics.tier || state.manifest.status !== 'ready') throw new Error('Finish Scan before installing.')
        await refreshScreen()
        const selection = frameGenerationSelection(content, state.graphics.tier, state.plan.frameGenerationMode)
        // As the player, before any admin prompt, so the shortcut and the entry are theirs.
        if (state.addToStartMenu && !state.selfInstalled) await addToStartMenu()
        if (!await prepareWrite({ kind: 'deploy', gameFolder: state.gameFolder.path, contentVersion: content.id, includeReShade: state.includeReShade, profile: state.selectedProfile, reviewedPaths: acknowledged })) {
          set({ activity: { kind: 'review' } }); return
        }
        const since = performance.now()
        log.write('info', `Install: content ${content.id}, ${state.graphics.tier.label} tier${profileNote(state.profiles, state.selectedProfile)}${state.includeReShade ? '' : ', without ReShade'}`)
        const record = await deployContent(platform, state.gameFolder.path, content, signatures(), state.graphics.tier, state.includeReShade, state.selectedProfile, state.graphics.adapter, state.manifest.source, acknowledged,
          loggedProgress(log, pacedProgress((progress) => set({ deploymentProgress: progress, activity: { kind: 'deploying', progress: progress.progress } }))), state.gameFolder.version, selection)
        installed = record
        log.write('success', `Install finished in ${elapsed(since)}`)
        let names: Record<number, string> = {}
        try { names = await platform.getKeyNames(deploymentKeyCodes(record)) } catch { /* The US labels remain available if Windows lookup fails. */ }
        const hotkeys = deploymentHotkeys(record, names)
        deployedDrift = await checkHealth(platform, record, state.gameFolder.version)
        noteHealth(record, deployedDrift)
        set({ deployment: record, activity: { kind: 'done' }, hotkeys })
        await pruneCache(record)
        await refreshVersions()
      } catch (error) {
        const recoveryRequired = state.recoveryRequired || (error instanceof DeploymentError && error.recoveryRequired)
        const needsScan = error instanceof UnreviewedFilesError || error instanceof DeploymentError && error.needsScan
        if (needsScan) { scanned = null; reviewedPaths = null }
        set({
          activity: { kind: recoveryRequired || needsScan ? 'scan' : 'review' }, recoveryRequired, deploymentProgress: null,
          ...(recoveryRequired || needsScan ? { plan: null, folderChanges: null } : {}),
          error: state.recoveryRequired ? state.error : error instanceof DeploymentError ? error.message : installed
            ? `${failureReason(error)} The install itself finished; run Scan to check the deployment.`
            : `${failureReason(error)} The game folder has not been changed.`,
        })
      }
      finally { set({ busy: false }) }
    },
    finish() {
      if (state.activity.kind === 'done' && state.deployment) set({ activity: deploymentActivity(state.deployment, deployedDrift, null) })
      void refreshKeybinds()
    },
    async launchGame() {
      const folder = state.gameFolder
      if (folder.status !== 'found' || !state.launcher || state.gameRunning || state.launching || state.busy) return
      set({ launching: true, error: null, notice: null })
      try {
        if (!await isGameFolder(platform, folder.path)) {
          set({ gameFolder: { status: 'missing', path: folder.path }, launchOptions: [], launcher: null })
          throw new Error('The game folder no longer contains XIV. Find the game folder again before launching.')
        }
        // Configs and executables can change while Lucent stays open. Recheck against this game folder,
        // keeping the player's saved preference even if a different launcher is temporarily needed.
        const options = await launchOptions(platform, folder)
        const launcher = chosenLauncher(options, launcherPreference)
        set({ launchOptions: options, launcher })
        const option = options.find((candidate) => candidate.kind === launcher)
        if (!option) throw new Error('No launcher is available for this game folder. Run Scan again after restoring the launcher.')
        const gameRunning = await platform.isGameRunning()
        set({ gameRunning })
        if (gameRunning) { set({ launching: false }); return }
        if (state.recoveryRequired) throw new Error('Finish recovery before launching XIV.')
        if (!await recover()) { set({ launching: false }); return }
        const current = await readDeployment(platform, folder.path)
        if (current && current.status !== 'complete') throw new Error('Finish recovery before launching XIV.')
        if (current) set({ deployment: current })
        const runningBeforeStart = await platform.isGameRunning()
        set({ gameRunning: runningBeforeStart })
        if (runningBeforeStart) { set({ launching: false }); return }
        log.write('info', `Launching XIV with ${option.kind === 'official' ? 'the ' : ''}${LAUNCH_LABELS[option.kind]}`)
        if (option.kind === 'steam') await platform.openSteamGame(STEAM_GAME_ID)
        else await platform.startProgram(option.path!)
        // Long enough to see it worked; XIVLauncher and Steam then show their own windows.
        launchingUntil = Date.now() + 6000
      } catch (error) { set({ launching: false, error: `Couldn’t start XIV. ${message(error)}` }) }
    },
    async setLauncher(kind) {
      if (state.busy || kind === state.launcher || !state.launchOptions.some((o) => o.kind === kind)) return
      launcherPreference = kind
      set({ launcher: kind })
      log.write('info', `Launch XIV with: ${LAUNCH_LABELS[kind]}`)
      try { await writeSettings(platform, { ...await readSettings(platform), launcher: kind }) }
      catch (error) { set({ notice: `Lucent will use this launcher until you close it, but couldn’t save the choice. ${message(error)}` }) }
    },
    async refreshKeybinds() {
      try { await refreshKeybinds() } catch { /* The last keys read keep showing. */ }
    },
    async uninstall() {
      if (state.busy || state.recoveryRequired || state.activity.kind !== 'deployment' || !state.deployment) return
      const folder = state.gameFolder
      const restored = replacedOriginals(state.deployment).length
      set({ busy: true, error: null, notice: null })
      try {
        if (!await prepareWrite({ kind: 'uninstall', gameFolder: state.deployment.gameFolder })) { set({ busy: false }); return }
        log.write('info', `Uninstall: ${state.deployment.gameFolder}`)
        await uninstallDeployment(platform, state.deployment.gameFolder)
      } catch (error) {
        const recoveryRequired = error instanceof DeploymentError && error.recoveryRequired
        // A half-undone deployment is no longer the one the main screen describes.
        set({ busy: false, error: message(error), recoveryRequired, ...(recoveryRequired ? { deployment: null, plan: null, activity: { kind: 'scan' } } : {}) })
        return
      }
      set({ busy: false, deployment: null, keybinds: null, existingSetups: [], folderChanges: null, hotkeys: [], notice: restored
        ? `Lucent is uninstalled. It put back the ${restored === 1 ? 'file' : `${restored.toLocaleString('en')} files`} it had replaced, so your game folder is as it was before.`
        : 'Lucent is uninstalled. It removed everything it added; it hadn’t replaced any of your files.' })
      await core.scan()
      // Scan may not find a folder the player picked; stay with the one just uninstalled.
      if (!state.deployment && folder.status === 'found') set({ gameFolder: folder, rejectedFolder: null })
    },
    async openAppUninstall() {
      if (state.busy) return
      set({ busy: true, error: null })
      let confirmed = false
      try {
        const context = await takeElevationResume(platform)
        if (context) { playerLocalAppData = context.localAppData; confirmed = context.request !== null }
        await openLog(!!context)
        await core.refreshGameRunning()
      } catch (error) { set({ error: message(error) }) }
      finally { set({ busy: false }) }
      // Admin access is requested only after the player confirmed with "Restore the game folder".
      if (confirmed) await core.uninstallApp(true)
    },
    async uninstallApp(restoreGameFolder) {
      if (state.busy || state.appUninstalled) return
      set({ busy: true, error: null, notice: null })
      log.write('info', restoreGameFolder ? 'Uninstalling Lucent and restoring the game folder' : 'Uninstalling Lucent')
      try {
        if (restoreGameFolder) {
          if (!await recover()) return
          for await (const record of deploymentRecords(platform)) {
            if (record.status !== 'complete') continue
            // A deployment whose game folder is gone has nothing left to restore; skip it and keep uninstalling.
            if (!await isGameFolder(platform, record.gameFolder)) { log.write('warning', `Game folder missing, nothing to restore: ${record.gameFolder}`); continue }
            if (!await prepareWrite({ kind: 'uninstall', gameFolder: record.gameFolder })) return
            await uninstallDeployment(platform, record.gameFolder)
          }
        } else {
          // Removing Lucent must not leave the per-game Windows Auto HDR override behind,
          // even when the player chooses to keep the deployed game files.
          for await (const record of deploymentRecords(platform)) {
            if (record.status !== 'complete') continue
            if (await restoreAutoHdrPreference(platform, record, (gameRunning) => set({ gameRunning }))) log.write('info', 'Restored Windows Auto HDR for XIV')
          }
        }
        // Only now: a failed restore keeps the journal and backups recovery needs.
        const addonNote = await removeXivLauncherAddons(platform)
        await removeSelfInstall(platform)
        const folder = await lucentFolder(platform)
        try { await platform.exitAndRemove([folder]) }
        catch (error) { throw new Error(`Lucent is out of the Start menu and Settings → Apps, but couldn’t remove its folder. Delete ${folder} yourself. ${message(error)}`) }
        set({ appUninstalled: true, notice: addonNote })
      } catch (error) { set({ error: state.recoveryRequired ? state.error : message(error) }) }
      finally { set({ busy: false }) }
    },
  }
  // Internal commands call this raw core and stay inside their caller's lease. Only exposed commands acquire
  // one, preventing a second process from mistaking a live journal for an interrupted deployment.
  let operationActive = false
  const coordinated = <Args extends unknown[]>(command: (...args: Args) => Promise<void>, reloadDeployment = true) => async (...args: Args) => {
    if (operationActive || state.busy) return
    operationActive = true
    try {
      await withOperationLock(platform, async () => {
        // Another idle window may have finished an operation since this one last scanned. Never let a health
        // restamp or a following mutation save that older journal, recipe or profile over the current record.
        if (reloadDeployment && state.deployment?.status === 'complete') {
          const current = await readDeployment(platform, state.deployment.gameFolder)
          if (!current || current.status !== 'complete') {
            set({ activity: { kind: 'scan' }, deployment: null, plan: null, folderChanges: null })
            throw new Error('The deployment changed in another Lucent window. Run Scan again before continuing.')
          }
          set({ deployment: current, profiles: profilesForRecipe(current.recipe), selectedProfile: current.profile ?? null, recommendedProfile: null,
            includeReShade: current.includeReShade,
            ...(state.activity.kind === 'deployment' ? { activity: { ...state.activity, enabled: current.enabled } } : {}) })
        }
        await command(...args)
      })
    }
    catch (error) { set({ error: message(error) }) }
    finally { operationActive = false }
  }
  return {
    ...core,
    scan: coordinated(core.scan, false), chooseGameFolder: coordinated(core.chooseGameFolder), findGameFolder: coordinated(core.findGameFolder, false),
    continueSetup: coordinated(core.continueSetup), review: coordinated(core.review), deploy: coordinated(core.deploy),
    selectProfile: coordinated(core.selectProfile), setEnabled: coordinated(core.setEnabled), repair: coordinated(core.repair), checkFiles: coordinated(core.checkFiles),
    update: coordinated(core.update), applyVersion: coordinated(core.applyVersion), switchTier: coordinated(core.switchTier),
    updateApp: coordinated(core.updateApp), skipAppUpdate: coordinated(core.skipAppUpdate), skipUpdate: coordinated(core.skipUpdate),
    setAutoRepair: coordinated(core.setAutoRepair), setChannel: coordinated(core.setChannel), setLauncher: coordinated(core.setLauncher), launchGame: coordinated(core.launchGame),
    copyDiagnostics: coordinated(core.copyDiagnostics), reportBug: coordinated(core.reportBug),
    uninstall: coordinated(core.uninstall), openAppUninstall: coordinated(core.openAppUninstall, false), uninstallApp: coordinated(core.uninstallApp, false),
  }
}
