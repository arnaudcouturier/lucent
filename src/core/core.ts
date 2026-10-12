// The core: all of Lucent's domain logic, framework-free. It exposes one observable state and the
// commands the UI calls. It reaches the machine only through the Platform port.
import type { Platform } from './platform'
import { checkPickedFolder, findGameFolder, type GameFolder } from './gameFolder'
import { loadManifest, type ManifestState } from './manifest'
import { matchTier, scanGraphics, type GraphicsState } from './graphics'
import { scanXivLauncher, type XivLauncherState } from './xivLauncher'
import { changePerformanceProfile, deployContent, DeploymentError, failureReason, readDeployment, recoverDeployments, scanDeployment, undoDeployment, type DeploymentProgress, type DeploymentRecord } from './deployment'
import { planDeployment, type Plan } from './planner'
import { joinPath } from './paths'
import { DEFAULT_PROFILE, type ContentVersion, type PerformanceProfile, type ProfileId } from '../shared/manifest'

export type GameFolderState = { status: 'idle' } | { status: 'scanning' } | ({ status: 'found' } & GameFolder) | { status: 'not-found' }

/** Activity reported by the core. Later workflow commands will advance this beyond Scan. */
export type Activity =
  | { kind: 'scan' | 'profile' | 'review' | 'done' }
  | { kind: 'deploying'; progress: number }
  | {
      kind: 'deployment'
      enabled: boolean
      health: 'healthy' | 'drift'
      updateAvailable: boolean
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
}

export function createCore(platform: Platform): Core {
  let state: State = {
    activity: { kind: 'scan' }, gameFolder: { status: 'idle' }, rejectedFolder: null,
    graphics: { status: 'idle' }, manifest: { status: 'idle' }, xivLauncher: { status: 'idle' },
    plan: null, deployment: null, deploymentProgress: null, includeReShade: true, profiles: [], selectedProfile: null, busy: false, error: null, notice: null, recoveryRequired: false, hotkeys: [],
  }
  const listeners = new Set<() => void>()
  const set = (patch: Partial<State>) => {
    state = { ...state, ...patch }
    for (const l of listeners) l()
  }

  const message = (error: unknown) => error instanceof Error ? error.message : String(error)
  const recover = async () => {
    try {
      const folders = await recoverDeployments(platform)
      set({ recoveryRequired: false, ...(folders.length ? { notice: 'Lucent found an unfinished deployment and restored the game folder to how it was before. You can try again.' } : {}) })
    } catch (error) {
      set({ recoveryRequired: true, error: `Recovery could not finish. ${failureReason(error)} Try recovery again once the problem is resolved.` })
      throw error
    }
  }
  const restoreDeployment = async (folder: GameFolder) => {
    let record = await readDeployment(platform, folder.path)
    if (record?.status === 'applying') { await undoDeployment(platform, record); record = null }
    if (record?.status === 'complete') {
      let healthy = true
      for (const [relative, expected] of Object.entries(record.files)) {
        try {
          const path = await platform.resolveGamePath(joinPath(folder.path, 'game'), relative)
          if (await platform.hashFile(path) !== expected.sha256) healthy = false
        } catch { healthy = false }
      }
      set({ deployment: record, profiles: record.recipe.performanceProfiles ?? [], selectedProfile: record.profile ?? null, includeReShade: record.includeReShade, activity: { kind: 'deployment', enabled: record.enabled, health: healthy ? 'healthy' : 'drift', updateAvailable: false, operation: null } })
    }
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
    const app = (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.1.0').split('.').map(Number)
    const minimum = content.minAppVersion.split('.').map(Number)
    const firstDifference = minimum.findIndex((n, i) => n !== app[i])
    if (firstDifference >= 0 && minimum[firstDifference] > app[firstDifference]) throw new Error('Update Lucent before installing this content version.')
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
    async scan() {
      if (state.busy) return
      set({ busy: true, error: null, plan: null, deployment: null, profiles: [], selectedProfile: null, activity: { kind: 'scan' }, gameFolder: { status: 'scanning' }, rejectedFolder: null, graphics: { status: 'scanning' }, manifest: { status: 'loading' }, xivLauncher: { status: 'scanning' } })
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
        set(folder ? { gameFolder: { status: 'found', ...folder }, rejectedFolder: null, error: null, deployment: null, plan: null } : { rejectedFolder: picked })
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
        const deployment = await changePerformanceProfile(platform, state.deployment.gameFolder, profile)
        set({ deployment, selectedProfile: profile })
      } catch (error) { set({ error: message(error), recoveryRequired: error instanceof DeploymentError && error.recoveryRequired }) }
      finally { set({ busy: false }) }
    },
    async review(includeReShade = state.includeReShade) {
      if (state.busy || state.deployment || state.recoveryRequired) return
      set({ busy: true, error: null })
      try {
        const content = contentForTier()
        prepareProfiles(content)
        if (state.gameFolder.status !== 'found' || state.graphics.status !== 'found' || !state.graphics.tier) throw new Error('Choose the game folder before continuing.')
        const scan = await scanDeployment(platform, state.gameFolder.path, content, null)
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
        const record = await deployContent(platform, state.gameFolder.path, content, state.graphics.tier, state.includeReShade, state.selectedProfile, state.graphics.adapter, state.manifest.source,
          (progress) => set({ deploymentProgress: progress, activity: { kind: 'deploying', progress: progress.progress } }))
        const hotkeys = []
        if (record.recipe.overlay) hotkeys.push({ key: 'Insert', description: record.recipe.overlay === 'neural-rendering' ? 'OptiScaler · Neural Rendering and upscaling' : 'OptiScaler · FSR upscaling and frame generation' })
        if (record.includeReShade) hotkeys.push({ key: 'Home', description: 'ReShade · shaders and presets' })
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
      if (state.activity.kind === 'done' && state.deployment) set({ activity: { kind: 'deployment', enabled: true, health: 'healthy', updateAvailable: false, operation: null } })
    },
  }
  return core
}
