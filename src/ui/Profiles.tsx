import type { ReactNode } from 'react'
import { useCore } from './useCore'
import { Screen } from './Window'
import { FlowError } from './DeploymentScreens'
import { SegmentedControl } from './SegmentedControl'
import { setupChoices } from '../core/core'
import { frameGenerationLabel, hdrDescription, hdrLabel } from '../core/choices'
import { frameGenerationDescription } from '../core/frameGeneration'
import { profileSummaryForHeight } from '../core/profileValues'
import { presetRenderResolution, residualFgAvailable, residualFgCardMatches, scaleCostPercent, scaleLabel, SUGGESTED_DLAA_SCALE } from '../core/neuralRendering'
import { NR_PASSES, NR_SCALES, type NrPasses, type NrScale } from '../shared/manifest'

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

/** An on/off pick under Neural Rendering or frame generation: a switch, what it does, and why it may be unavailable. */
function ToggleRow({ label, description, checked, disabled, unavailable, experimental, onChange }: {
  label: string; description: string; checked: boolean; disabled: boolean; unavailable?: string | null; experimental?: boolean; onChange(on: boolean): void
}) {
  const off = disabled || !!unavailable
  return <label className={`toggle-row ${unavailable ? 'is-unavailable' : ''}`}>
    <input type="checkbox" role="switch" checked={checked && !unavailable} disabled={off} onChange={(e) => onChange(e.target.checked)} />
    <span>
      <strong>{label}{experimental && <span className="segmented-choice-experimental">Experimental</span>}</strong>
      <small>{description}</small>
      {unavailable && <small className="toggle-reason">{unavailable}</small>}
    </span>
  </label>
}

