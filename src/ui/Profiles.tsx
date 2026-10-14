import type { ReactNode } from 'react'
import { useCore } from './useCore'
import { Screen } from './Window'
import { FlowError } from './DeploymentScreens'
import { SegmentedControl } from './SegmentedControl'
import { setupChoices } from '../core/core'
import { frameGenerationLabel, hdrDescription, hdrLabel } from '../core/choices'
import { frameGenerationDescription } from '../core/frameGeneration'
import { profileSummaryForHeight } from '../core/profileValues'

/** The Profile step's profile cards: each shows what it sets, read only. The screen's title already names the choice. */
function ProfileSelector() {
  const [state, core] = useCore()
  const { profiles, selectedProfile, busy, recoveryRequired, activity, screen } = state
  if (!profiles.length) return null
  const gpuName = state.graphics.status === 'found' ? recommendationName(state.graphics.adapter.name) : ''
  return <fieldset className="profile-selector" disabled={busy || recoveryRequired} aria-label="Performance profile">
    <div className="profile-cards">{profiles.map((profile) => {
      const selected = selectedProfile === profile.id
      const recommended = activity.kind === 'profile' && state.recommendedProfile === profile.id
      return <label className={`card profile-card ${selected ? 'is-selected' : ''}`} key={profile.id}>
        <input type="radio" name="performance-profile" value={profile.id} checked={selected} onChange={() => void core.selectProfile(profile.id)} />
        <span>
          <strong>{profile.label}{recommended && gpuName && <small className="profile-recommended">Recommended for your {gpuName}</small>}</strong>
          <small>{profileSummaryForHeight(profile, screen?.height ?? 2160)}</small>
        </span>
      </label>
    })}</div>
  </fieldset>
}

function recommendationName(name: string): string {
  return name.replace(/^(?:NVIDIA\s+)?(?:GeForce\s+)?/i, '').replace(/^(?:AMD\s+)?Radeon\s+|^Intel\s+Arc\s+/i, '')
}

/** A titled choice: a segmented control and the line that says what the pick means on this screen. */
function ChoiceGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="card choice-group" aria-label={title}>
    <h2>{title}</h2>
    {children}
  </section>
}

function FrameGenerationChoice() {
  const [{ frameGenerationOptions, frameGenerationMode, screen, busy, recoveryRequired }, core] = useCore()
  if (!frameGenerationOptions.length) return null
  return <ChoiceGroup title="Frame generation">
    <SegmentedControl ariaLabel="Frame generation" value={frameGenerationMode} disabled={busy || recoveryRequired}
      options={frameGenerationOptions.map((option) => ({ id: option.id, label: frameGenerationLabel(option.id), experimental: option.experimental }))}
      onChange={(id) => core.selectFrameGenerationMode(id as NonNullable<typeof frameGenerationMode>)} />
    {frameGenerationMode && screen && <p className="choice-line">{frameGenerationDescription(frameGenerationMode, screen.frameCap, screen.refreshHz)}</p>}
  </ChoiceGroup>
}

function HdrChoice() {
  const [{ hdrOptions, hdrMode, screen, graphics, busy, recoveryRequired }, core] = useCore()
  if (!hdrOptions.length) return null
  const [line, ...notes] = hdrMode && screen ? hdrDescription(hdrMode, {
    windowsHdrOn: screen.hdrOn, nvidia: graphics.status === 'found' && graphics.adapter.vendorId === 0x10de, peakNits: screen.peakNits,
  }) : []
  return <ChoiceGroup title="HDR">
    <SegmentedControl ariaLabel="HDR" value={hdrMode} disabled={busy || recoveryRequired}
      options={hdrOptions.map((option) => ({ id: option.id, label: hdrLabel(option.id), experimental: option.experimental }))}
      onChange={(id) => core.selectHdrMode(id as NonNullable<typeof hdrMode>)} />
    {line && <p className="choice-line">{line}{notes.length > 0 && <small>{notes.join(' ')}</small>}</p>}
  </ChoiceGroup>
}

/** Every first-install choice lives here, so Review only reviews. */
export function ProfileScreen() {
  const [state, core] = useCore()
  const { busy, includeReShade, addToStartMenu } = state
  const choices = setupChoices(state)
  return <Screen title={choices.profiles ? 'Profile' : 'Options'}>
    <ProfileSelector />
    <FrameGenerationChoice />
    <HdrChoice />
    {(choices.reShade || choices.startMenu) && <div className="card option-list is-inline">
      {choices.reShade && <label className="option-row">
        <input type="checkbox" checked={includeReShade} disabled={busy} onChange={(e) => core.setIncludeReShade(e.target.checked)} />
        <span><strong>Include ReShade</strong><small>Shaders and presets. None is active at first.</small></span>
      </label>}
      {choices.startMenu && <label className="option-row">
        <input type="checkbox" checked={addToStartMenu} disabled={busy} onChange={(e) => core.setAddToStartMenu(e.target.checked)} />
        <span><strong>Add Lucent to the Start menu</strong><small>Find it like any installed app.</small></span>
      </label>}
    </div>}
    <FlowError />
    <footer className="screen-actions is-pinned">
      <button className="btn is-ghost" disabled={busy} onClick={() => core.backToScan()}>Back</button>
      <p className="screen-note">Written once. After that the config files are yours.</p>
      <button className="btn is-primary" disabled={busy} onClick={() => void core.review()}>Continue</button>
    </footer>
  </Screen>
}
