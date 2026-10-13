// The core: all of Lucent's domain logic, framework-free. It exposes one observable state and the
// commands the UI calls. It reaches the machine only through the Platform port.
import type { GpuAdapter, Platform } from './platform'
import { checkPickedFolder, findGameFolder, type GameFolder } from './gameFolder'
import { loadManifest, type ManifestState } from './manifest'
import { matchTier, scanGraphics, type GraphicsState } from './graphics'
import { scanXivLauncher, setAutoRepair, type XivLauncherState } from './xivLauncher'
import { changePerformanceProfile, dataPaths, deployContent, deploymentRecords, DeploymentError, failureReason, lostDeployment, readDeployment, recoverDeployments, repairDeployment, scanDeployment, setDeploymentEnabled, undoDeployment, uninstallDeployment, updateDeployment, type DeploymentProgress, type DeploymentRecord } from './deployment'
import { disabledName, fileKey, keptProfile, planDeployment, stepWritePaths, type Plan } from './planner'
import { checkHealth, type Drift } from './health'
import { announcedContent, needsNewerApp, onChannel, type Channel } from './updates'
import { cleanupOldExe, fetchAppUpdate, performAppUpdate, type AppUpdate } from './appUpdate'
export type { AppUpdate } from './appUpdate'
import { readSettings, writeSettings } from './settings'
import { detectExistingSetups, type ExistingSetup } from './existingSetup'
import { joinPath } from './paths'
import { DEFAULT_PROFILE, type ContentVersion, type PerformanceProfile, type ProfileId, type Tier } from '../shared/manifest'
import { bugReportUrl, collectDiagnostics } from './diagnostics'
import { cacheSnapshot, pruneContentCache, versionChoices, type VersionChoice } from './versions'
import { detectCustomProfile, type CustomProfile } from './customProfile'
import { gameWriteAccess, requireGameStopped, takeElevationResume, type GameWriteRequest } from './gameAccess'
import { installedExe, isSelfInstalled, lucentFolder, refreshSelfInstall, removeSelfInstall, selfInstall } from './selfInstall'

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
      operation: 'repair' | 'update' | 'rollback' | 'tier' | null
    }

export interface State {
  activity: Activity
  /** Null when the process check has not succeeded; game writes stay unavailable. */
  gameRunning: boolean | null
  /** App releases are available even before a deployment exists. */
  appUpdate: AppUpdate | null
  /** Null while idle; otherwise the app download/replacement progress from 0 to 1. */
  appUpdateProgress: number | null
  gameFolder: GameFolderState
  /** The last folder the player picked that turned out not to hold the game; null once a pick succeeds. */
  rejectedFolder: string | null
  graphics: GraphicsState
  manifest: ManifestState
  xivLauncher: XivLauncherState
  plan: Plan | null
  /** Mod files Lucent didn't deploy, found by Scan in a folder without a deployment. */
  existingSetups: ExistingSetup[]
  deployment: DeploymentRecord | null
  versions: VersionChoice[]
  deploymentProgress: DeploymentProgress | null
  includeReShade: boolean
  /** Review's "Add Lucent to the Start menu"; Install self-installs when it's on. */
  addToStartMenu: boolean
  /** Lucent is in the Start menu and Settings → Apps, so Review no longer offers it. */
  selfInstalled: boolean
  /** Set once the uninstall from Settings → Apps finishes; the real port has exited by then. */
  appUninstalled: boolean
  profiles: PerformanceProfile[]
  selectedProfile: ProfileId | null
  /** Null unless a user change to one of the selected profile's settings shows the profile as Custom. */
  customProfile: CustomProfile | null
  busy: boolean
  error: string | null
  notice: string | null
  recoveryRequired: boolean
  hotkeys: { key: string; description: string }[]
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
  selectProfile(profile: ProfileId): Promise<void>
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
  /** Opens the uninstall window Settings → Apps starts, continuing a confirmed uninstall after admin access. */
  openAppUninstall(): Promise<void>
  /** Optionally uninstalls every deployment, then removes the shortcut, the Settings → Apps entry, the data folder and the exe. */
  uninstallApp(restoreGameFolder: boolean): Promise<void>
  copyDiagnostics(): Promise<void>
  reportBug(): Promise<void>
  openLink(url: string): Promise<void>
}

