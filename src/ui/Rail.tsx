// The left rail: the mark, the first-run steps and the app version.
// The large mark is a placeholder; the crystal replaces it.
import { Check } from 'lucide-react'
import { dragWindow } from './shell'

const FIRST_RUN_STEPS = ['Scan', 'Performance profile', 'Review', 'Install', 'Done']

export function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 22" aria-hidden>
      <polygon points="8,0 16,8 8,22 0,8" fill="var(--accent)" />
      <path d="M0 8 L6 10 L8 22 M6 10 L16 8" fill="none" stroke="var(--mark-edge)" strokeWidth=".9" strokeLinejoin="round" />
    </svg>
  )
}

export function Rail() {
  const step = 0 // Scan is the only first-run screen so far.
  return (
    <aside className="rail" onMouseDown={dragWindow}>
      <div className="brand">
        <Mark className="brand-mark" />
        Lucent
      </div>
      <div className="stage">
        <Mark className="stage-mark" />
      </div>
      <ol className="steps" aria-label="Setup steps">
        {FIRST_RUN_STEPS.map((title, i) => (
          <li key={title} className={i < step ? 'is-done' : i === step ? 'is-now' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="step-dot">{i < step && <Check size={10} strokeWidth={3} />}</span>
            {title}
          </li>
        ))}
      </ol>
      <div className="rail-foot">Lucent {__APP_VERSION__}</div>
    </aside>
  )
}
