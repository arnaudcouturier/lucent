// The left rail: the crystal, the first-run steps and the app version.
import { Check } from 'lucide-react'
import { crystalState } from '../core/crystal'
import { setupChoices } from '../core/core'
import { Crystal } from './crystal/Crystal'
import { useCore } from './useCore'
import { dragWindow } from './shell'
import type { TierStatus } from '../shared/manifest'

const TIER_STATUS_LABEL: Record<TierStatus, string> = {
  stable: 'Stable', experimental: 'Experimental', 'community-verified': 'Community-verified',
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
  const steps = [{ kind: 'scan', title: 'Scan' }, ...(choices.any ? [{ kind: 'profile', title: choices.profiles ? 'Profile' : 'Options' }] : []), { kind: 'review', title: 'Review' }, { kind: 'deploying', title: 'Install' }, { kind: 'done', title: 'Done' }]
  const step = steps.findIndex((s) => s.kind === state.activity.kind)
  const main = state.activity.kind === 'deployment'
  return (
    <aside className="rail" onMouseDown={dragWindow}>
      <div className="brand">
        <Mark className="brand-mark" />
        Lucent
      </div>
      <div className={`stage is-${crystal.mode}`}>
        <Crystal state={crystal} />
      </div>
      {!main && <ol className="steps" aria-label="Setup steps">
        {steps.map(({ title }, i) => (
          <li key={title} className={i < step ? 'is-done' : i === step ? 'is-now' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="step-dot">{i < step && <Check size={10} strokeWidth={3} />}</span>
            {title}
          </li>
        ))}
      </ol>}
      {!state.recoveryRequired && <GraphicsFacts />}
      {main && <dl className="rail-facts version-facts">
        <dt>Content version</dt><dd className="mono">{state.deployment?.contentVersion ?? 'Unknown'}</dd>
        <dt>Game version</dt><dd className="mono">{state.gameFolder.status === 'found' ? state.gameFolder.version ?? 'Unknown' : 'Unknown'}</dd>
      </dl>}
      <div className="rail-foot">Lucent {__APP_VERSION__}</div>
    </aside>
  )
}

function GraphicsFacts() {
  const [{ graphics }] = useCore()
  return (
    <dl className="rail-facts" aria-live="polite">
      <dt>Graphics card</dt>
      <dd className="rail-gpu-name" title={graphics.status === 'found' ? graphics.adapter.name : undefined}>
        {graphics.status === 'found' ? graphics.adapter.name : graphics.status === 'not-found' ? 'Not found' : graphics.status === 'unavailable' ? 'Could not scan' : 'Looking…'}
      </dd>
      {graphics.status === 'found' && (
        <dd className="rail-tier">
          {graphics.tier ? <>
            <span>{graphics.tier.label}</span>
            <span className={`tier-badge is-${graphics.tier.status}`}>{TIER_STATUS_LABEL[graphics.tier.status]}</span>
          </> : <span className="rail-tier-unavailable">Tier unavailable</span>}
        </dd>
      )}
    </dl>
  )
}