const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.1.0'
/** Channel switching arrives with the Beta channel. */
const CHANNEL: Channel = 'stable'

export function createCore(platform: Platform): Core {
  const nativePlatform = platform
  let playerLocalAppData: string | null = null
  platform = new Proxy(nativePlatform, { get(target, key) {
    if (key === 'envFolder') return (folder: Parameters<Platform['envFolder']>[0]) => folder === 'LocalAppData' && playerLocalAppData
      ? Promise.resolve(playerLocalAppData) : target.envFolder(folder)
    return Reflect.get(target, key)
  } })
  let state: State = {
    activity: { kind: 'scan' }, gameRunning: null, appUpdate: null, appUpdateProgress: null, gameFolder: { status: 'idle' }, rejectedFolder: null,
    graphics: { status: 'idle' }, manifest: { status: 'idle' }, xivLauncher: { status: 'idle' },
    plan: null, existingSetups: [], deployment: null, versions: [], deploymentProgress: null, includeReShade: true, addToStartMenu: true, selfInstalled: false, appUninstalled: false, profiles: [], selectedProfile: null, customProfile: null, busy: false, error: null, notice: null, recoveryRequired: false, hotkeys: [],
  }
  const listeners = new Set<() => void>()
  const set = (patch: Partial<State>) => {
    state = { ...state, ...patch }
    for (const l of listeners) l()
  }

  const message = (error: unknown) => error instanceof Error ? error.message : String(error)
  const access = gameWriteAccess(platform, (gameRunning) => set({ gameRunning }))
  /** A cached version rolls back without the manifest; any other comes from the published manifest. */
  const versionSource = (deployment: DeploymentRecord, version: string) => {
    const { manifest } = state
    const cached = deployment.cachedVersions?.find((v) => v.content.id === version)
    const content = cached?.content ?? (manifest.status === 'ready' ? manifest.manifest.versions.find((v) => v.id === version && onChannel(v, CHANNEL)) : null)
    const tier = cached?.tier ?? (manifest.status === 'ready' ? manifest.manifest.tiers.find((t) => t.id === deployment.tier) : null)
    if (!content || !tier) throw new Error('This content version is no longer published. Reopen Lucent to check again.')
    return { content, tier }
  }
  const writeTargets = async (request: GameWriteRequest): Promise<string[]> => {
    if (request.kind === 'deploy') return state.plan?.steps.flatMap(stepWritePaths) ?? []
    const record = await readDeployment(platform, request.gameFolder)
    if (!record) throw new Error('The deployment is no longer available. Run Scan again.')
    if (request.kind === 'profile') return record.recipe.performanceProfiles?.find((p) => p.id === request.profile)?.settings
      .filter((s) => Object.keys(record.ownedConfigs).some((p) => fileKey(p) === fileKey(s.file))).map((s) => s.file) ?? []
    if (request.kind === 'enabled') return record.recipe.entryFiles.filter((p) => p.when !== 'reshade' || record.includeReShade).flatMap((p) => [p.path, disabledName(p.path)])
    if (request.kind === 'update' || request.kind === 'tier') {
      const target = request.kind === 'update' ? versionSource(record, request.contentVersion) : tierSwitchTarget(record)
      if (!target || target.content.id !== request.contentVersion) throw new Error('This content version is no longer published. Reopen Lucent to check again.')
      const scan = await scanDeployment(platform, record.gameFolder, target.content, record, [])
      return planDeployment(target.content, target.tier, record.includeReShade, scan, keptProfile(target.content, target.tier, record.profile), record.enabled).steps.flatMap(stepWritePaths)
    }
    return [...record.journal.slice(request.kind === 'recover' ? record.changeStart ?? 0 : 0).flatMap((entry) => Object.keys(entry.before)),
      ...(record.createdDirectories ?? []), ...(request.kind === 'uninstall' || record.uninstalling ? record.generatedFiles ?? [] : [])]
  }
  const prepareWrite = async (request: GameWriteRequest, targets?: string[]) => {
    if (state.gameFolder.status === 'missing') throw new Error('The game folder is missing. Find it before changing your setup.')
    await requireGameStopped(platform, (gameRunning) => set({ gameRunning }))
    const ready = await access(request, [...new Set(targets ?? await writeTargets(request))])
    if (!ready) set({ notice: 'Lucent is reopening with administrator access to continue your change.' })
    return ready
  }
  class ElevationPending extends Error {}
  let resumeContentVersion: string | null = null
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
  const restoreDeployment = async (folder: GameFolder) => {
    let record = await readDeployment(platform, folder.path)
    if (record?.status === 'applying') {
      if (!await prepareWrite({ kind: 'recover', gameFolder: record.gameFolder })) return
      await undoDeployment(platform, record); record = null
    }
    const files = record?.status === 'complete' ? [] : await platform.listFiles(joinPath(folder.path, 'game'))
    set({ existingSetups: detectExistingSetups(signatures(), files) })
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
      set({ deployment: record, profiles: record.recipe.performanceProfiles ?? [], selectedProfile: record.profile ?? null, includeReShade: record.includeReShade, activity: deploymentActivity(record, drift, update) })
      await refreshCustomProfile()
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
    if (graphics.status !== 'found' || !graphics.tier || graphics.tier.id === record.tier || manifest.status !== 'ready') return null
    const tier = graphics.tier
    const candidates = manifest.manifest.versions.filter((v) => v.tiers[tier.id] && onChannel(v, CHANNEL) && !needsNewerApp(v.minAppVersion, APP_VERSION))
    const content = candidates.find((v) => v.id === record.contentVersion) ?? candidates.sort((a, b) => b.id.localeCompare(a.id))[0]
    return content ? { tier, content } : null
  }
  const tierChange = (record: DeploymentRecord): TierChange | null => {
    const target = tierSwitchTarget(record)
    if (!target || state.graphics.status !== 'found' || state.manifest.status !== 'ready') return null
    const from = state.manifest.manifest.tiers.find((t) => t.id === record.tier)?.label ?? record.cachedVersions?.[0]?.tier.label ?? record.tier
    return { gpu: state.graphics.adapter.name, from, to: target.tier.label }
  }
  /** App releases come from GitHub, never the manifest; a failed fetch announces nothing. */
  const announceApp = async (): Promise<AppUpdate | null> => {
    const { skippedApp } = await readSettings(platform)
    return fetchAppUpdate(platform, { appVersion: APP_VERSION, skipped: skippedApp, channel: CHANNEL })
  }
  /** Checked on open and after an update or a skip; there is no background service. */
  const announceUpdate = async (record: DeploymentRecord): Promise<ContentUpdate | null> => {
    if (state.manifest.status !== 'ready') return null
    const { manifest } = state.manifest
    const { skippedContent } = await readSettings(platform)
    const content = announcedContent(manifest, { channel: CHANNEL, tier: record.tier, current: record.contentVersion, skipped: [...skippedContent, ...(record.pendingSelection?.skip ? [record.pendingSelection.skip] : [])], appVersion: APP_VERSION })
    const tier = manifest.tiers.find((t) => t.id === record.tier)
    if (!content || !tier) return null
    const scan = await scanDeployment(platform, record.gameFolder, content, record, [])
    const plan = planDeployment(content, tier, record.includeReShade, scan, record.profile ?? null, record.enabled)
    return { version: content.id, changelog: content.changelog, downloadSize: plan.downloadSize }
  }
  /** The health check right after a deployment, shown once the player leaves Done. */
  let deployedDrift: Drift | null = null
  /** Runs the health check before and after every command that writes to the game folder. */
  const refreshHealth = async (record: DeploymentRecord, full = false) => {
    const version = state.gameFolder.status === 'found' ? state.gameFolder.version : null
    const drift = await checkHealth(platform, record, version, full)
    if (state.activity.kind === 'deployment') set({ activity: { ...state.activity, drift } })
    return drift
  }
  /** Shows the profile as Custom while the deployed configs hold a changed value of its settings. */
  const refreshCustomProfile = async () => {
    if (state.deployment?.status !== 'complete' || state.gameFolder.status !== 'found') return
    try {
      const customProfile = await detectCustomProfile(platform, state.deployment)
      if (JSON.stringify(customProfile) !== JSON.stringify(state.customProfile)) set({ customProfile })
    } catch { /* The last result keeps showing; configs that can't be read are the health check's concern. */ }
  }
  /** After a command, whether it succeeded or was undone, checks the deployment as it now stands on disk. */
  const refreshHealthAfter = async (full = false) => {
    if (state.recoveryRequired || state.gameFolder.status !== 'found') return
    try {
      const record = await readDeployment(platform, state.gameFolder.path)
      if (record?.status === 'complete') { set({ deployment: record }); await refreshHealth(record, full); await refreshCustomProfile() }
    } catch { /* A failed check leaves the last result showing; the command's own error already explains. */ }
  }
  const refreshAnnouncement = async () => {
    if (state.activity.kind !== 'deployment' || !state.deployment) return
    try {
      const [update, appUpdate] = await Promise.all([announceUpdate(state.deployment), announceApp()])
      if (state.activity.kind === 'deployment') set({ activity: { ...state.activity, update }, appUpdate })
      await refreshVersions()
    } catch { /* The card keeps the last announcement; Update explains any failure. */ }
  }
  const refreshVersions = async () => {
    if (!state.deployment) { set({ versions: [] }); return }
    set({ versions: await versionChoices(platform, state.deployment, state.manifest.status === 'ready' ? state.manifest.manifest : null, await readSettings(platform), CHANNEL, APP_VERSION) })
  }
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
    return state.manifest.manifest.versions.filter((v) => v.channel === 'stable' && v.tiers[tier.id]).sort((a, b) => b.id.localeCompare(a.id))[0]
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
    const profiles = content.tiers[state.graphics.tier.id].performanceProfiles ?? []
    const selectedProfile = profiles.some((p) => p.id === state.selectedProfile) ? state.selectedProfile : profiles.find((p) => p.id === DEFAULT_PROFILE)?.id ?? null
    set({ profiles, selectedProfile })
  }
  /** Moves the deployment to other content, a version or a tier, through the update path, then checks it again. */
  const changeContent = async (operation: 'update' | 'rollback' | 'tier', request: GameWriteRequest, target: () => { content: ContentVersion; tier: Tier }, graphics?: GpuAdapter) => {
    const { activity, deployment, manifest } = state
    if (activity.kind !== 'deployment' || !deployment) return
    set({ busy: true, error: null, notice: null, deploymentProgress: null, activity: { ...activity, operation } })
    try {
      if (!await prepareWrite(request)) return
      await refreshHealth(deployment)
      const { content, tier } = target()
      if (needsNewerApp(content.minAppVersion, APP_VERSION)) throw new Error('Update Lucent before applying this content version.')
      const record = await updateDeployment(platform, deployment.gameFolder, content, tier, manifest.status === 'ready' ? manifest.source : { kind: 'github' }, (progress) => set({ deploymentProgress: progress }), graphics)
      set({ deployment: record, profiles: record.recipe.performanceProfiles ?? [], selectedProfile: record.profile ?? null, includeReShade: record.includeReShade })
      try { await finishSelection(record) }
      catch (error) { set({ notice: `Content ${record.contentVersion} is applied. Lucent will finish saving your version choice when you reopen it. ${message(error)}` }) }
      await pruneCache(record)
    } catch (error) {
      set(error instanceof DeploymentError
        ? { error: error.message, recoveryRequired: error.recoveryRequired }
        : { error: `${failureReason(error)} The game folder has not been changed.` })
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
        await platform.copyText(await collectDiagnostics(platform, state, APP_VERSION, CHANNEL))
        set({ notice: 'Diagnostics copied to the clipboard.' })
      } catch (error) { set({ error: `Could not copy diagnostics. ${message(error)}` }) }
      finally { set({ busy: false }) }
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
      } catch (error) { set({ error: `Could not change auto-repair. ${message(error)}` }) }
      finally { set({ busy: false }) }
    },
    async reportBug() {
      if (state.busy) return
      set({ busy: true, error: null, notice: null })
      try {
        await platform.copyText(await collectDiagnostics(platform, state, APP_VERSION, CHANNEL))
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
        if (state.gameRunning !== gameRunning) set({ gameRunning })
        if (closed) await refreshCustomProfile()
      } catch { if (state.gameRunning !== null) set({ gameRunning: null }) }
    },
    async scan() {
      if (state.busy) return
      set({ busy: true, error: null, plan: null, existingSetups: [], deployment: null, versions: [], profiles: [], selectedProfile: null, customProfile: null, activity: { kind: 'scan' }, gameFolder: { status: 'scanning' }, rejectedFolder: null, graphics: { status: 'scanning' }, manifest: { status: 'loading' }, xivLauncher: { status: 'scanning' } })
      let resume: GameWriteRequest | null = null
      try {
        const context = await takeElevationResume(platform)
        if (context) { playerLocalAppData = context.localAppData; resume = context.request }
        await core.refreshGameRunning()
        if (!await recover()) return
        // Recovery precedes all startup work, including cleanup of the last app update.
        await cleanupOldExe(platform)
        await checkSelfInstall()
        const [found, graphics, manifest, xivLauncher, appUpdate] = await Promise.all([
          findGameFolder(platform), scanGraphics(platform), loadManifest(platform), scanXivLauncher(platform), announceApp(),
        ])
        if (graphics.status === 'found' && manifest.status === 'ready') graphics.tier = matchTier(graphics.adapter, manifest.manifest)
        set({ gameFolder: found ? { status: 'found', ...found } : { status: 'not-found' }, graphics, manifest, xivLauncher, appUpdate })
        const folder = resume ? await checkPickedFolder(platform, resume.gameFolder) : found
        if (resume && !folder) throw new Error('The game folder from the administrator request no longer contains XIV.')
        if (folder) {
          set({ gameFolder: { status: 'found', ...folder } })
          await restoreDeployment(folder)
        } else if (showLostDeployment && !resume) {
          const lost = await lostDeployment(platform)
          if (lost) set({ gameFolder: { status: 'missing', path: lost.gameFolder }, deployment: lost, profiles: lost.recipe.performanceProfiles ?? [], selectedProfile: lost.profile ?? null, customProfile: null, includeReShade: lost.includeReShade, activity: deploymentActivity(lost, null, null) })
        }
        if (!state.deployment && manifest.status === 'ready' && graphics.status === 'found' && graphics.tier) {
          const content = newestContentForTier()
          if (content) prepareProfiles(content)
        }
      } catch (error) { set({ error: state.recoveryRequired ? state.error : message(error) }) }
      finally { set({ busy: false }) }
      if (resume && !state.error && !state.recoveryRequired) {
        try {
          if (resume.kind === 'deploy') {
            resumeContentVersion = resume.contentVersion
            prepareProfiles(contentForTier())
            // The player's own process already self-installed before asking for admin access.
            set({ selectedProfile: resume.profile, includeReShade: resume.includeReShade, addToStartMenu: false })
            await core.review(resume.includeReShade)
            if (!state.error) await core.deploy()
          } else if (resume.kind === 'profile') await core.selectProfile(resume.profile)
          else if (resume.kind === 'enabled') await core.setEnabled(resume.enabled)
          else if (resume.kind === 'repair') await core.repair()
          else if (resume.kind === 'uninstall') await core.uninstall()
          else if (resume.kind === 'update') await core.applyVersion(resume.contentVersion)
          else if (resume.kind === 'tier') await core.switchTier()
        } catch (error) { set({ error: message(error) }) }
        finally { resumeContentVersion = null }
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
        set(folder ? { gameFolder: { status: 'found', ...folder }, rejectedFolder: null, error: null, deployment: null, customProfile: null, plan: null, existingSetups: [] } : { rejectedFolder: picked })
        if (folder) await restoreDeployment(folder)
      } catch (error) { set({ error: state.recoveryRequired ? state.error : message(error) }) }
      finally { set({ busy: false }) }
    },
    async continueSetup() {
      if (state.busy || state.deployment || state.recoveryRequired || state.activity.kind !== 'scan') return
      try {
        prepareProfiles(contentForTier())
        if (state.profiles.length) set({ activity: { kind: 'profile' }, error: null })
        else await core.review()
      } catch (error) { set({ error: message(error) }) }
    },
    async selectProfile(profile) {
      if (state.busy || state.recoveryRequired || !state.profiles.some((p) => p.id === profile)) return
      if (state.activity.kind === 'profile') { set({ selectedProfile: profile, error: null }); return }
      if (state.activity.kind !== 'deployment' || !state.deployment) return
      set({ busy: true, error: null })
      try {
        if (!await prepareWrite({ kind: 'profile', gameFolder: state.deployment.gameFolder, profile })) return
        await refreshHealth(state.deployment)
        const deployment = await changePerformanceProfile(platform, state.deployment.gameFolder, profile)
        set({ deployment, selectedProfile: profile })
      } catch (error) { set({ error: message(error), recoveryRequired: error instanceof DeploymentError && error.recoveryRequired }) }
      finally {
        await refreshHealthAfter()
        set({ busy: false })
      }
    },
    async setEnabled(enabled) {
      if (state.busy || state.recoveryRequired || state.activity.kind !== 'deployment' || !state.deployment) return
      set({ busy: true, error: null })
      try {
        if (!await prepareWrite({ kind: 'enabled', gameFolder: state.deployment.gameFolder, enabled })) return
        await refreshHealth(state.deployment)
        const deployment = await setDeploymentEnabled(platform, state.deployment.gameFolder, enabled)
        set({ deployment })
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
        if (drift) {
          if (!await prepareWrite({ kind: 'repair', gameFolder: record.gameFolder }, drift.files)) return
          const content = manifest.status === 'ready' ? manifest.manifest.versions.find((v) => v.id === record.contentVersion) ?? null : null
          record = await repairDeployment(platform, record.gameFolder, drift.files, content, manifest.status === 'ready' ? manifest.source : null,
            (progress) => set({ deploymentProgress: progress }))
          set({ deployment: record })
        }
      } catch (error) {
        set(error instanceof DeploymentError
          ? { error: error.message, recoveryRequired: error.recoveryRequired }
          : { error: `${failureReason(error)} The game folder has not been changed.` })
      }
      finally {
        await refreshHealthAfter(true)
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
      if (target) await changeContent('tier', { kind: 'tier', gameFolder: deployment.gameFolder, tier: target.tier.id, contentVersion: target.content.id }, () => target, graphics.adapter)
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
      try {
        await performAppUpdate(platform, update, (appUpdateProgress) => set({ appUpdateProgress }))
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
        const scan = await scanDeployment(platform, state.gameFolder.path, content, null, signatures())
        const plan = planDeployment(content, state.graphics.tier, includeReShade, scan, state.selectedProfile)
        set({ plan, includeReShade: plan.includeReShade, activity: { kind: 'review' } })
      } catch (error) { set({ error: message(error) }) }
      set({ busy: false })
    },
    setAddToStartMenu(add) { if (!state.busy && state.activity.kind === 'review') set({ addToStartMenu: add }) },
    backToScan() { if (!state.busy && !state.deployment) set({ activity: { kind: 'scan' }, plan: null, error: null }) },
    backToProfile() { if (!state.busy && !state.deployment) set({ activity: { kind: state.profiles.length ? 'profile' : 'scan' }, plan: null, error: null }) },
    async deploy() {
      if (state.busy || state.recoveryRequired || state.activity.kind !== 'review' || !state.plan || state.plan.blockedPaths.length) return
      set({ busy: true, error: null, notice: null, activity: { kind: 'deploying', progress: 0 } })
      try {
        if (!await recover()) { set({ activity: { kind: 'review' } }); return }
        const content = contentForTier()
        if (state.gameFolder.status !== 'found' || state.graphics.status !== 'found' || !state.graphics.tier || state.manifest.status !== 'ready') throw new Error('Finish Scan before installing.')
        // As the player, before any admin prompt, so the shortcut and the entry are theirs.
        if (state.addToStartMenu && !state.selfInstalled) await addToStartMenu()
        if (!await prepareWrite({ kind: 'deploy', gameFolder: state.gameFolder.path, contentVersion: content.id, includeReShade: state.includeReShade, profile: state.selectedProfile })) {
          set({ activity: { kind: 'review' } }); return
        }
        const record = await deployContent(platform, state.gameFolder.path, content, signatures(), state.graphics.tier, state.includeReShade, state.selectedProfile, state.graphics.adapter, state.manifest.source,
          (progress) => set({ deploymentProgress: progress, activity: { kind: 'deploying', progress: progress.progress } }))
        const hotkeys = []
        if (record.recipe.overlay) hotkeys.push({ key: 'Insert', description: record.recipe.overlay === 'neural-rendering' ? 'OptiScaler · Neural Rendering and upscaling' : 'OptiScaler · FSR upscaling and frame generation' })
        if (record.includeReShade) hotkeys.push({ key: 'Home', description: 'ReShade · shaders and presets' })
        deployedDrift = await checkHealth(platform, record, state.gameFolder.version, true)
        set({ deployment: record, activity: { kind: 'done' }, hotkeys })
        await pruneCache(record)
        await refreshVersions()
      } catch (error) {
        const recoveryRequired = state.recoveryRequired || (error instanceof DeploymentError && error.recoveryRequired)
        set({
          activity: { kind: recoveryRequired ? 'scan' : 'review' }, recoveryRequired, deploymentProgress: null,
          ...(recoveryRequired ? { plan: null } : {}),
          error: state.recoveryRequired ? state.error : error instanceof DeploymentError ? error.message : `${failureReason(error)} The game folder has not been changed.`,
        })
      }
      finally { set({ busy: false }) }
    },
    finish() {
      if (state.activity.kind === 'done' && state.deployment) set({ activity: deploymentActivity(state.deployment, deployedDrift, null) })
    },
    async uninstall() {
      if (state.busy || state.recoveryRequired || state.activity.kind !== 'deployment' || !state.deployment) return
      const folder = state.gameFolder
      set({ busy: true, error: null, notice: null })
      try {
        if (!await prepareWrite({ kind: 'uninstall', gameFolder: state.deployment.gameFolder })) { set({ busy: false }); return }
        await uninstallDeployment(platform, state.deployment.gameFolder)
      } catch (error) {
        const recoveryRequired = error instanceof DeploymentError && error.recoveryRequired
        // A half-undone deployment is no longer the one the main screen describes.
        set({ busy: false, error: message(error), recoveryRequired, ...(recoveryRequired ? { deployment: null, customProfile: null, plan: null, activity: { kind: 'scan' } } : {}) })
        return
      }
      set({ busy: false, deployment: null, customProfile: null, existingSetups: [], hotkeys: [], notice: 'Lucent is uninstalled. Your game folder is as it was before.' })
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
        await core.refreshGameRunning()
      } catch (error) { set({ error: message(error) }) }
      finally { set({ busy: false }) }
      // Admin access is requested only after the player confirmed with "Restore the game folder".
      if (confirmed) await core.uninstallApp(true)
    },
    async uninstallApp(restoreGameFolder) {
      if (state.busy || state.appUninstalled) return
      set({ busy: true, error: null, notice: null })
      try {
        if (restoreGameFolder) {
          if (!await recover()) return
          for await (const record of deploymentRecords(platform)) {
            if (record.status !== 'complete') continue
            if (!await prepareWrite({ kind: 'uninstall', gameFolder: record.gameFolder })) return
            await uninstallDeployment(platform, record.gameFolder)
          }
        }
        // Only now: a failed restore keeps the journal and backups recovery needs.
        await removeSelfInstall(platform)
        const folder = await lucentFolder(platform)
        try { await platform.exitAndRemove([folder]) }
        catch (error) { throw new Error(`Lucent is out of the Start menu and Settings → Apps, but couldn’t remove its folder. Delete ${folder} yourself. ${message(error)}`) }
        set({ appUninstalled: true, notice: 'Lucent is uninstalled.' })
      } catch (error) { set({ error: state.recoveryRequired ? state.error : message(error) }) }
      finally { set({ busy: false }) }
    },
  }
  return core
}
