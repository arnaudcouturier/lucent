import { useCore } from './useCore'
import { Screen } from './Window'
import { FlowError } from './DeploymentScreens'
import { gameActionsAvailable } from '../core/gameAccess'
import { customProfileSummary } from '../core/customProfile'
import { setupChoices } from '../core/core'

/** The Profile screen's title already names the choice, so only the main screen shows a legend. */
export function ProfileSelector({ legend = true }: { legend?: boolean }) {
  const [state, core] = useCore()
  const { profiles, selectedProfile, customProfile, busy, recoveryRequired, activity } = state
  const custom = activity.kind === 'deployment' ? customProfile : null
  if (!profiles.length) return null
  return <fieldset className="profile-selector" disabled={activity.kind === 'deployment' ? !gameActionsAvailable(state) : busy || recoveryRequired} aria-label={legend ? undefined : 'Performance profile'}>
    {legend && <legend>Performance profile</legend>}
    <div className="card profile-rows">{profiles.map((profile) => {
      const selected = selectedProfile === profile.id && !custom
      return <label className={`option-row profile-row ${selected ? 'is-selected' : ''}`} key={profile.id}>
        <input type="radio" name="performance-profile" value={profile.id} checked={selected} onChange={() => void core.selectProfile(profile.id)} />
        <span><strong>{profile.label}</strong><small>{profile.description}</small></span>
      </label>
    })}
    {custom && <label className="option-row profile-row is-selected is-custom">
      <input type="radio" name="performance-profile" value="custom" checked readOnly />
      <span><strong>Custom · based on {profiles.find((p) => p.id === custom.basedOn)?.label}</strong><small>{customProfileSummary(custom.changed)}</small></span>
    </label>}</div>
  </fieldset>
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
        <span><strong>Include ReShade</strong><small>Shaders and presets, ready when you want them. None is active until you pick one in game.</small></span>
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