function NeuralRenderingSection() {
  const [state, core] = useCore()
  const { neuralRenderingControls: controls, neuralRendering: choice, screen, graphics, frameGenerationMode, busy, recoveryRequired } = state
  if (!controls || !choice) return null
  const disabled = busy || recoveryRequired
  const gpuName = graphics.status === 'found' ? graphics.adapter.name : state.deployment?.graphics.name ?? ''
  const preset = controls.presets.find((p) => p.id === choice.preset) ?? controls.presets[0]
  const width = screen?.width ?? 3840
  const height = screen?.height ?? 2160
  const render = presetRenderResolution(preset.ratio, width, height)
  const native = preset.id === 'dlaa'
  const residualUnavailable = !residualFgCardMatches(controls, gpuName) ? 'Needs an RTX 40 or RTX 50 card, which can run NVIDIA frame generation.'
    : !residualFgAvailable(controls, gpuName, frameGenerationMode) ? 'Turn frame generation on (2× or higher) to use this.' : null
  const suggestDlaaScale = native && choice.scale === 100
  return <section className="card choice-group neural-rendering" aria-label="Neural Rendering">
    <h2>Neural Rendering</h2>
    <div className="nr-block">
      <h3>DLSS preset</h3>
      <fieldset className="preset-grid" disabled={disabled} aria-label="DLSS preset">
        {controls.presets.map((option) => <label className={`preset-option ${option.id === choice.preset ? 'is-selected' : ''}`} key={option.id}>
          <input type="radio" name="nr-preset" value={option.id} checked={option.id === choice.preset} onChange={() => core.setNeuralRendering({ preset: option.id })} />
          <strong>{option.label}</strong>
          <small>{option.ratio === 1 ? 'Native' : `${option.ratio}× upscaling`}</small>
        </label>)}
      </fieldset>
      <p className="choice-line">{native
        ? `DLAA renders XIV at your full ${width}×${height}: the sharpest image and the highest cost.`
        : `${preset.label} renders XIV at ${render.width}×${render.height} and upscales it to ${width}×${height}.`}</p>
    </div>
    <div className="nr-block">
      <h3>Neural Rendering resolution</h3>
      <SegmentedControl ariaLabel="Neural Rendering resolution" value={String(choice.scale)} disabled={disabled}
        options={NR_SCALES.map((scale) => ({ id: String(scale), label: scale === 100 ? `${scaleLabel(scale)} · Recommended` : scaleLabel(scale) }))}
        onChange={(id) => core.setNeuralRendering({ scale: Number(id) as NrScale })} />
      <p className="choice-line">How much of the frame the Neural Rendering model works on; the image itself is never reduced.
        <small>{choice.scale < 100 ? `Costs about ${scaleCostPercent(choice.scale)}% of full resolution, because cost falls with the square. Slightly less detail.`
          : choice.scale > 100 ? `Supersamples for the cleanest image, at about ${scaleCostPercent(choice.scale)}% of the cost of 100%.`
          : 'Full quality. The model works on every pixel.'}</small></p>
      {suggestDlaaScale && <p className="choice-hint"><span>DLAA already costs the most, so {scaleLabel(SUGGESTED_DLAA_SCALE)} is recommended with it to protect your frame rate.</span>
        <button type="button" className="btn is-ghost" disabled={disabled} onClick={() => core.setNeuralRendering({ scale: SUGGESTED_DLAA_SCALE })}>Use {scaleLabel(SUGGESTED_DLAA_SCALE)}</button></p>}
    </div>
    <div className="nr-block">
      <h3>Passes</h3>
      <SegmentedControl ariaLabel="Neural Rendering passes" value={String(choice.passes)} disabled={disabled}
        options={NR_PASSES.map((passes) => ({ id: String(passes), label: passes === 1 ? '1 pass' : `${passes} passes` }))}
        onChange={(id) => core.setNeuralRendering({ passes: Number(id) as NrPasses })} />
      <p className="choice-line">Each extra pass costs about as much as the first. 1 is normal.</p>
    </div>
    <div className="nr-block nr-toggles">
      <ToggleRow label={controls.spatialCompression.label} description={controls.spatialCompression.description} experimental={controls.spatialCompression.experimental}
        checked={choice.spatialCompression} disabled={disabled} onChange={(on) => core.setNeuralRendering({ spatialCompression: on })} />
      <ToggleRow label={controls.residualFg.label} description={controls.residualFg.description} experimental={controls.residualFg.experimental}
        checked={choice.residualFg} disabled={disabled} unavailable={residualUnavailable} onChange={(on) => core.setNeuralRendering({ residualFg: on })} />
    </div>
  </section>
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
  const [{ frameGenerationOptions, frameGenerationMode, mfgUnlock, mfgUnlocked, screen, busy, recoveryRequired }, core] = useCore()
  if (!frameGenerationOptions.length) return null
  return <ChoiceGroup title="Frame generation">
    <SegmentedControl ariaLabel="Frame generation" value={frameGenerationMode} disabled={busy || recoveryRequired}
      options={frameGenerationOptions.map((option) => ({ id: option.id, label: frameGenerationLabel(option.id), experimental: option.experimental }))}
      onChange={core.selectFrameGenerationMode} />
    {frameGenerationMode && screen && <p className="choice-line">{frameGenerationDescription(frameGenerationMode, screen.frameCap, screen.refreshHz)}</p>}
    {mfgUnlock && <div className="nr-toggles"><ToggleRow label={mfgUnlock.label} description={mfgUnlock.description} experimental
      checked={mfgUnlocked} disabled={busy || recoveryRequired} onChange={core.setMfgUnlocked} /></div>}
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
      onChange={core.selectHdrMode} />
    {line && <p className="choice-line">{line}{notes.length > 0 && <small>{notes.join(' ')}</small>}</p>}
  </ChoiceGroup>
}

/** Every first-install choice lives here, so Review only reviews. */
export function ProfileScreen() {
  const [state, core] = useCore()
  const { busy, includeReShade, addToStartMenu } = state
  const choices = setupChoices(state)
  return <Screen title={choices.profiles ? 'Profile' : choices.neuralRendering ? 'Graphics' : 'Options'}>
    <ProfileSelector />
    <NeuralRenderingSection />
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
