// The core: all of Lucent's domain logic, framework-free. It exposes one observable state and the
// commands the UI calls. It reaches the machine only through the Platform port.
import type { Platform } from './platform'
import { checkPickedFolder, findGameFolder, type GameFolder } from './gameFolder'
import { loadManifest, type ManifestState } from './manifest'
import { matchTier, scanGraphics, type GraphicsState } from './graphics'
import { scanXivLauncher, type XivLauncherState } from './xivLauncher'
import { changePerformanceProfile, deployContent, DeploymentError, failureReason, readDeployment, recoverDeployments, repairDeployment, scanDeployment, setDeploymentEnabled, undoDeployment, uninstallDeployment, updateDeployment, type DeploymentProgress, type DeploymentRecord } from './deployment'
import { planDeployment, type Plan } from './planner'
import { checkHealth, type Drift } from './health'
import { announcedContent, needsNewerApp, type Channel } from './updates'
import { readSettings, writeSettings } from './settings'
import { detectExistingSetups, type ExistingSetup } from './existingSetup'
import { joinPath } from './paths'
import { DEFAULT_PROFILE, type ContentVersion, type PerformanceProfile, type ProfileId } from '../shared/manifest'
import { bugReportUrl, collectDiagnostics } from './diagnostics'

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
  /** Stops announcing the announced content version. */
  skipUpdate(): Promise<void>
  /** Undoes the deployment, leaving the game folder vanilla, then returns to Scan. */
  uninstall(): Promise<void>
  copyDiagnostics(): Promise<void>
  reportBug(): Promise<void>
  openLink(url: string): Promise<void>
}

const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.1.0'
/** Channel switching arrives with the Beta channel. */
const CHANNEL: Channel = 'stable'

export function createCore(platform: Platform): Core {
  let state: State = {
    activity: { kind: 'scan' }, gameFolder: { status: 'idle' }, rejectedFolder: null,
    graphics: { status: 'idle' }, manifest: { status: 'idle' }, xivLauncher: { status: 'idle' },
    plan: null, existingSetups: [], deployment: null, deploymentProgress: null, includeReShade: true, profiles: [], selectedProfile: null, busy: false, error: null, notice: null, recoveryRequired: false, hotkeys: [],
  }
  const listeners = new Set<() => void>()
  const set = (patch: Partial<State>) => {
    state = { ...state, ...patch }
    for (const l of listeners) l()
  }

  const message = (error: unknown) => error instanceof Error ? error.message : String(error)
  const recover = async () => {
    try {
      const recovered = await recoverDeployments(platform)
      const notice = recovered.some((r) => r.uninstalling) ? 'Lucent finished uninstalling. Your game folder is as it was before.'
        : recovered.length ? 'Lucent found an unfinished deployment and restored the game folder to how it was before. You can try again.' : null
      set({ recoveryRequired: false, ...(notice ? { notice } : {}) })
    } catch (error) {
      set({ recoveryRequired: true, error: `Recovery could not finish. ${failureReason(error)} Try recovery again once the problem is resolved.` })
      throw error
    }
  }
  const signatures = () => state.manifest.status === 'ready' ? state.manifest.manifest.existingSetups : []
  const restoreDeployment = async (folder: GameFolder) => {
    let record = await readDeployment(platform, folder.path)
    if (record?.status === 'applying') { await undoDeployment(platform, record); record = null }
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
      const update = await announceUpdate(state.deployment)
      if (state.activity.kind === 'deployment') set({ activity: { ...state.activity, update } })
    } catch { /* The card keeps the last announcement; Update explains any failure. */ }
  }
  const newestContentForTier = (): ContentVersion | undefined => {
    if (state.manifest.status !== 'ready' || state.graphics.status !== 'found' || !state.graphics.tier) return undefined
    const tier = state.graphics.tier
    return state.manifest.manifest.versions.filter((v) => v.channel === 'stable' && v.tiers[tier.id]).sort((a, b) => b.id.localeCompare(a.id))[0]
  }
  const contentForTier = (): ContentVersion => {
    if (state.manifest.status !== 'ready' || state.graphics.status !== 'found' || !state.graphics.tier) throw new Error('Finish Scan before continuing.')
    const content = newestContentForTier()
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
    async scan() {
      if (state.busy) return
      set({ busy: true, error: null, plan: null, existingSetups: [], deployment: null, profiles: [], selectedProfile: null, activity: { kind: 'scan' }, gameFolder: { status: 'scanning' }, rejectedFolder: null, graphics: { status: 'scanning' }, manifest: { status: 'loading' }, xivLauncher: { status: 'scanning' } })
      try {
        await recover()
        const [found, graphics, manifest, xivLauncher] = await Promise.all([
          findGameFolder(platform), scanGraphics(platform), loadManifest(platform), scanXivLauncher(platform),
        ])
        if (graphics.status === 'found' && manifest.status === 'ready') graphics.tier = matchTier(graphics.adapter, manifest.manifest)
        set({ gameFolder: found ? { status: 'found', ...found } : { status: 'not-found' }, graphics, manifest, xivLauncher })
        if (found) await restoreDeployment(found)
        if (!state.deployment && manifest.status === 'ready' && graphics.status === 'found' && graphics.tier) {
          const content = newestContentForTier()
          if (content) prepareProfiles(content)
        }
      } catch (error) { set({ error: state.recoveryRequired ? state.error : message(error) }) }
      finally { set({ busy: false }) }
    },
    async chooseGameFolder() {
      if (state.busy || state.activity.kind !== 'scan') return
      set({ busy: true })
      try {
        await recover()
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
        const drift = await refreshHealth(record, true)
        if (drift) {
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
        await recover()
        const content = contentForTier()
        if (state.gameFolder.status !== 'found' || state.graphics.status !== 'found' || !state.graphics.tier || state.manifest.status !== 'ready') throw new Error('Finish Scan before installing.')
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
      set({ busy: false })
    },
    finish() {
      if (state.activity.kind === 'done' && state.deployment) set({ activity: deploymentActivity(state.deployment, deployedDrift, null) })
    },
    async uninstall() {
      if (state.busy || state.recoveryRequired || state.activity.kind !== 'deployment' || !state.deployment) return
      const folder = state.gameFolder
      set({ busy: true, error: null, notice: null })
      try {
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
