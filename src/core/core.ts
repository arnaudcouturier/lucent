// The core: all of Lucent's domain logic, framework-free. It exposes one observable state and the
// commands the UI calls. It reaches the machine only through the Platform port.
import type { Platform } from './platform'
import { checkPickedFolder, findGameFolder, type GameFolder } from './gameFolder'
import { loadManifest, type ManifestState } from './manifest'
import { matchTier, scanGraphics, type GraphicsState } from './graphics'
import { scanXivLauncher, type XivLauncherState } from './xivLauncher'
import { changePerformanceProfile, deployContent, DeploymentError, failureReason, readDeployment, recoverDeployments, repairDeployment, scanDeployment, setDeploymentEnabled, undoDeployment, uninstallDeployment, updateDeployment, type DeploymentProgress, type DeploymentRecord } from './deployment'
import { disabledName, fileKey, planDeployment, stepWritePaths, type Plan } from './planner'
import { checkHealth, type Drift } from './health'
import { announcedContent, needsNewerApp, type Channel } from './updates'
import { cleanupOldExe, fetchAppUpdate, performAppUpdate, type AppUpdate } from './appUpdate'
export type { AppUpdate } from './appUpdate'
import { readSettings, writeSettings } from './settings'
import { detectExistingSetups, type ExistingSetup } from './existingSetup'
import { joinPath } from './paths'
import { DEFAULT_PROFILE, type ContentVersion, type PerformanceProfile, type ProfileId } from '../shared/manifest'
import { gameWriteAccess, requireGameStopped, takeElevationResume, type GameWriteRequest } from './gameAccess'

/** A content version the status card announces. Nothing downloads until the player clicks Update. */
export interface ContentUpdate {
  version: string
  changelog: string[]
  /** The size of the files the update needs that aren't cached yet. */
  downloadSize: number
}

