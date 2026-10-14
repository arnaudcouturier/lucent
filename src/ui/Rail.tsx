// The left rail: the crystal, then the first-run steps or, once there is a deployment, the navigation between its
// sections. The graphics card sits at the bottom, with the app version.
import { useRef, type KeyboardEvent } from 'react'
import { Check, Cpu, History, House, Keyboard, LifeBuoy, Settings2, SquareTerminal, type LucideIcon } from 'lucide-react'
import { crystalState } from '../core/crystal'
import { setupChoices, type State } from '../core/core'
import { Crystal } from './crystal/Crystal'
import { useCore } from './useCore'
import { dragWindow } from './shell'
import { useSection, type Section } from './Window'
import type { TierStatus } from '../shared/manifest'

const TIER_STATUS_LABEL: Record<TierStatus, string> = {
  stable: 'Stable', experimental: 'Experimental', 'community-verified': 'Community-verified',
}
/** What each status badge means, said once under it. */
const TIER_STATUS_MEANING: Record<TierStatus, string> = {
  stable: 'Tested on these cards.', experimental: 'Not yet confirmed on these cards.', 'community-verified': 'Confirmed by players on these cards.',
}

const SECTIONS: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'keys', label: 'Keys', icon: Keyboard },
  { id: 'versions', label: 'Versions', icon: History },
  { id: 'logs', label: 'Logs', icon: SquareTerminal },
  { id: 'settings', label: 'Settings', icon: Settings2 },
  { id: 'help', label: 'Help', icon: LifeBuoy },
]

/** A dot beside a section that needs the player: drift on Home, an update in Versions. */
function attention(state: State, section: Section): 'caution' | 'accent' | null {
  const { activity } = state
  if (activity.kind !== 'deployment') return null
  if (section === 'home') return activity.drift || state.gameFolder.status === 'missing' ? 'caution' : null
  if (section === 'versions') return activity.update || state.appUpdate ? 'accent' : null
  return null
}

export function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 22" aria-hidden>
      <polygon points="8,0 16,8 8,22 0,8" fill="var(--accent)" />
      <path d="M0 8 L6 10 L8 22 M6 10 L16 8" fill="none" stroke="var(--mark-edge)" strokeWidth=".9" strokeLinejoin="round" />
    </svg>
  )
}

export function Rail() {
  const [state] = useCore()
  const crystal = crystalState(state)
  const choices = setupChoices(state)
  const steps = [{ kind: 'scan', title: 'Scan' }, ...(choices.any ? [{ kind: 'profile', title: choices.profiles ? 'Profile' : choices.neuralRendering ? 'Graphics' : 'Options' }] : []), { kind: 'review', title: 'Review' }, { kind: 'deploying', title: 'Install' }, { kind: 'done', title: 'Done' }]
  const step = steps.findIndex((s) => s.kind === state.activity.kind)
  const main = state.activity.kind === 'deployment'
  return (
    <aside className={`rail${main ? ' is-main' : ''}`} onMouseDown={dragWindow}>
      <div className="brand">
        <Mark className="brand-mark" />
        Lucent
      </div>
      <div className={`stage is-${crystal.mode}`}>
        <Crystal state={crystal} />
      </div>
      {main ? <Navigation /> : <ol className="steps" aria-label="Setup steps">
        {steps.map(({ title }, i) => (
          <li key={title} className={i < step ? 'is-done' : i === step ? 'is-now' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="step-dot">{i < step && <Check size={10} strokeWidth={3} />}</span>
            {title}
          </li>
        ))}
      </ol>}
      {!state.recoveryRequired && (main ? <SystemCard /> : <GraphicsFacts />)}
      <div className="rail-foot">Lucent {__APP_VERSION__}</div>
    </aside>
  )
}

/** The main screen's sections. Arrow keys move between them, as in any list of tabs. */
function Navigation() {
  const [state] = useCore()
  const { section, setSection } = useSection()
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const index = items.current.findIndex((item) => item === document.activeElement)
    const next = e.key === 'ArrowDown' ? index + 1 : e.key === 'ArrowUp' ? index - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? SECTIONS.length - 1 : null
    if (next === null || index < 0) return
    e.preventDefault()
    items.current[(next + SECTIONS.length) % SECTIONS.length]?.focus()
  }
  return (
    <nav className="rail-nav" aria-label="Lucent" onKeyDown={onKeyDown}>
      {SECTIONS.map(({ id, label, icon: Icon }, i) => {
        const dot = attention(state, id)
        return <button key={id} ref={(el) => { items.current[i] = el }} className={`rail-nav-item${section === id ? ' is-active' : ''}`}
          aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>
          <Icon size={15} strokeWidth={1.75} />
          <span>{label}</span>
          {dot && <span className={`rail-nav-dot is-${dot}`} aria-label={dot === 'caution' ? 'Needs attention' : 'Update available'} />}
        </button>
      })}
    </nav>
  )
}

/** The graphics card and the setup Lucent applies for it, compact, under the navigation. */
function SystemCard() {
  const [{ graphics }] = useCore()
  if (graphics.status !== 'found') return null
  const tier = graphics.tier
  return (
    <div className="rail-system" title={tier ? `${graphics.adapter.name}\nLucent setup for ${tier.gpuMatch === 'any' ? 'any graphics card' : `${tier.label} cards`}: ${TIER_STATUS_MEANING[tier.status]}` : graphics.adapter.name}>
      <Cpu size={14} strokeWidth={1.75} />
      <div>
        <span className="rail-system-gpu">{graphics.adapter.name}</span>
        {tier && <span className="rail-system-tier">{tier.gpuMatch === 'any' ? 'Any graphics card' : `${tier.label} cards`}
          <span className={`tier-badge is-${tier.status}`}>{TIER_STATUS_LABEL[tier.status]}</span></span>}
      </div>
    </div>
  )
}

/** The card Scan found, then the setup Lucent picked for it (its tier) and how proven that setup is. */
function GraphicsFacts() {
  const [{ graphics }] = useCore()
  const tier = graphics.status === 'found' ? graphics.tier : null
  return (
    <dl className="rail-facts" aria-live="polite">
      <div>
        <dt>Graphics card</dt>
        <dd className="rail-gpu-name" title={graphics.status === 'found' ? graphics.adapter.name : undefined}>
          {graphics.status === 'found' ? graphics.adapter.name : graphics.status === 'not-found' ? 'Not found' : graphics.status === 'unavailable' ? 'Could not scan' : 'Looking…'}
        </dd>
      </div>
      {graphics.status === 'found' && <div>
        <dt>Lucent setup</dt>
        {tier ? <>
          <dd className="rail-tier">
            <span>{tier.gpuMatch === 'any' ? 'Any graphics card' : `${tier.label} cards`}</span>
            <span className={`tier-badge is-${tier.status}`}>{TIER_STATUS_LABEL[tier.status]}</span>
          </dd>
          <dd className="rail-caption">{TIER_STATUS_MEANING[tier.status]}</dd>
        </> : <dd className="rail-tier-unavailable">Unavailable until Lucent can read its manifest.</dd>}
      </div>}
    </dl>
  )
}
