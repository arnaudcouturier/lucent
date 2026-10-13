import { useCore } from './useCore'
import { Screen } from './Window'
import { FlowError } from './DeploymentScreens'
import { gameActionsAvailable } from '../core/gameAccess'
import { customProfileSummary } from '../core/customProfile'

/** The Profile screen's title already names the choice, so only the main screen shows a legend. */
export function ProfileSelector({ legend = true }: { legend?: boolean }) {
  const [state, core] = useCore()
  const { profiles, selectedProfile, customProfile, busy, recoveryRequired, activity } = state
  const custom = activity.kind === 'deployment' ? customProfile : null
  if (!profiles.length) return null
  return <fieldset className="profile-selector" disabled={activity.kind === 'deployment' ? !gameActionsAvailable(state) : busy || recoveryRequired} aria-label={legend ? undefined : 'Performance profile'}>
    {legend && <legend>Performance profile</legend>}
    <div className="card profile-rows">{profiles.map((profile) => <label className={`option-row profile-row ${selectedProfile === profile.id && !custom ? 'is-selected' : ''}`} key={profile.id}>
      <input type="radio" name="performance-profile" value={profile.id} checked={selectedProfile === profile.id && !custom} onChange={() => void core.selectProfile(profile.id)} />
      <span><strong>{profile.label}</strong><small>{profile.description}</small></span>
    </label>)}
    {custom && <label className="option-row profile-row is-selected is-custom">
      <input type="radio" name="performance-profile" value="custom" checked readOnly />
      <span><strong>Custom · based on {profiles.find((p) => p.id === custom.basedOn)?.label}</strong><small>{customProfileSummary(custom.changed)}</small></span>
    </label>}</div>
  </fieldset>
}

export function ProfileScreen() {
  const [{ busy }, core] = useCore()
  return <Screen title="Performance profile" sub="Choose how to balance detail and frame rate. You can change this later.">
    <ProfileSelector legend={false} />
    <FlowError />
    <footer className="screen-actions">
      <button className="btn is-ghost" disabled={busy} onClick={() => core.backToScan()}>Back</button>
      <button className="btn is-primary" disabled={busy} onClick={() => void core.review()}>Continue</button>
    </footer>
  </Screen>
}