export type GameFolderState = { status: 'idle' } | { status: 'scanning' } | ({ status: 'found' } & GameFolder) | { status: 'not-found' }

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
      operation: 'repair' | 'update' | 'rollback' | null
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
  deploymentProgress: DeploymentProgress | null
  includeReShade: boolean
  profiles: PerformanceProfile[]
  selectedProfile: ProfileId | null
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
  continueSetup(): Promise<void>
  selectProfile(profile: ProfileId): Promise<void>
  review(includeReShade?: boolean): Promise<void>
  backToScan(): void
  backToProfile(): void
  deploy(): Promise<void>
  finish(): void
  /** Switches the deployment between Enabled and Disabled, renaming its entry files through the journal. */
  setEnabled(enabled: boolean): Promise<void>
  /** Re-applies the deployment so that no drift remains, then checks its health again. */
  repair(): Promise<void>
  /** Moves the deployment to the announced content version, then checks its health again. */
  update(): Promise<void>
  /** Downloads the announced app version, verifies it, replaces the running exe and relaunches. */
  updateApp(): Promise<void>
  /** Stops announcing the announced app version. */
  skipAppUpdate(): Promise<void>
  /** Stops announcing the announced content version. */
  skipUpdate(): Promise<void>
  /** Undoes the deployment, leaving the game folder vanilla, then returns to Scan. */
  uninstall(): Promise<void>
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
    plan: null, existingSetups: [], deployment: null, deploymentProgress: null, includeReShade: true, profiles: [], selectedProfile: null, busy: false, error: null, notice: null, recoveryRequired: false, hotkeys: [],
  }
  const listeners = new Set<() => void>()
  const set = (patch: Partial<State>) => {
    state = { ...state, ...patch }
    for (const l of listeners) l()
  }

  const message = (error: unknown) => error instanceof Error ? error.message : String(error)
  const access = gameWriteAccess(platform, (gameRunning) => set({ gameRunning }))
  const writeTargets = async (request: GameWriteRequest): Promise<string[]> => {
    if (request.kind === 'deploy') return state.plan?.steps.flatMap(stepWritePaths) ?? []
    const record = await readDeployment(platform, request.gameFolder)
    if (!record) throw new Error('The deployment is no longer available. Run Scan again.')
    if (request.kind === 'profile') return record.recipe.performanceProfiles?.find((p) => p.id === request.profile)?.settings
      .filter((s) => Object.keys(record.ownedConfigs).some((p) => fileKey(p) === fileKey(s.file))).map((s) => s.file) ?? []
    if (request.kind === 'enabled') return record.recipe.entryFiles.filter((p) => p.when !== 'reshade' || record.includeReShade).flatMap((p) => [p.path, disabledName(p.path)])
    if (request.kind === 'update' && state.manifest.status === 'ready') {
      const content = state.manifest.manifest.versions.find((v) => v.id === request.contentVersion)
      const tier = state.manifest.manifest.tiers.find((t) => t.id === record.tier)
      if (!content || !tier) throw new Error('This content version is no longer published.')
      const scan = await scanDeployment(platform, record.gameFolder, content, record, [])
      return planDeployment(content, tier, record.includeReShade, scan, record.profile ?? null, record.enabled).steps.flatMap(stepWritePaths)
    }
    return [...record.journal.slice(request.kind === 'recover' ? record.changeStart ?? 0 : 0).flatMap((entry) => Object.keys(entry.before)),
      ...(record.createdDirectories ?? []), ...(request.kind === 'uninstall' || record.uninstalling ? record.generatedFiles ?? [] : [])]
  }
  const prepareWrite = async (request: GameWriteRequest, targets?: string[]) => {
    await requireGameStopped(platform, (gameRunning) => set({ gameRunning }))
    const ready = await access(request, [...new Set(targets ?? await writeTargets(request))])
    if (!ready) set({ notice: 'Lucent is reopening with administrator access to continue your change.' })
    return ready
  }
  class ElevationPending extends Error {}
  let resumeContentVersion: string | null = null
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
      const drift = await checkHealth(platform, record, folder.version)
      // A version that can't be planned is never announced; it must not keep the deployment from opening.
      const update = await announceUpdate(record).catch(() => null)
      set({ deployment: record, profiles: record.recipe.performanceProfiles ?? [], selectedProfile: record.profile ?? null, includeReShade: record.includeReShade, activity: deploymentActivity(record, drift, update) })
    }
  }
  const deploymentActivity = (record: DeploymentRecord, drift: Drift | null, update: ContentUpdate | null): Activity =>
    ({ kind: 'deployment', enabled: record.enabled, drift, update, operation: null })
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
    const content = announcedContent(manifest, { channel: CHANNEL, tier: record.tier, current: record.contentVersion, skipped: skippedContent, appVersion: APP_VERSION })
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
  /** After a command, whether it succeeded or was undone, checks the deployment as it now stands on disk. */
  const refreshHealthAfter = async (full = false) => {
    if (state.recoveryRequired || state.gameFolder.status !== 'found') return
    try {
      const record = await readDeployment(platform, state.gameFolder.path)
      if (record?.status === 'complete') { set({ deployment: record }); await refreshHealth(record, full) }
    } catch { /* A failed check leaves the last result showing; the command's own error already explains. */ }
  }
  const refreshAnnouncement = async () => {
    if (state.activity.kind !== 'deployment' || !state.deployment) return
    try {
      const [update, appUpdate] = await Promise.all([announceUpdate(state.deployment), announceApp()])
      if (state.activity.kind === 'deployment') set({ activity: { ...state.activity, update }, appUpdate })
    } catch { /* The card keeps the last announcement; Update explains any failure. */ }
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
  const core: Core = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async refreshGameRunning() {
      try {
        const gameRunning = await platform.isGameRunning()
        if (state.gameRunning !== gameRunning) set({ gameRunning })
      } catch { if (state.gameRunning !== null) set({ gameRunning: null }) }
    },
    async scan() {
      if (state.busy) return
      set({ busy: true, error: null, plan: null, existingSetups: [], deployment: null, profiles: [], selectedProfile: null, activity: { kind: 'scan' }, gameFolder: { status: 'scanning' }, rejectedFolder: null, graphics: { status: 'scanning' }, manifest: { status: 'loading' }, xivLauncher: { status: 'scanning' } })
      let resume: GameWriteRequest | null = null
      try {
        const context = await takeElevationResume(platform)
        if (context) { playerLocalAppData = context.localAppData; resume = context.request }
        await core.refreshGameRunning()
        if (!await recover()) return
        // Recovery precedes all startup work, including cleanup of the last app update.
        await cleanupOldExe(platform)
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
            set({ selectedProfile: resume.profile, includeReShade: resume.includeReShade })
            await core.review(resume.includeReShade)
            if (!state.error) await core.deploy()
          } else if (resume.kind === 'profile') await core.selectProfile(resume.profile)
          else if (resume.kind === 'enabled') await core.setEnabled(resume.enabled)
          else if (resume.kind === 'repair') await core.repair()
          else if (resume.kind === 'uninstall') await core.uninstall()
          else if (resume.kind === 'update' && state.activity.kind === 'deployment' && state.manifest.status === 'ready') {
            const version = resume.contentVersion
            const content = state.manifest.manifest.versions.find((v) => v.id === version)
            if (!content) throw new Error('The content version from the administrator request is no longer published.')
            set({ activity: { ...state.activity, update: { version: content.id, changelog: content.changelog, downloadSize: 0 } } })
            await core.update()
          }
        } catch (error) { set({ error: message(error) }) }
        finally { resumeContentVersion = null }
      }
    },
    async chooseGameFolder() {
      if (state.busy || state.activity.kind !== 'scan') return
      set({ busy: true })
      try {
        if (!await recover()) return
        const picked = await platform.pickFolder({ title: 'Choose the game folder' })
        if (picked === null) return
        const folder = await checkPickedFolder(platform, picked)
        set(folder ? { gameFolder: { status: 'found', ...folder }, rejectedFolder: null, error: null, deployment: null, plan: null, existingSetups: [] } : { rejectedFolder: picked })
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
      const { activity, deployment, manifest } = state
      if (state.busy || state.recoveryRequired || activity.kind !== 'deployment' || !activity.update || !deployment || manifest.status !== 'ready') return
      set({ busy: true, error: null, notice: null, deploymentProgress: null, activity: { ...activity, operation: 'update' } })
      try {
        if (!await prepareWrite({ kind: 'update', gameFolder: deployment.gameFolder, contentVersion: activity.update.version })) return
        await refreshHealth(deployment)
        const content = manifest.manifest.versions.find((v) => v.id === activity.update!.version)
        const tier = manifest.manifest.tiers.find((t) => t.id === deployment.tier)
        if (!content || !tier) throw new Error('This content version is no longer published. Reopen Lucent to check again.')
        const record = await updateDeployment(platform, deployment.gameFolder, content, tier, manifest.source, (progress) => set({ deploymentProgress: progress }))
        set({ deployment: record, profiles: record.recipe.performanceProfiles ?? [], selectedProfile: record.profile ?? null })
      } catch (error) {
        set(error instanceof DeploymentError
          ? { error: error.message, recoveryRequired: error.recoveryRequired }
          : { error: `${failureReason(error)} The game folder has not been changed.` })
      }
      finally {
        await refreshHealthAfter(true)
        await refreshAnnouncement()
        if (state.activity.kind === 'deployment') set({ activity: { ...state.activity, operation: null } })
        set({ busy: false, deploymentProgress: null })
      }
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
    backToScan() { if (!state.busy && !state.deployment) set({ activity: { kind: 'scan' }, plan: null, error: null }) },
    backToProfile() { if (!state.busy && !state.deployment) set({ activity: { kind: state.profiles.length ? 'profile' : 'scan' }, plan: null, error: null }) },
    async deploy() {
      if (state.busy || state.recoveryRequired || state.activity.kind !== 'review' || !state.plan || state.plan.blockedPaths.length) return
      set({ busy: true, error: null, notice: null, activity: { kind: 'deploying', progress: 0 } })
      try {
        if (!await recover()) { set({ activity: { kind: 'review' } }); return }
        const content = contentForTier()
        if (state.gameFolder.status !== 'found' || state.graphics.status !== 'found' || !state.graphics.tier || state.manifest.status !== 'ready') throw new Error('Finish Scan before installing.')
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
        set({ busy: false, error: message(error), recoveryRequired, ...(recoveryRequired ? { deployment: null, plan: null, activity: { kind: 'scan' } } : {}) })
        return
      }
      set({ busy: false, deployment: null, existingSetups: [], hotkeys: [], notice: 'Lucent is uninstalled. Your game folder is as it was before.' })
      await core.scan()
      // Scan may not find a folder the player picked; stay with the one just uninstalled.
      if (!state.deployment && folder.status === 'found') set({ gameFolder: folder, rejectedFolder: null })
    },
  }
  return core
}
