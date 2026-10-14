import { useCore } from './useCore'
import { Screen } from './Window'
import { FlowError } from './DeploymentScreens'
import { gameActionsAvailable } from '../core/gameAccess'
import { customProfileSummary } from '../core/customProfile'
import { setupChoices } from '../core/core'
import { profileSummaryForHeight } from '../core/profileValues'
import { SegmentedControl } from './SegmentedControl'

/** The Profile screen's title already names the choice, so only the main screen shows a legend. */
export function ProfileSelector({ legend = true }: { legend?: boolean }) {
  const [state, core] = useCore()
  const { profiles, selectedProfile, customProfile, busy, recoveryRequired, activity } = state
  const custom = activity.kind === 'deployment' ? customProfile : null
  if (!profiles.length) return null
  if (activity.kind === 'deployment') {
    const selected = profiles.find((profile) => profile.id === selectedProfile)
    const line = custom
      ? `Custom · based on ${profiles.find((profile) => profile.id === custom.basedOn)?.label ?? custom.basedOn}: ${customProfileSummary(custom.changed)}`
      : selected ? profileSummaryForHeight(selected, state.screen?.height ?? 2160) : ''
    return <div className="profile-selector profile-home-selector">
      <SegmentedControl
        value={custom ? null : selectedProfile}
        options={profiles.map(({ id, label }) => ({ id, label }))}
        disabled={!gameActionsAvailable(state)}
        ariaLabel="Performance profile"
        onChange={(id) => { const profile = profiles.find((item) => item.id === id); if (profile) void core.selectProfile(profile.id) }}
      />
      <p className={`profile-home-description ${custom ? 'is-custom' : ''}`}>{line}</p>
    </div>
  }
  return <fieldset className="profile-selector" disabled={busy || recoveryRequired} aria-label={legend ? undefined : 'Performance profile'}>
    {legend && <legend>Performance profile</legend>}
    <div className="card profile-rows">{profiles.map((profile) => {
      const selected = selectedProfile === profile.id
      const recommended = activity.kind === 'profile' && state.recommendedProfile === profile.id
      const gpuName = state.graphics.status === 'found' ? recommendationName(state.graphics.adapter.name) : ''
      return <label className={`option-row profile-row ${selected ? 'is-selected' : ''}`} key={profile.id}>
        <input type="radio" name="performance-profile" value={profile.id} checked={selected} onChange={() => void core.selectProfile(profile.id)} />
        <span><strong>{profile.label}{recommended && gpuName && <small className="profile-recommended">Recommended for your {gpuName}</small>}</strong><small>{profile.description}</small></span>
      </label>
    })}
    </div>
  </fieldset>
}

function recommendationName(name: string): string {
  return name.replace(/^(?:NVIDIA\s+)?(?:GeForce\s+)?/i, '').replace(/^(?:AMD\s+)?Radeon\s+|^Intel\s+Arc\s+/i, '')
}

/** Every first-run choice lives here, so Review only reviews. */
export function ProfileScreen() {
  const [state, core] = useCore()
  const { busy, includeReShade, addToStartMenu } = state
  const choices = setupChoices(state)
  return <Screen title={choices.profiles ? 'Performance profile' : 'Options'} sub={choices.profiles ? 'Choose how to balance detail and frame rate. You can change this later.' : 'Choose what Lucent sets up.'}>
    <ProfileSelector legend={false} />
    {(choices.reShade || choices.startMenu) && <div className="card option-list">
      {choices.reShade && <label className="option-row">
        <input type="checkbox" checked={includeReShade} disabled={busy} onChange={(e) => core.setIncludeReShade(e.target.checked)} />
        <span><strong>Include ReShade</strong><small>Shaders and presets. None is active until you pick one in game.</small></span>
      </label>}
      {choices.startMenu && <label className="option-row">
        <input type="checkbox" checked={addToStartMenu} disabled={busy} onChange={(e) => core.setAddToStartMenu(e.target.checked)} />
        <span><strong>Add Lucent to the Start menu</strong><small>Find it later like any installed app. Remove it from Settings → Apps.</small></span>
      </label>}
    </div>}
    <FlowError />
    <footer className="screen-actions">
      <button className="btn is-ghost" disabled={busy} onClick={() => core.backToScan()}>Back</button>
      <button className="btn is-primary" disabled={busy} onClick={() => void core.review()}>Continue</button>
    </footer>
  </Screen>
}
