import { useCore } from './useCore'
import { Screen } from './Window'
import { FlowError } from './DeploymentScreens'

/** The Profile screen's title already names the choice, so only the main screen shows a legend. */
export function ProfileSelector({ legend = true }: { legend?: boolean }) {
  const [{ profiles, selectedProfile, busy, recoveryRequired, gameRunning, activity }, core] = useCore()
  if (!profiles.length) return null
  return <fieldset className="profile-selector" disabled={busy || recoveryRequired || (activity.kind === 'deployment' && gameRunning !== false)} aria-label={legend ? undefined : 'Performance profile'}>
    {legend && <legend>Performance profile</legend>}
    <div className="card profile-rows">{profiles.map((profile) => <label className={`option-row profile-row ${selectedProfile === profile.id ? 'is-selected' : ''}`} key={profile.id}>
      <input type="radio" name="performance-profile" value={profile.id} checked={selectedProfile === profile.id} onChange={() => void core.selectProfile(profile.id)} />
      <span><strong>{profile.label}</strong><small>{profile.description}</small></span>
    </label>)}</div>
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
