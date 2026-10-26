import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useCore } from './useCore'
import { Screen } from './Window'
import { FlowError } from './DeploymentScreens'
import { SegmentedControl } from './SegmentedControl'
import { setupChoices } from '../core/core'
import { frameGenerationLabel, hdrDescription, hdrLabel } from '../core/choices'
import { frameGenerationDescription } from '../core/frameGeneration'
import { shownSettingChoices, type ShownChoice } from '../core/settingChoices'
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
    <NeuralRenderingChoices />
  </section>
}

/** The setting choices the tier shows on this step: offered to the card and, where they need it, with frame generation on or enough passes. */
function useShownChoices(): ShownChoice[] {
  const [{ settingChoiceGroups, settingChoices, graphics, deployment, frameGenerationMode, hdrMode, neuralRendering }] = useCore()
  const gpuName = graphics.status === 'found' ? graphics.adapter.name : deployment?.graphics.name ?? ''
  return shownSettingChoices(settingChoiceGroups, settingChoices, { gpuName, frameGenerationMode, hdrMode, passes: neuralRendering?.passes ?? null })
}

/** A setting choice's segmented control and the line for the picked option, with why an option can't be picked now. */
function ChoiceControl({ choice, selected, options }: ShownChoice) {
  const [{ busy, recoveryRequired }, core] = useCore()
  const reasons = [...new Set(options.flatMap(({ blocked }) => blocked ? [blocked] : []))]
  return <>
    <SegmentedControl ariaLabel={choice.label} value={selected} disabled={busy || recoveryRequired}
      options={options.map(({ option, blocked }) => ({ id: option.id, label: option.label, experimental: option.experimental, disabled: blocked !== null }))}
      onChange={(id) => core.selectSettingChoice(choice.id, id)} />
    <p className="choice-line">{options.find(({ option }) => option.id === selected)?.option.description}{reasons.length > 0 && <small>{reasons.join(' ')}</small>}</p>
  </>
}

/** A collapsed heading over blocks the player rarely needs; it keeps its state while the blocks inside come and go. */
function Disclosure({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return <div className="nr-block nr-disclosure">
    <button type="button" className="row-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      {title}<ChevronDown size={13} strokeWidth={1.75} />
    </button>
    <div id={id} hidden={!open}>
      {note && <p className="choice-line">{note}</p>}
      {children}
    </div>
  </div>
}

/** The setting choices that sit inside the Neural Rendering card: each a block, those naming a group under that group's collapsed heading. */
function NeuralRenderingChoices() {
  const shown = useShownChoices().filter(({ choice }) => choice.placement?.in === 'neural-rendering')
  const block = (item: ShownChoice) => <div className="nr-block" key={item.choice.id}><h3>{item.choice.label}</h3><ChoiceControl {...item} /></div>
  return <>{[...new Set(shown.map(({ choice }) => choice.placement?.group))].map((group) => {
    const members = shown.filter(({ choice }) => choice.placement?.group === group)
    return group === undefined ? members.map(block)
      : <Disclosure key={group} title={group} note={members.find(({ choice }) => choice.placement?.note)?.choice.placement?.note}>{members.map(block)}</Disclosure>
  })}</>
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

/** The tier's setting choices (UI mode, DLSS-G preset): a card each, the line for the picked option, and why an option can't be picked now. */
function SettingChoices() {
  return <>{useShownChoices().filter(({ choice }) => !choice.placement).map((item) => <ChoiceGroup title={item.choice.label} key={item.choice.id}><ChoiceControl {...item} /></ChoiceGroup>)}</>
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
    <SettingChoices />
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
